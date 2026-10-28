const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { withAgentTestHomeLock } = require("./test-home.cjs");
async function main() {
  const home = process.env.DSH_HOME,
    native = process.env.DSH_NATIVE_ROOT;
  const output = path.join(home, "rtk-auto-validation");
  fs.mkdirSync(output, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dsh RTK "));
  assert.equal(spawnSync("git", ["init", "--quiet", cwd]).status, 0);
  assert.equal(
    spawnSync("git", [
      "-C",
      cwd,
      "-c",
      "user.name=RTK Fixture",
      "-c",
      "user.email=rtk@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ]).status,
    0,
  );
  fs.writeFileSync(path.join(cwd, "rtk-fixture.txt"), "fixture");
  fs.writeFileSync(
    path.join(cwd, "fixture log.log"),
    Array(300).fill("2026-10-28 INFO repeated log event").join("\n") +
      "\nERROR unique-log-marker\n",
  );
  fs.mkdirSync(path.join(cwd, "search"));
  fs.writeFileSync(path.join(cwd, ".gitignore"), "search/skip.txt\n");
  for (let i = 0; i < 70; i++)
    fs.writeFileSync(
      path.join(cwd, "search", "file-" + i + ".txt"),
      "needle match " + i + "\n",
    );
  fs.writeFileSync(
    path.join(cwd, "search", "skip.txt"),
    "needle DO_NOT_SEARCH_THIS\n",
  );
  fs.mkdirSync(path.join(cwd, "tests"));
  fs.writeFileSync(
    path.join(cwd, "tests", "fixture test.cjs"),
    `const fs=require('node:fs');const test=require('node:test');const assert=require('node:assert/strict');fs.appendFileSync('test-starts','start\\n');test('fixture-pass',()=>assert.ok(process.env.RTK_PROOF));`,
  );
  fs.writeFileSync(
    path.join(cwd, "tests", "failure.cjs"),
    `const fs=require('node:fs');const test=require('node:test');const assert=require('node:assert/strict');fs.appendFileSync('failure-starts','start\\n');test('fixture-failure',()=>assert.equal(1,2));`,
  );
  const { runProfile } = await import(
    pathToFileURL(path.join(native, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(native, "dsh-app-boot/lib/index.js"))
  );
  const patch = path.join(output, "patch.json");
  fs.writeFileSync(
    patch,
    JSON.stringify([
      { id: "desktop-product-telemetry", disabled: true },
      { id: "product-analytics", disabled: true },
    ]),
  );
  const runtime = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: "desktop",
    patchFiles: [patch],
    args: ["--port", "0", "--no-open"],
  });
  const ctx = runtime.ctx,
    calls = [],
    reports = [],
    confined = [];
  let lastAgent;
  const baseConfine = ctx.sandbox.confine.bind(ctx.sandbox);
  ctx.sandbox.confine = (argv, policy, signal) => {
    confined.push({ argv, policy });
    return baseConfine(argv, policy, signal);
  };
  assert.equal(
    ctx.shell.constructor.name,
    process.platform === "win32" ? "RtkPwshExecutor" : "RtkBashExecutor",
  );
  ctx.on("tools/result", (exec, result) =>
    calls.push({
      agent: exec.agent?.id,
      name: exec.name,
      args: exec.arguments,
      result,
    }),
  );
  try {
    const workspace = await ctx.workspaceRegistry.create(cwd, "RTK validation");
    for (const preset of ["standard", "ptc"]) {
      const made = await ctx.sessionController.create({
        workspaceId: workspace.id,
        agentPreset: preset,
      });
      const agent = (await ctx.sessionController.resolveAgent(made.sessionId))
        .agent;
      ctx.permissionPresets.set(agent.session, "workspace-write");
      lastAgent = agent;
      const service = ctx.get("localEnvironments");
      assert(service);
      const envId = "rtk-fixture-" + randomUUID();
      await service.select(agent.session, {
        id: envId,
        name: envId,
        repositories: [{ key: "repo", sourceRoot: cwd, cwd, worktree: false }],
        requiredVariables: ["RTK_PROOF"],
      });
      await service.setVariables(envId, { RTK_PROOF: "env-" + preset });
      const beforeConfine = confined.length;
      const logCommand =
        process.platform === "win32"
          ? `Get-Content "fixture log.log"`
          : `cat "fixture log.log"`;
      const requested = [
        "git status",
        "git log -3",
        'node -p "process.env.RTK_PROOF"',
        logCommand,
        "rg -n needle search",
        "rg --files search",
        'node --test "tests/fixture test.cjs"',
      ];
      const started = Date.now();
      await ctx.sessionController.prompt(
        {
          sessionId: agent.id,
          requestId: randomUUID(),
          mode: "queue",
          content: [
            {
              type: "text",
              text: `For this acceptance, call the shell tool with each of these exact commands SEPARATELY: ${JSON.stringify(requested)}. Do not add rtk or prefixes, do not combine commands: this tests automatic executor routing. The Node test is allowed to write its own fixture counter, but you must not edit files, repeat tests or delegate. Summarize the results.`,
            },
          ],
        },
        AbortSignal.timeout(120000),
      );
      await Promise.race([
        agent.whenIdle(),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(Error("RTK model timeout")),
            120000,
          );
          timer.unref();
        }),
      ]);
      const shell = calls.filter(
        (c) => c.agent === agent.id && ["bash", "pwsh"].includes(c.name),
      );
      fs.writeFileSync(
        path.join(output, preset + ".json"),
        JSON.stringify(shell, null, 2),
      );
      assert(
        shell.some(
          (c) =>
            c.args.command === "git status" && c.result.value?.exitCode === 0,
        ),
        preset + " model did not use the raw command",
      );
      const actual = confined.slice(beforeConfine);
      assert(
        actual.some((c) => c.argv.some((a) => a.includes("rtk git status"))),
        preset + " native confinement did not receive the rewritten command",
      );
      assert(
        shell
          .filter(
            (c) =>
              c.args.command === "git status" ||
              c.args.command === "git log -3",
          )
          .every(
            (c) =>
              c.result.value?.sandbox?.enforcement === "full" &&
              c.result.value?.exitCode === 0,
          ),
      );
      assert(
        shell.some(
          (c) =>
            c.args.command.includes("RTK_PROOF") &&
            JSON.stringify(c.result).includes("env-" + preset),
        ),
        preset + " selected environment was lost",
      );
      for (const command of requested) {
        const row = shell.find((c) => c.args.command === command);
        assert(
          row && row.result.value?.exitCode === 0,
          preset + " missing or failed: " + command,
        );
        assert.equal(row.result.value.sandbox.enforcement, "full");
      }
      const logOutput = shell.find((c) => c.args.command === logCommand).result
        .value.stdout.text;
      assert(logOutput.includes("unique-log-marker"));
      assert(
        logOutput.length < fs.statSync(path.join(cwd, "fixture log.log")).size,
      );
      const searchOutput = shell.find(
        (c) => c.args.command === "rg -n needle search",
      ).result.value.stdout.text;
      assert(!searchOutput.includes("DO_NOT_SEARCH_THIS"));
      assert(actual.some((c) => c.argv.some((a) => a.includes("rtk summary"))));
      assert(actual.some((c) => c.argv.some((a) => a.includes("rtk err"))));
      assert.equal(
        ctx.permissionPresets.current(agent.session),
        "workspace-write",
      );
      assert.equal(
        fs.readFileSync(path.join(cwd, "rtk-fixture.txt"), "utf8"),
        "fixture",
      );
      reports.push({
        platform: process.platform,
        preset,
        rtkUsed: true,
        shellCalls: shell.length,
        elapsedSeconds: (Date.now() - started) / 1000,
      });
    }
    const runShell = (command, extra = {}) =>
      ctx.shell.execute(
        ctx.shell.resolve({
          command,
          workdir: cwd,
          timeoutMs: 5000,
          onExpiry: "kill",
          dshEnv: { DSH_SESSION_ID: lastAgent.id },
          sandboxPolicy: ctx.sandboxPolicy.resolve({
            session: lastAgent.session,
          }),
          ...extra,
        }),
      );
    assert.equal(
      fs.readFileSync(path.join(cwd, "test-starts"), "utf8"),
      "start\nstart\n",
      "Each model must run tests only once",
    );
    const failedBefore = confined.length;
    const failedTest = await (
      await runShell("node --test tests/failure.cjs")
    ).result();
    assert.notEqual(failedTest.exitCode, 0);
    assert(failedTest.stdout.text.includes("fixture-failure"));
    assert.equal(
      fs.readFileSync(path.join(cwd, "failure-starts"), "utf8"),
      "start\n",
    );
    assert.equal(confined.length - failedBefore, 1);
    const preview = ctx
      .get("rtkRules")
      .preview({
        command: "node --test tests/failure.cjs",
        dialect: process.platform === "win32" ? "pwsh" : "bash",
      });
    assert(preview.changed);
    assert.equal(
      fs.readFileSync(path.join(cwd, "failure-starts"), "utf8"),
      "start\n",
      "Preview must not execute",
    );
    // Real native nonzero result is returned once, never retried unwrapped.
    const headFile = path.join(cwd, ".git/HEAD"),
      head = fs.readFileSync(headFile);
    try {
      fs.writeFileSync(headFile, "invalid fixture");
      const before = confined.length;
      const result = await (await runShell("git status")).result();
      assert.notEqual(result.exitCode, 0);
      assert.equal(confined.length - before, 1);
    } finally {
      fs.writeFileSync(headFile, head);
    }
    ctx.permissionPresets.set(lastAgent.session, "read-only");
    const denied = path.join(cwd, "must-not-exist.txt");
    const denyCommand =
      process.platform === "win32"
        ? "Set-Content -LiteralPath 'must-not-exist.txt' -Value forbidden"
        : "printf forbidden > must-not-exist.txt";
    const deniedResult = await (await runShell(denyCommand)).result();
    assert.equal(fs.existsSync(denied), false);
    assert.equal(deniedResult.sandbox.mode, "read-only");
    assert.equal(deniedResult.sandbox.enforcement, "full");
    ctx.permissionPresets.set(lastAgent.session, "workspace-write");
    if (process.platform !== "win32") {
      const bin = path.join(cwd, "fake-bin");
      fs.mkdirSync(bin);
      const marker = path.join(cwd, "starts"),
        late = path.join(cwd, "late");
      const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
      fs.writeFileSync(
        path.join(bin, "git"),
        "#!/bin/sh\n/usr/bin/printf 'start\\n' >> " +
          quote(marker) +
          "\n/bin/sleep 2\n/usr/bin/touch " +
          quote(late) +
          "\n",
        { mode: 0o755 },
      );
      const stopped = new AbortController();
      const before = confined.length;
      const execution = await runShell("git status", {
        signal: stopped.signal,
        env: { PATH: bin + path.delimiter + process.env.PATH },
      });
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(marker) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 25));
      assert(fs.existsSync(marker), "RTK did not enter synthetic git");
      stopped.abort();
      try {
        const result = await execution.result();
        assert(result.aborted);
      } catch (error) {
        assert(stopped.signal.aborted);
      }
      await new Promise((r) => setTimeout(r, 2300));
      assert.equal(confined.length - before, 1);
      assert.equal(fs.readFileSync(marker, "utf8"), "start\n");
      assert.equal(
        fs.existsSync(late),
        false,
        "Stopped child continued writing",
      );
    }
    fs.writeFileSync(
      path.join(output, "boundaries.json"),
      JSON.stringify({
        platform: process.platform,
        nonzeroOnce: true,
        readOnlyDenied: true,
        realAbort: process.platform !== "win32",
      }),
    );
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(reports, null, 2),
    );
    console.log("RTK_AUTO_MODEL_PASS " + JSON.stringify(reports));
  } finally {
    for (const agent of ctx.agents.list())
      if (agent.status === "running")
        agent.cancel({ kind: "user" }, { keepInbox: false });
    await runtime.shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
