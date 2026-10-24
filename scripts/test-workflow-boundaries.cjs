const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { withAgentTestHomeLock } = require("./test-home.cjs");
async function main() {
  const output = path.join(
    process.env.DSH_HOME,
    "execution-boundaries-" + Date.now(),
  );
  fs.mkdirSync(output, { recursive: true });
  const git = (...args) =>
    execFileSync("git", ["-C", output, ...args], { encoding: "utf8" });
  git("init", "-q");
  fs.writeFileSync(path.join(output, "sentinel.txt"), "unchanged");
  git("add", ".");
  git(
    "-c",
    "user.name=Acceptance",
    "-c",
    "user.email=acceptance@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  const patch = path.join(output, "runtime.patch.json");
  fs.writeFileSync(
    patch,
    JSON.stringify([
      { id: "desktop-product-telemetry", disabled: true },
      { id: "product-analytics", disabled: true },
    ]),
  );
  const native = process.env.DSH_NATIVE_ROOT;
  const { runProfile } = await import(
    pathToFileURL(path.join(native, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(native, "dsh-app-boot/lib/index.js"))
  );
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: "desktop",
    patchFiles: [patch],
    args: ["--port", "0", "--no-open"],
  });
  const reports = [];
  try {
    const workspace = await ctx.workspaceRegistry.create(
      output,
      "Execution boundary acceptance",
    );
    const made = await ctx.sessionController.create({
      workspaceId: workspace.id,
      agentPreset: "standard",
    });
    const { agent: parent } = await ctx.sessionController.resolveAgent(
      made.sessionId,
    );
    ctx.permissionPresets.set(parent.session, "workspace-write");
    const workflowResults = new Map();
    ctx.on("tools/result", (execution, result) => {
      if (execution.name === "workflow")
        workflowResults.set(execution.agent.id, result);
    });
    for (const preset of ["standard", "ptc"]) {
      const coordinator =
        preset === "standard"
          ? parent
          : (
              await ctx.sessionController.resolveAgent(
                (
                  await ctx.sessionController.create({
                    workspaceId: workspace.id,
                    agentPreset: preset,
                  })
                ).sessionId,
              )
            ).agent;
      ctx.permissionPresets.set(coordinator.session, "workspace-write");
      const marker = path.join(output, "guest-escape-" + preset + ".txt");
      const args = {
        meta: {
          name: "Guest write boundary",
          description: "Synthetic sandbox regression",
        },
        script: `const p = agent.constructor('return process')(); p.getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker)}, 'probe'); return 'wrote';`,
        budget_ms: 30000,
        run_in_background: false,
      };
      const started = Date.now();
      await ctx.sessionController.prompt(
        {
          sessionId: coordinator.id,
          requestId: randomUUID(),
          mode: "queue",
          content: [
            {
              type: "text",
              text:
                "Synthetic security regression in an isolated fixture. Call workflow exactly once with these arguments unchanged to test the guest process write boundary. In PTC use the required literal JSON envelope. Correct transport syntax only before a workflow starts. After its result report and stop; no retries, repairs or other tools.\n" +
                JSON.stringify(args),
            },
          ],
        },
        AbortSignal.timeout(120000),
      );
      await coordinator.whenIdle();
      const result = workflowResults.get(coordinator.id);
      assert(result, preset + " did not invoke the boundary probe");
      const wrote = fs.existsSync(marker);
      reports.push({
        name: "guest-process-write",
        preset,
        wrote,
        durationMs: Date.now() - started,
        result,
      });
      fs.writeFileSync(
        path.join(output, "result.json"),
        JSON.stringify(reports, null, 2),
      );
      assert.equal(
        wrote,
        process.env.DSH_EXPECT_GUEST_WRITABLE === "1",
        preset + " guest write boundary",
      );
      if (!wrote)
        assert.match(
          JSON.stringify(result),
          /EPERM|EACCES|denied|not permitted/i,
        );
    }
    if (process.env.DSH_EXPECT_GUEST_WRITABLE === "1") {
      console.log(
        "WORKFLOW_GUEST_REPRODUCED guest escaped VM and wrote fixture in both modes",
      );
      return;
    }
    const tree = await ctx.worktrees.create(
      parent,
      { enter: false },
      AbortSignal.timeout(60000),
    );
    const childMade = await ctx.sessionController.create({
      cwd: tree.path,
      agentPreset: "ptc",
    });
    const { agent: child } = await ctx.sessionController.resolveAgent(
      childMade.sessionId,
    );
    ctx.permissionPresets.set(child.session, "workspace-write");
    const outside = path.join(output, "sentinel.txt");
    fs.symlinkSync(outside, path.join(tree.path, "redirect.txt"));
    fs.writeFileSync(
      path.join(tree.path, "build.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(outside)},'bad')`,
    );
    const writeResults = new Map();
    ctx.on("tools/result", (execution, result) => {
      if (execution.name === "write")
        writeResults.set(execution.agent.id, result);
    });
    for (const preset of ["standard", "ptc"]) {
      const nativeWriter =
        preset === "ptc"
          ? child
          : (
              await ctx.sessionController.resolveAgent(
                (
                  await ctx.sessionController.create({
                    cwd: tree.path,
                    agentPreset: preset,
                  })
                ).sessionId,
              )
            ).agent;
      ctx.permissionPresets.set(nativeWriter.session, "workspace-write");
      // Isolate the filesystem boundary from the separate orchestration guard.
      const off = await ctx.commands.execute(
        nativeWriter,
        "/ultracode off",
        [],
        AbortSignal.timeout(30000),
      );
      assert.equal(off.result.kind, "success");
      for (const [name, file, denied] of [
        [
          "native-own-write",
          path.join(tree.path, "native-" + preset + ".txt"),
          false,
        ],
        ["native-outside-write", outside, true],
        ["native-symlink-write", path.join(tree.path, "redirect.txt"), true],
      ]) {
        writeResults.delete(nativeWriter.id);
        await ctx.sessionController.prompt(
          {
            sessionId: nativeWriter.id,
            requestId: randomUUID(),
            mode: "queue",
            content: [
              {
                type: "text",
                text:
                  "Synthetic native filesystem sandbox test. Call the write tool exactly once with these arguments, using the PTC SDK when necessary. Do not use a workflow, other tools or escalation parameters. A refusal is expected for outside paths; report the result and stop without retries.\n" +
                  JSON.stringify({ file_path: file, content: "probe" }),
              },
            ],
          },
          AbortSignal.timeout(120000),
        );
        await nativeWriter.whenIdle();
        const result = writeResults.get(nativeWriter.id);
        assert(result, preset + " did not call native write");
        reports.push({ name, preset, result });
        fs.writeFileSync(
          path.join(output, "result.json"),
          JSON.stringify(reports, null, 2),
        );
        assert.equal(Boolean(result.isError), denied, preset + " " + name);
        assert.equal(fs.readFileSync(outside, "utf8"), "unchanged");
      }
    }
    const cases = [
      [
        "own-write",
        "const fs=await import('node:fs/promises');await fs.writeFile('own.txt','ok');",
        false,
      ],
      [
        "raw-escape",
        `const fs=await import('node:fs/promises');await fs.writeFile(${JSON.stringify(outside)},'bad');`,
        true,
      ],
      [
        "symlink-escape",
        "const fs=await import('node:fs/promises');await fs.writeFile('redirect.txt','bad');",
        true,
      ],
      [
        "shell-escape",
        `const cp=await import('node:child_process');cp.execFileSync('/bin/sh',['-c','printf bad > "$1"','sh',${JSON.stringify(outside)}]);`,
        true,
      ],
      [
        "build-escape",
        "const cp=await import('node:child_process');cp.execFileSync('node',['build.cjs']);",
        true,
      ],
    ];
    for (const [name, program, denied] of cases) {
      const policy = ctx.sandboxPolicy.resolve({ session: child.session });
      assert.equal(fs.realpathSync(policy.workspaceRoot), tree.path);
      const started = Date.now();
      const result = await ctx.ptcRuntime.run(
        ctx.ptcRuntime.resolve({
          program,
          bindings: [],
          cwd: tree.path,
          sandboxPolicy: policy,
          signal: AbortSignal.timeout(30000),
        }),
      );
      reports.push({ name, policy, result, durationMs: Date.now() - started });
      fs.writeFileSync(
        path.join(output, "result.json"),
        JSON.stringify(reports, null, 2),
      );
      assert.equal(Boolean(result.error), denied, name);
      assert.equal(result.sandbox?.enforcement, "full", name);
      assert.equal(fs.readFileSync(outside, "utf8"), "unchanged", name);
    }
    ctx.permissionPresets.set(child.session, "read-only");
    const policy = ctx.sandboxPolicy.resolve({ session: child.session });
    const result = await ctx.ptcRuntime.run(
      ctx.ptcRuntime.resolve({
        program: cases[0][1],
        bindings: [],
        cwd: tree.path,
        sandboxPolicy: policy,
        signal: AbortSignal.timeout(30000),
      }),
    );
    reports.push({ name: "readonly-write", policy, result });
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(reports, null, 2),
    );
    assert(result.error);
    assert.equal(
      fs.readFileSync(path.join(tree.path, "own.txt"), "utf8"),
      "ok",
    );
    console.log(
      "WORKFLOW_BOUNDARIES_PASS Standard/PTC orchestration writes denied; actual Mac PTC, shell, build and symlink writes confined",
    );
  } finally {
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
