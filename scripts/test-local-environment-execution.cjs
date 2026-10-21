const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"),
  { randomUUID } = require("node:crypto");
const { withAgentTestHomeLock } = require("./test-home.cjs"),
  { withOutputLock } = require("./test-output-lock.cjs");
const output = path.resolve(
  __dirname,
  "../.local/local-environment-execution-test",
);

async function main() {
  assert.equal(
    process.platform,
    "win32",
    "This acceptance uses the pinned Windows PowerShell and PTY providers",
  );
  assert(
    process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT,
    "Use environment-execution-test with an isolated installed home and proxy key",
  );
  const home = fs.realpathSync(process.env.DSH_HOME),
    profile = fs.realpathSync(path.join(home, "profiles/desktop"));
  assert(
    profile.toLowerCase().startsWith(home.toLowerCase() + path.sep),
    "The isolated profile must remain inside its home",
  );
  const credentialsFile = path.join(home, ".credentials.yaml");
  if (fs.existsSync(credentialsFile))
    assert(
      !fs.lstatSync(credentialsFile).isSymbolicLink(),
      "The isolated credentials store must not be redirected",
    );
  for (const name of [
    "result.json",
    "failure.json",
    "synthetic-session-events.json",
  ])
    fs.rmSync(path.join(output, name), { force: true });
  const candidate = path.join(
    profile,
    "local-environment-execution-" + randomUUID(),
  );
  fs.mkdirSync(candidate);
  const source = path.resolve(__dirname, "../plugins/local-environments");
  fs.cpSync(path.join(source, "lib"), path.join(candidate, "lib"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(source, "package.json"),
    path.join(candidate, "package.json"),
  );
  const overlay = path.join(output, "runtime.patch.yml");
  fs.writeFileSync(
    overlay,
    JSON.stringify([
      { id: "desktop-product-telemetry", disabled: true },
      { id: "product-analytics", disabled: true },
      { id: "dsh-memory", disabled: true },
      { id: "local-environments", disabled: true },
      { id: "local-environment-catalog", disabled: true },
      { id: "local-environment-subprocess", disabled: true },
      { id: "local-environment-pwsh", disabled: true },
      {
        id: "subprocess",
        disabled: true,
      },
      {
        id: "pwsh-sandbox",
        disabled: true,
      },
      {
        insert: [
          {
            id: "environment-proof-subprocess",
            name: pathToFileURL(path.join(candidate, "lib/subprocess.js")).href,
          },
          {
            id: "environment-proof-pwsh",
            name: pathToFileURL(path.join(candidate, "lib/pwsh.js")).href,
          },
          {
            id: "local-environments-proof",
            name: pathToFileURL(path.join(candidate, "lib/index.js")).href,
          },
          {
            id: "local-environment-catalog-proof",
            name: pathToFileURL(path.join(candidate, "lib/catalog.js")).href,
          },
        ],
      },
    ]),
  );
  const native = process.env.DSH_NATIVE_ROOT;
  const { runProfile } = await import(
    pathToFileURL(path.join(native, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(native, "dsh-app-boot/lib/index.js"))
  );
  const started = Date.now(),
    signal = AbortSignal.timeout(300000),
    terminals = [],
    agents = [];
  const key = "HARNESS_ENV_PROOF_" + randomUUID().slice(0, 8).toUpperCase();
  const a = "CEDAR-" + randomUUID().slice(0, 8),
    b = "BIRCH-" + randomUUID().slice(0, 8),
    rotated = "PINE-" + randomUUID().slice(0, 8);
  let runtime, ctx, result;
  const phase = (value) =>
    fs.writeFileSync(
      path.join(output, "progress.json"),
      JSON.stringify({
        phase: value,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
      }),
    );
  const idle = async (agent) => {
    let abort;
    try {
      await Promise.race([
        agent.whenIdle(),
        new Promise((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  try {
    phase("boot");
    runtime = await runProfile({
      environment: loadLayeredEnv("dsh"),
      profile: "desktop",
      patchFiles: [overlay],
      args: ["--port", "0", "--no-open"],
    });
    ctx = runtime.ctx;
    phase("waiting for environment service");
    const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    let abortSetup;
    let service;
    try {
      service = await Promise.race([
        new Promise((resolve) =>
          ctx.inject(
            ["localEnvironments", "localEnvironmentCatalog"],
            (scope) => resolve(scope.localEnvironments),
          ),
        ),
        new Promise((_, reject) => {
          abortSetup = () =>
            reject(
              new Error(
                "Local environment service did not activate before the setup deadline",
              ),
            );
          setupSignal.addEventListener("abort", abortSetup, { once: true });
          if (setupSignal.aborted) abortSetup();
        }),
      ]);
    } finally {
      setupSignal.removeEventListener("abort", abortSetup);
    }
    assert.equal(
      ctx.shell.constructor.name,
      "EnvironmentPwshExecutor",
      "The test must mount the environment shell adapter",
    );
    assert.equal(
      ctx.subprocess.constructor.name,
      "EnvironmentSubprocessRuntime",
      "The test must mount the environment terminal adapter",
    );
    const store = path.resolve(
      ctx.credentials.config.path ??
        path.join(ctx.credentials.config.dshHome ?? home, ".credentials.yaml"),
    );
    assert.equal(
      store.toLowerCase(),
      credentialsFile.toLowerCase(),
      "The active credentials provider must use the isolated store",
    );
    assert.equal(
      (fs.existsSync(store)
        ? fs.realpathSync(store)
        : path.join(fs.realpathSync(path.dirname(store)), path.basename(store))
      ).toLowerCase(),
      credentialsFile.toLowerCase(),
      "The active credentials file must not be redirected",
    );
    const cwd = path.join(output, "project-" + Date.now());
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "AGENTS.md"),
      "Synthetic environment execution acceptance. Use only the explicitly requested pwsh environment lookup. No files, memory, network or delegation.",
    );
    const workspace = await ctx.workspaceRegistry.create(
      cwd,
      "Local environment execution acceptance",
    );
    const create = async (title) => {
      const item = await ctx.sessionController.create({
        workspaceId: workspace.id,
      });
      await ctx.sessionController.rename({ sessionId: item.sessionId, title });
      const agent = (await ctx.sessionController.resolveAgent(item.sessionId))
        .agent;
      ctx.permissionPresets.set(agent.session, "read-only");
      agents.push(agent);
      return agent;
    };
    const first = await create("环境执行验收 A"),
      second = await create("环境执行验收 B"),
      plain = await create("环境执行验收 未选择");
    const idA = "env-a-" + randomUUID(),
      idB = "env-b-" + randomUUID();
    const selection = (id) => ({
      id,
      name: id,
      repositories: [{ key: "repo", sourceRoot: cwd, cwd, worktree: false }],
      requiredVariables: [key],
    });
    await service.select(first.session, selection(idA));
    await service.select(second.session, selection(idB));
    await service.setVariables(idA, { [key]: a, HARNESS_ENV_EMPTY: "" });
    await service.setVariables(idB, { [key]: b });
    assert.equal(
      (await service.environmentFor(first.id)).HARNESS_ENV_EMPTY,
      "",
      "Native credential records must preserve empty values",
    );
    const calls = [],
      firstRequests = new Map();
    ctx.on("tools/execute", async (exec, next) => {
      if (agents.some((agent) => agent.id === exec.agent?.id))
        calls.push({ sessionId: exec.agent.id, name: exec.name });
      return next();
    });
    ctx.on("llm/stream", (options, next) => {
      if (
        !options.purpose &&
        agents.some((agent) => agent.id === options.sessionId) &&
        !firstRequests.has(options.sessionId)
      )
        firstRequests.set(options.sessionId, JSON.stringify(options.messages));
      return next();
    });
    const prompt = async (agent) => {
      await ctx.sessionController.prompt(
        {
          sessionId: agent.id,
          requestId: randomUUID(),
          mode: "queue",
          content: [
            {
              type: "text",
              text: `Use only pwsh to print $env:${key} and $env:DSH_SESSION_ID, then echo their actual values in the final answer. Do not inspect any other variable or file, save memory, change permissions, or delegate.`,
            },
          ],
        },
        signal,
      );
      await idle(agent);
    };
    phase("concurrent real model shell calls");
    await Promise.all([prompt(first), prompt(second)]);
    const reply = (agent) =>
      agent.session
        .snapshotEvents()
        .findLast((event) => event.type === "assistant/message")
        ?.data.message.content.filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("") ?? "";
    assert(reply(first).includes(a) && reply(first).includes(first.id));
    assert(reply(second).includes(b) && reply(second).includes(second.id));
    assert(
      !reply(first).includes(b) && !reply(second).includes(a),
      "Concurrent sessions mixed their environment values",
    );
    for (const agent of [first, second]) {
      assert(firstRequests.has(agent.id), "No real provider request observed");
      assert(
        !firstRequests.get(agent.id).includes(a) &&
          !firstRequests.get(agent.id).includes(b),
        "Private process values were injected into model context",
      );
      assert(
        calls.some(
          (call) => call.sessionId === agent.id && call.name === "pwsh",
        ),
        "The model did not execute the native pwsh tool",
      );
      assert.equal(ctx.permissionPresets.current(agent.session), "read-only");
    }
    const direct = async (agent) => {
      const execution = await ctx.shell.execute(
        ctx.shell.resolve({
          command: `Write-Output ("VALUE:" + [string]$env:${key})`,
          workdir: cwd,
          dshEnv: { DSH_SESSION_ID: agent.id },
          signal,
        }),
      );
      const value = await execution.result();
      assert.equal(value.exitCode, 0);
      return value.stdout.text;
    };
    const plainOutput = await direct(plain);
    assert(
      plainOutput.includes("VALUE:") &&
        !plainOutput.includes(a) &&
        !plainOutput.includes(b),
      "An unrelated session inherited an environment",
    );
    await service.setVariables(idA, { [key]: rotated });
    assert(
      (await direct(first)).includes(rotated),
      "The next shell call did not reread changed variables",
    );
    const pwsh = await ctx.subprocess.resolveExecutable(
      "pwsh",
      undefined,
      signal,
    );
    phase("native PTY");
    const terminal = await ctx.subprocess.spawnTerminal({
      argv: [pwsh, "-NoLogo", "-NoProfile"],
      cwd,
      env: { DSH_SESSION_ID: first.id },
      rows: 24,
      cols: 80,
      terminalType: "xterm-256color",
      graceMs: 1000,
      signal,
    });
    terminals.push(terminal);
    phase("reading native PTY");
    let terminalText = "";
    const abortTerminal = () => {
      void terminal.terminate().catch(() => {});
    };
    signal.addEventListener("abort", abortTerminal, { once: true });
    if (signal.aborted) abortTerminal();
    try {
      const received = new Promise((resolve, reject) => {
        terminal.output.on("data", (chunk) => {
          terminalText += String(chunk);
          if (terminalText.length >= 65536)
            reject(new Error("Unexpected PTY output volume"));
          if (terminalText.includes("PTY_VALUE:" + rotated)) resolve();
        });
        terminal.output.once("error", reject);
        terminal.done.then(
          () => reject(new Error("PTY exited before its environment proof")),
          reject,
        );
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
      await terminal.write(`Write-Output ("PTY_VALUE:" + $env:${key})\r`);
      await received;
      await terminal.terminate();
      await terminal.done;
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", abortTerminal);
    }
    assert(
      terminalText.includes("PTY_VALUE:" + rotated),
      "Native PTY did not receive the selected environment",
    );
    assert.equal(
      process.env[key],
      undefined,
      "Harness process environment was mutated",
    );
    for (const agent of [first, second])
      assert(
        !JSON.stringify(
          agent.session
            .snapshotEvents()
            .filter(
              (event) => event.type === "plugin:local-environments/selected",
            ),
        ).includes(a),
        "Selection metadata included private values",
      );
    phase("native multi-repository environment");
    const catalog = ctx.localEnvironmentCatalog;
    const { localGit } = await import(
      pathToFileURL(path.join(candidate, "lib/workspace.js"))
    );
    const catalogId = "catalog-" + randomUUID();
    const repoRoots = [];
    for (const repo of ["web", "api"]) {
      const root = path.join(cwd, repo);
      fs.mkdirSync(root);
      fs.mkdirSync(path.join(root, "empty-hooks"));
      fs.writeFileSync(path.join(root, "seed.txt"), "committed seed\n");
      fs.writeFileSync(
        path.join(root, ".gitignore"),
        ".dsh/\nprivate.env\nempty-hooks/\n",
      );
      await localGit(
        ctx,
        root,
        ["-c", "init.templateDir=", "init", "-b", "main"],
        signal,
      );
      await localGit(
        ctx,
        root,
        ["config", "core.hooksPath", path.join(root, "empty-hooks")],
        signal,
      );
      await localGit(ctx, root, ["config", "core.longpaths", "true"], signal);
      await localGit(ctx, root, ["config", "core.autocrlf", "false"], signal);
      await localGit(ctx, root, ["add", "seed.txt", ".gitignore"], signal);
      await localGit(
        ctx,
        root,
        [
          "-c",
          "user.name=Environment fixture",
          "-c",
          "user.email=environment-fixture@example.invalid",
          "commit",
          "-m",
          "fixture seed",
        ],
        signal,
      );
      fs.writeFileSync(path.join(root, "seed.txt"), "uncommitted source\n");
      fs.writeFileSync(
        path.join(root, "private.env"),
        "excluded fixture data\n",
      );
      repoRoots.push(root);
    }
    await catalog.save({
      id: catalogId,
      name: "原生多仓库环境验收",
      repositories: [
        { key: "web", mode: "worktree", baseRef: "main" },
        { key: "api", mode: "worktree", baseRef: "main" },
      ],
      requiredVariables: [key],
    });
    for (let i = 0; i < 2; i++)
      await catalog.bind({
        id: catalogId,
        key: ["web", "api"][i],
        path: repoRoots[i],
      });
    await catalog.variables({ id: catalogId, values: { [key]: rotated } });
    const portable = JSON.stringify(await catalog.export());
    assert(
      !portable.includes(rotated) &&
        !repoRoots.some((root) => portable.includes(root)),
      "Portable definitions leaked local configuration",
    );
    const launched = await catalog.launch({ id: catalogId });
    const coordinator = (
      await ctx.sessionController.resolveAgent(launched.sessionId)
    ).agent;
    agents.push(coordinator);
    assert(
      coordinator.session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === "plugin:local-environments/selected" &&
            event.ignorable === true,
        ),
    );
    assert.equal(launched.repositories.length, 2);
    assert.notEqual(launched.repositories[0].cwd, launched.repositories[1].cwd);
    assert.equal(coordinator.session.header.cwd, launched.repositories[0].cwd);
    for (let i = 0; i < 2; i++) {
      const repo = launched.repositories[i];
      assert.equal(
        fs.readFileSync(path.join(repo.cwd, "seed.txt"), "utf8"),
        "committed seed\n",
      );
      assert.equal(
        fs.readFileSync(path.join(repoRoots[i], "seed.txt"), "utf8"),
        "uncommitted source\n",
      );
      assert(!fs.existsSync(path.join(repo.cwd, "private.env")));
    }
    const child = await ctx.nestedSessions.start({
      sessionId: coordinator.id,
      context: "fresh",
      cwd: launched.repositories[1].cwd,
      title: "仓库 api 子会话",
    });
    const worker = (await ctx.sessionController.resolveAgent(child.sessionId))
      .agent;
    agents.push(worker);
    assert.equal(worker.session.header.cwd, launched.repositories[1].cwd);
    assert.equal((await service.environmentFor(worker.id))[key], rotated);
    assert.equal(
      ctx.sandboxPolicy.resolve({ session: coordinator.session }).workspaceRoot,
      launched.repositories[0].cwd,
    );
    assert.equal(
      ctx.sandboxPolicy.resolve({ session: worker.session }).workspaceRoot,
      launched.repositories[1].cwd,
    );
    const recent = await catalog.recent();
    assert(
      recent.some(
        (row) => row.path === launched.repositories[0].cwd && row.available,
      ),
    );
    result = {
      passed: true,
      sessionIds: { first: first.id, second: second.id, plain: plain.id },
      actualConcurrentProxyShells: true,
      valuesIsolated: true,
      managedSessionIdentityPreserved: true,
      privateValuesAbsentFromInitialModelRequests: true,
      unselectedSessionUnchanged: true,
      nextCallRereadsRotation: true,
      nativePtyReceivedEnvironment: true,
      nativePtyJoinedBeforeShutdown: true,
      nativeMultiRepositoryWorktreesCreated: true,
      catalogSessionId: coordinator.id,
      sourceChangesAndIgnoredDataPreserved: true,
      childInheritedEnvironmentWithOwnSandboxRoot: true,
      portableDefinitionsExcludePathsAndValues: true,
      recentFoldersUseNativeMetadata: true,
      permissionsUnchanged: true,
      processEnvironmentUnchanged: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "synthetic-session-events.json"),
      JSON.stringify(
        agents.map((agent) => ({
          id: agent.id,
          events: agent.session.snapshotEvents(),
        })),
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify({ error: error.message }, null, 2),
    );
    throw error;
  } finally {
    for (const terminal of terminals) await terminal.terminate();
    if (runtime) {
      for (const agent of agents)
        if (agent.status === "running")
          agent.cancel({ kind: "user" }, { keepInbox: false });
      await runtime.shutdown.shutdown(0);
    }
  }
  const { Context } = await import(
    pathToFileURL(path.join(native, "cordis/lib/index.js"))
  );
  const persistence = await import(
    pathToFileURL(
      path.join(native, "dsh-session-persistence-jsonl/lib/index.js"),
    )
  );
  const coldContext = new Context();
  const reader = coldContext.plugin(persistence, {
    root: path.join(home, "sessions"),
    listConcurrency: 8,
  });
  await reader.await();
  try {
    const handle = await coldContext
      .get("sessionPersistence")
      .open(result.catalogSessionId, "read");
    try {
      const { events } = await handle.read();
      assert(
        events.some(
          (event) =>
            event.type === "plugin:local-environments/selected" &&
            event.ignorable === true,
        ),
      );
      result.historyReadableWithoutEnvironmentPlugin = true;
    } finally {
      await handle.close();
    }
  } finally {
    await reader.dispose();
  }
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log("LOCAL_ENVIRONMENT_EXECUTION_PASS " + JSON.stringify(result));
}
if (require.main === module)
  withOutputLock(output, () =>
    withAgentTestHomeLock(process.env.DSH_HOME, main),
  )
    .then(() => {
      // Exit this one-shot host after terminal joins, shutdown and lease release.
      process.stdout.write("", () => process.exit(process.exitCode ?? 0));
    })
    .catch((error) => {
      console.error(error.stack);
      process.stderr.write("", () => process.exit(1));
    });
