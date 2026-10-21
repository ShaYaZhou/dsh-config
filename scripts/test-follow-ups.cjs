const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"),
  { randomUUID } = require("node:crypto");
const { withAgentTestHomeLock } = require("./test-home.cjs"),
  { withOutputLock } = require("./test-output-lock.cjs");
const output = path.resolve(__dirname, "../.local/follow-ups-test");

async function main() {
  assert(
    process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT,
    "Use follow-ups-test with an isolated installed home and proxy key",
  );
  const home = fs.realpathSync(process.env.DSH_HOME),
    profile = fs.realpathSync(path.join(home, "profiles/desktop"));
  assert(
    profile.toLowerCase().startsWith(home.toLowerCase() + path.sep),
    "The isolated profile must remain inside its home",
  );
  for (const file of ["result.json", "failure.json"])
    fs.rmSync(path.join(output, file), { force: true });
  const candidate = path.join(profile, "follow-ups-proof-" + randomUUID());
  fs.mkdirSync(candidate);
  const source = path.resolve(__dirname, "../plugins/follow-ups");
  fs.cpSync(path.join(source, "lib"), path.join(candidate, "lib"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(source, "package.json"),
    path.join(candidate, "package.json"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(profile, "package.json"), "utf8"),
  );
  const overlay = path.join(output, "runtime.patch.yml");
  fs.writeFileSync(
    overlay,
    JSON.stringify([
      { id: "desktop-product-telemetry", disabled: true },
      { id: "product-analytics", disabled: true },
      { id: "dsh-memory", disabled: true },
      ...(manifest.dsh.profile.bundles.includes("@local/dsh-follow-ups")
        ? [{ id: "follow-ups", disabled: true }]
        : []),
      {
        insert: [
          {
            id: "follow-ups-proof",
            name: pathToFileURL(path.join(candidate, "lib/index.js")).href,
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
  const { localGit } = await import(
    pathToFileURL(
      path.join(
        profile,
        "node_modules/@local/dsh-local-environments/lib/workspace.js",
      ),
    )
  );
  const signal = AbortSignal.timeout(300000),
    started = Date.now(),
    owned = [],
    tools = [],
    requests = [];
  let runtime, ctx, service, root, release, offGate, result;
  const phase = (phase) =>
    fs.writeFileSync(
      path.join(output, "progress.json"),
      JSON.stringify({
        phase,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
      }),
    );
  async function wait(promise, timeoutSignal = signal) {
    let abort;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          abort = () => reject(timeoutSignal.reason);
          timeoutSignal.addEventListener("abort", abort, { once: true });
          if (timeoutSignal.aborted) abort();
        }),
      ]);
    } finally {
      timeoutSignal.removeEventListener("abort", abort);
    }
  }
  async function open() {
    runtime = await runProfile({
      environment: loadLayeredEnv("dsh"),
      profile: "desktop",
      patchFiles: [overlay],
      args: ["--port", "0", "--no-open"],
    });
    ctx = runtime.ctx;
    service = await wait(
      new Promise((resolve) =>
        ctx.inject(["followUps"], (scope) => resolve(scope.followUps)),
      ),
      AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    );
    ctx.on("llm/stream", (options, next) => {
      if (!options.purpose) requests.push({ sessionId: options.sessionId });
      return next();
    });
    ctx.on("tools/execute", (exec, next) => {
      tools.push({ sessionId: exec.agent?.id, name: exec.name });
      return next();
    });
  }
  const prompt = (agent, text) =>
    ctx.sessionController.prompt(
      {
        sessionId: agent.id,
        requestId: randomUUID(),
        mode: "queue",
        content: [{ type: "text", text }],
      },
      signal,
    );
  try {
    phase("boot");
    await open();
    await service.preferences({ enabled: true });
    const cwd = path.join(output, "project-" + Date.now());
    fs.mkdirSync(cwd);
    fs.mkdirSync(path.join(cwd, "empty-hooks"));
    fs.writeFileSync(
      path.join(cwd, "AGENTS.md"),
      "Synthetic follow-up acceptance. The main session proposes tasks only; linked workers execute explicit confirmed briefs. Preserve seed.txt, local-note.txt, AGENTS.md and .gitignore. Only requested marker files may be written. No memory, network, commits, push or further delegation. Do not inspect any credentials or other paths.",
    );
    fs.writeFileSync(path.join(cwd, "seed.txt"), "committed seed\n");
    fs.writeFileSync(
      path.join(cwd, ".gitignore"),
      ".agents/\nempty-hooks/\nlocal-note.txt\n",
    );
    await localGit(
      ctx,
      cwd,
      ["-c", "init.templateDir=", "init", "-b", "main"],
      signal,
    );
    for (const [key, value] of [
      ["core.hooksPath", path.join(cwd, "empty-hooks")],
      ["core.longpaths", "true"],
      ["core.autocrlf", "false"],
    ])
      await localGit(ctx, cwd, ["config", key, value], signal);
    await localGit(
      ctx,
      cwd,
      ["add", "seed.txt", "AGENTS.md", ".gitignore"],
      signal,
    );
    await localGit(
      ctx,
      cwd,
      [
        "-c",
        "user.name=Follow-up fixture",
        "-c",
        "user.email=followup-fixture@example.invalid",
        "commit",
        "-m",
        "fixture baseline",
      ],
      signal,
    );
    fs.writeFileSync(
      path.join(cwd, "local-note.txt"),
      "source note stays here\n",
    );
    const workspace = await ctx.workspaceRegistry.create(
      cwd,
      "后续任务原生验收",
    );
    const create = async (title) => {
      const value = await ctx.sessionController.create({
        workspaceId: workspace.id,
      });
      await ctx.sessionController.rename({ sessionId: value.sessionId, title });
      const agent = (await ctx.sessionController.resolveAgent(value.sessionId))
        .agent;
      ctx.permissionPresets.set(agent.session, "workspace-write");
      await ctx.sessions.flush(agent.session);
      owned.push(agent);
      return agent;
    };
    root = await create("原任务保持运行，后续任务等待确认");
    const entered = Promise.withResolvers();
    release = Promise.withResolvers();
    let parked = false;
    offGate = root.ctx.on(
      "agent/request",
      async ({ signal }, next) => {
        if (
          !parked &&
          ctx.sessionProjections.stateOf(root.session, "followUps")?.offer
        ) {
          parked = true;
          entered.resolve();
          await wait(release.promise, signal);
        }
        return next();
      },
      { prepend: true },
    );
    const offWrites = root.ctx.tools.guard((exec) =>
      exec.agent?.id === root.id &&
      ["write", "edit", "pwsh", "bash"].includes(exec.name)
        ? "This main fixture may only propose; implementation belongs to confirmed workers."
        : undefined,
    );
    const alpha = "ALPHA-" + randomUUID().slice(0, 8),
      beta = "BETA-" + randomUUID().slice(0, 8);
    phase("real model proposes without executing");
    await prompt(
      root,
      `This is a suggestion-control demonstration, not permission to execute follow-up tasks. Call propose_followups exactly once with two optional tasks, in this order: title "Optional alpha", prompt "In your current isolated workspace, create result.txt containing exactly ${alpha}. Use a native write or pwsh tool. Preserve all other files. Do not create further sessions or proposals. Reply DONE_ALPHA."; title "Optional beta", with the same brief but content ${beta} and reply DONE_BETA. Include next_prompt "Review the optional results". Do not create files or workers yourself. After the tool returns, reply MAIN_CONTINUES; do not implement or delegate these tasks yourself.`,
    );
    await wait(
      entered.promise,
      AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    );
    const initial = await service.view({ sessionId: root.id });
    assert.equal(initial.offer.tasks.length, 2);
    assert.equal(initial.offer.nextPrompt, "Review the optional results");
    assert(initial.offer.tasks.every((task) => task.status === "pending"));
    assert.equal(
      (await ctx.nestedSessions.list({ sessionId: root.id })).links.length,
      0,
    );
    assert(!fs.existsSync(path.join(cwd, "result.txt")));
    assert(
      tools.some(
        (call) =>
          call.sessionId === root.id && call.name === "propose_followups",
      ),
    );
    const beforeMetadata = requests.length;
    await service.dismiss({
      sessionId: root.id,
      offerId: initial.offer.id,
      promptOnly: true,
    });
    assert.equal(
      (await service.view({ sessionId: root.id })).offer.promptDismissed,
      true,
    );
    assert.equal(
      requests.length,
      beforeMetadata,
      "View/dismiss created a background model request",
    );
    phase("confirmed Start all while original request stays parked");
    const request = {
      sessionId: root.id,
      offerId: initial.offer.id,
      taskIds: initial.offer.tasks.map((task) => task.id),
      mode: "isolated",
    };
    const [accepted, replayed] = await Promise.all([
      service.accept(request),
      service.accept(request),
    ]);
    assert(
      accepted.results.length === 2 &&
        accepted.results.every((row) => row.status === "started"),
      JSON.stringify(accepted),
    );
    assert(replayed.results.every((row) => row.status === "started"));
    assert.equal(
      root.status,
      "running",
      "Start all interrupted the original task",
    );
    const workerIds = accepted.results.map((row) => row.childId);
    assert.equal(new Set(workerIds).size, 2);
    const workers = await Promise.all(
      workerIds.map(async (id) => {
        const agent = (await ctx.sessionController.resolveAgent(id)).agent;
        owned.push(agent);
        await wait(agent.whenIdle());
        return agent;
      }),
    );
    assert.notEqual(
      workers[0].session.header.cwd,
      workers[1].session.header.cwd,
    );
    for (const [i, agent] of workers.entries()) {
      assert.equal(
        ctx.permissionPresets.current(agent.session),
        "workspace-write",
      );
      assert.equal(
        fs
          .readFileSync(
            path.join(agent.session.header.cwd, "result.txt"),
            "utf8",
          )
          .replace(/^\uFEFF/, "")
          .trim(),
        [alpha, beta][i],
      );
      assert(
        tools.some(
          (call) =>
            call.sessionId === agent.id &&
            ["write", "pwsh"].includes(call.name),
        ),
        "No actual native worker write observed",
      );
      assert(
        !fs.existsSync(path.join(agent.session.header.cwd, "local-note.txt")),
      );
    }
    assert.equal(ctx.workingDirectory.get(root.session), cwd);
    assert(
      !fs.existsSync(path.join(cwd, "result.txt")),
      "The original source checkout was modified",
    );
    assert.equal(
      fs.readFileSync(path.join(cwd, "local-note.txt"), "utf8"),
      "source note stays here\n",
    );
    assert.equal(
      (await ctx.nestedSessions.list({ sessionId: root.id })).links.length,
      2,
    );
    while (true) {
      signal.throwIfAborted();
      const family = await ctx.nestedSessions.list({ sessionId: root.id });
      if (family.links.every((link) => link.lastReportedSeq !== undefined))
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    release.resolve();
    offGate();
    offGate = undefined;
    await wait(root.whenIdle());
    offWrites();
    assert(
      root.session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === "assistant/message" &&
            JSON.stringify(event.data.message.content).includes(
              "MAIN_CONTINUES",
            ),
        ),
    );
    phase("real model proposal and human queue in current conversation");
    const here = await create("在这里执行的确认验收");
    const hereCode = "HERE-" + randomUUID().slice(0, 8);
    await prompt(
      here,
      `Call propose_followups with one optional task titled "Optional here", prompt "Create here.txt in your current workspace containing exactly ${hereCode}. Preserve all other files. Do not delegate or propose more tasks. Reply DONE_HERE." Do not execute it now. Then reply OFFERED_HERE.`,
    );
    await wait(here.whenIdle());
    const hereOffer = (await service.view({ sessionId: here.id })).offer;
    assert(
      hereOffer?.tasks.length === 1 &&
        !fs.existsSync(path.join(cwd, "here.txt")),
    );
    const queued = await service.accept({
      sessionId: here.id,
      offerId: hereOffer.id,
      taskIds: [hereOffer.tasks[0].id],
      mode: "here",
    });
    assert.equal(queued.results[0].status, "here", JSON.stringify(queued));
    await wait(here.whenIdle());
    assert.equal(
      fs
        .readFileSync(path.join(cwd, "here.txt"), "utf8")
        .replace(/^\uFEFF/, "")
        .trim(),
      hereCode,
    );
    assert(
      here.session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === "user/message" &&
            event.data.source?.kind === "user" &&
            event.data.source.rpcId === hereOffer.tasks[0].id,
        ),
    );
    const rootId = root.id;
    await service.preferences({ enabled: false });
    phase("cold metadata read and preference dismissal without activation");
    await runtime.shutdown.shutdown(0);
    runtime = undefined;
    await open();
    assert(
      !ctx.agents.get(rootId),
      "The cold source agent was activated during boot",
    );
    assert.equal(
      (await service.preferences()).promptSuggestions,
      false,
      "The disabled preference did not survive host restart",
    );
    const beforeCold = requests.length;
    const cold = await service.view({ sessionId: rootId });
    assert(
      cold.offer && cold.offer.tasks.every((task) => task.status === "started"),
    );
    await service.dismiss({
      sessionId: rootId,
      offerId: cold.offer.id,
      promptOnly: true,
    });
    assert(
      !ctx.agents.get(rootId),
      "Cold dismissal activated the source agent",
    );
    assert.equal(
      requests.length,
      beforeCold,
      "Cold metadata operations called a model",
    );
    const history = JSON.stringify(
      (await ctx.sessionController.inspect(rootId)).events,
    );
    await runtime.shutdown.shutdown(0);
    runtime = undefined;
    fs.writeFileSync(
      overlay,
      JSON.stringify([
        { id: "desktop-product-telemetry", disabled: true },
        { id: "product-analytics", disabled: true },
        { id: "dsh-memory", disabled: true },
        { id: "follow-ups", disabled: true },
        { id: "follow-ups-proof", disabled: true },
      ]),
    );
    runtime = await runProfile({
      environment: loadLayeredEnv("dsh"),
      profile: "desktop",
      patchFiles: [overlay],
      args: ["--port", "0", "--no-open"],
    });
    ctx = runtime.ctx;
    assert.equal(ctx.get("followUps"), undefined);
    assert.equal(
      JSON.stringify((await ctx.sessionController.inspect(rootId)).events),
      history,
      "Native persistence must cold-read the same history without the follow-up plugin",
    );
    assert(!ctx.agents.get(rootId));
    result = {
      passed: true,
      actualModelProposal: true,
      noExecutionBeforeApproval: true,
      originalTaskKeptRunning: true,
      startAllSeparateNativeWorktrees: true,
      duplicateConfirmationDidNotRepeat: true,
      nativeWorkerWritesVerified: true,
      sourceDirectoryAndIgnoredNotePreserved: true,
      childPermissionsPreserved: true,
      hereWasHumanQueue: true,
      coldViewAndDismissDoNotActivateOrInfer: true,
      rootSessionId: rootId,
      workerIds,
      promptPreferenceSurvivedRestart: true,
      historyReadableWithoutPlugin: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          error: error.message,
          tools,
          requestCount: requests.length,
          sessionIds: owned.map((agent) => agent.id),
          lastReplies: owned.map((agent) => ({
            id: agent.id,
            content: agent.session
              .snapshotEvents()
              .findLast((event) => event.type === "assistant/message")
              ?.data.message.content.filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("")
              .slice(0, 2000),
          })),
        },
        null,
        2,
      ).replaceAll(process.env.OPENAI_API_KEY, "<redacted>"),
    );
    throw error;
  } finally {
    release?.resolve();
    offGate?.();
    if (runtime) {
      for (const agent of owned)
        if (agent.status === "running")
          agent.cancel({ kind: "user" }, { keepInbox: false });
      await runtime.shutdown.shutdown(0);
    }
  }
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log("FOLLOW_UPS_PASS " + JSON.stringify(result));
}
if (require.main === module)
  withOutputLock(output, () =>
    withAgentTestHomeLock(process.env.DSH_HOME, main),
  )
    .then(() =>
      process.stdout.write("", () => process.exit(process.exitCode ?? 0)),
    )
    .catch((error) => {
      console.error(error.stack);
      process.stderr.write("", () => process.exit(1));
    });
