const fs = require("node:fs"),
  path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { withAgentTestHomeLock } = require("./test-home.cjs");
const { withOutputLock } = require("./test-output-lock.cjs");
const output = path.resolve(__dirname, "../.local/btw-concurrency-test");

async function main() {
  assert(
    process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT,
    "Use btw-test with an isolated installed home and proxy key",
  );
  for (const name of ["result.json", "failure.json"])
    fs.rmSync(path.join(output, name), { force: true });
  const cwd = path.join(output, "project-" + Date.now());
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "AGENTS.md"),
    "Synthetic side-conversation acceptance. Use only an explicitly requested local read. Do not edit files, save memory or delegate.",
  );
  const overlay = path.join(output, "runtime.patch.yml");
  fs.writeFileSync(
    overlay,
    JSON.stringify([
      { id: "desktop-product-telemetry", disabled: true },
      { id: "product-analytics", disabled: true },
      { id: "dsh-memory", disabled: true },
    ]),
  );
  const native = process.env.DSH_NATIVE_ROOT;
  const { runProfile } = await import(
    pathToFileURL(path.join(native, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(native, "dsh-app-boot/lib/index.js"))
  );
  const signal = AbortSignal.timeout(360000),
    started = Date.now();
  const mainCode = "FROST-" + randomUUID().slice(0, 8),
    sideCode = "SIDE-" + randomUUID().slice(0, 8);
  const workCode = "WORK-" + randomUUID().slice(0, 8);
  fs.writeFileSync(path.join(cwd, "main-work.txt"), workCode);
  let runtime, ctx, parent, release, unpark, result;
  const requests = [],
    toolCalls = [];
  const phase = (name) =>
    fs.writeFileSync(
      path.join(output, "progress.json"),
      JSON.stringify({
        phase: name,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
      }),
    );
  const open = async () => {
    runtime = await runProfile({
      environment: loadLayeredEnv("dsh"),
      profile: "desktop",
      patchFiles: [overlay],
      args: ["--port", "0", "--no-open"],
    });
    ctx = runtime.ctx;
    ctx.on("llm/stream", (options, next) => {
      if (!options.purpose)
        requests.push({
          sessionId: options.sessionId,
          tools: options.tools?.length ?? 0,
          toolNames: options.tools?.map((tool) => tool.name) ?? [],
          sideCodePresent: JSON.stringify(options.messages).includes(sideCode),
        });
      return next();
    });
    ctx.on("tools/execute", async (exec, next) => {
      toolCalls.push({ sessionId: exec.agent?.id, name: exec.name });
      return next();
    });
  };
  const prompt = async (text) => {
    await ctx.sessionController.prompt(
      {
        sessionId: parent.id,
        requestId: randomUUID(),
        mode: "queue",
        content: [{ type: "text", text }],
      },
      signal,
    );
    await Promise.race([
      parent.whenIdle(),
      new Promise((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    ]);
  };
  const reply = () =>
    parent.session
      .snapshotEvents()
      .findLast((e) => e.type === "assistant/message");
  try {
    await open();
    phase("seed");
    const workspace = await ctx.workspaceRegistry.create(
      cwd,
      "BTW concurrency acceptance",
    );
    const created = await ctx.sessionController.create({
      workspaceId: workspace.id,
    });
    parent = (await ctx.sessionController.resolveAgent(created.sessionId))
      .agent;
    await ctx.sessionController.rename({
      sessionId: parent.id,
      title: "旁问并发验收",
    });
    ctx.permissionPresets.set(parent.session, "read-only");
    await prompt(
      `The main verification code is ${mainCode}. Reply exactly MAIN_SEED_READY. Do not use tools or store memory.`,
    );
    const entered = Promise.withResolvers();
    release = Promise.withResolvers();
    let turnSignal;
    unpark = parent.ctx.on(
      "agent/request",
      async ({ signal: heldSignal }, next) => {
        turnSignal = heldSignal;
        entered.resolve();
        let aborted;
        try {
          await Promise.race([
            release.promise,
            new Promise((_, reject) => {
              aborted = () => reject(heldSignal.reason);
              heldSignal.addEventListener("abort", aborted, { once: true });
            }),
          ]);
        } finally {
          heldSignal.removeEventListener("abort", aborted);
        }
        return next();
      },
      { prepend: true },
    );
    const mainPending = prompt(
      "Use only the read tool (or run_code wrapping read) to read main-work.txt. Reply MAIN_CONTINUED followed by the file token. Do not use other tools or delegate.",
    );
    void mainPending.catch(() => {});
    await Promise.race([
      entered.promise,
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
    assert.equal(parent.status, "running");
    phase("concurrent side question");
    const side = await ctx.commands.execute(
      parent,
      `/btw What was the main verification code from our completed conversation? Echo that code and this side-only tag: ${sideCode}. No tools.`,
      [],
      signal,
    );
    assert.equal(side.result.kind, "success", JSON.stringify(side.result));
    assert(
      requests.some((row) => row.sessionId !== parent.id),
      "No side provider request",
    );
    assert(
      requests
        .filter((row) => row.sessionId !== parent.id)
        .every((row) => row.tools === 0),
      "Side model request exposed tools",
    );
    assert(
      side.result.text.includes(mainCode) &&
        side.result.text.includes(sideCode),
      "Side reply did not inherit the completed main context",
    );
    assert.equal(
      parent.status,
      "running",
      "Side question stopped the main task",
    );
    assert(!turnSignal.aborted, "Side question aborted the main turn");
    assert(
      !parent.inbox.nextTurn.some((message) =>
        JSON.stringify(message).includes(sideCode),
      ),
    );
    release.resolve();
    phase("main resumed");
    unpark();
    unpark = undefined;
    await mainPending;
    assert(
      JSON.stringify(reply()).includes("MAIN_CONTINUED") &&
        JSON.stringify(reply()).includes(workCode),
    );
    await prompt("Reply exactly MAIN_NEXT_OK. Do not use tools.");
    const mainRequests = requests.filter((row) => row.sessionId === parent.id);
    const sideRequests = requests.filter((row) => row.sessionId !== parent.id);
    assert(
      mainRequests.length >= 3,
      "Did not observe actual main provider requests",
    );
    assert(
      mainRequests.every((row) => !row.sideCodePresent),
      "Side transcript entered main provider context",
    );
    assert(
      sideRequests.some((row) => row.sideCodePresent),
      "Did not observe an actual side provider request",
    );
    assert(
      sideRequests.every((row) => row.tools === 0),
      "Side model request exposed tools",
    );
    assert.equal(
      toolCalls.filter((call) => call.sessionId !== parent.id).length,
      0,
      "Side question executed a tool",
    );
    assert(
      toolCalls.some(
        (call) => call.sessionId === parent.id && call.name === "read",
      ),
      "Main task did not execute its actual read tool",
    );
    await ctx.sessions.flush(parent.session);
    const id = parent.id;
    await runtime.shutdown.shutdown(0);
    runtime = undefined;
    await open();
    phase("side follow-up after restart");
    parent = (await ctx.sessionController.resolveAgent(id)).agent;
    const history = await ctx.commands.execute(
      parent,
      "/btw-history",
      [],
      signal,
    );
    assert.equal(history.result.kind, "success");
    assert(
      history.result.text.includes(sideCode),
      "Restart lost the durable side history",
    );
    const continued = await ctx.commands.execute(
      parent,
      "/btw Return the side-only tag from my earlier side question. No tools.",
      [],
      signal,
    );
    assert.equal(
      continued.result.kind,
      "success",
      JSON.stringify(continued.result),
    );
    assert(
      continued.result.text.includes(sideCode),
      "Side follow-up lost its persisted thread",
    );
    assert.equal(ctx.permissionPresets.current(parent.session), "read-only");
    assert(
      requests
        .filter((row) => row.sessionId !== parent.id)
        .every((row) => row.tools === 0),
      "Side follow-up exposed tools",
    );
    assert.equal(
      toolCalls.filter((call) => call.sessionId !== parent.id).length,
      0,
      "Side follow-up executed a tool",
    );
    result = {
      passed: true,
      sessionId: id,
      inheritedCompletedContext: true,
      mainNotInterrupted: true,
      mainResumedThroughProxy: true,
      sideTranscriptExcludedFromMainRequests: true,
      sideProviderHadNoTools: true,
      sideNoToolExecution: true,
      mainReadToolCompleted: true,
      durableSideHistory: true,
      sideFollowupAfterRestart: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        { error: error.message, sessionId: parent?.id, requests },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    release?.resolve();
    unpark?.();
    if (runtime) {
      for (const agent of ctx.agents.list())
        if (agent.status === "running")
          agent.cancel({ kind: "user" }, { keepInbox: false });
      await runtime.shutdown.shutdown(0);
    }
  }
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log("BTW_CONCURRENCY_PASS " + JSON.stringify(result));
}
if (require.main === module)
  withOutputLock(output, () =>
    withAgentTestHomeLock(process.env.DSH_HOME, main),
  ).catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
