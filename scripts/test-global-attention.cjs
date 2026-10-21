const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { withAgentTestHomeLock } = require("./test-home.cjs");
const { withOutputLock } = require("./test-output-lock.cjs");
const output = path.resolve(__dirname, "../.local/global-attention-test");

async function main() {
  assert(
    process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT,
    "Use attention-test with an isolated installed home and proxy key",
  );
  for (const name of ["result.json", "failure.json"])
    fs.rmSync(path.join(output, name), { force: true });
  const root = process.env.DSH_NATIVE_ROOT;
  const { runProfile } = await import(
    pathToFileURL(path.join(root, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(root, "dsh-app-boot/lib/index.js"))
  );
  const overlay = path.join(output, "runtime.patch.yml"),
    project = path.join(output, "project-" + Date.now());
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, "AGENTS.md"),
    "Synthetic session status acceptance. Reply only as requested; no tools, memory, network, delegation or file operations.",
  );
  const base = [
    { id: "desktop-product-telemetry", disabled: true },
    { id: "product-analytics", disabled: true },
    { id: "dsh-memory", disabled: true },
  ];
  const started = Date.now(),
    signal = AbortSignal.timeout(240000),
    ids = {},
    hashes = {};
  let runtime,
    ctx,
    modelCalls = 0,
    result;
  const open = async (legacy) => {
    fs.writeFileSync(
      overlay,
      JSON.stringify([
        ...base,
        ...(legacy ? [{ id: "nested-sessions", disabled: true }] : []),
      ]),
    );
    runtime = await runProfile({
      environment: loadLayeredEnv("dsh"),
      profile: "desktop",
      patchFiles: [overlay],
      args: ["--port", "0", "--no-open"],
    });
    ctx = runtime.ctx;
    ctx.on("llm/stream", (options, next) => {
      if (!options.purpose) modelCalls++;
      return next();
    });
  };
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
  const prompt = async (agent, text) => {
    await ctx.sessionController.prompt(
      {
        sessionId: agent.id,
        requestId: randomUUID(),
        mode: "queue",
        content: [{ type: "text", text }],
      },
      signal,
    );
    await idle(agent);
  };
  const digest = (events) =>
    createHash("sha256").update(JSON.stringify(events)).digest("hex");
  try {
    await open(true);
    const workspace = await ctx.workspaceRegistry.create(
      project,
      "Global attention acceptance",
    );
    const create = async (title) => {
      const created = await ctx.sessionController.create({
        workspaceId: workspace.id,
      });
      await ctx.sessionController.rename({
        sessionId: created.sessionId,
        title,
      });
      const agent = (
        await ctx.sessionController.resolveAgent(created.sessionId)
      ).agent;
      ctx.permissionPresets.set(agent.session, "read-only");
      return agent;
    };
    const completed = await create("状态验收：已完成");
    ids.completed = completed.id;
    await prompt(
      completed,
      "Reply exactly GLOBAL_ATTENTION_COMPLETE. No tools.",
    );
    assert(
      completed.session
        .snapshotEvents()
        .some(
          (e) =>
            e.type === "assistant/message" &&
            e.data.message.content.some(
              (b) =>
                b.type === "text" &&
                b.text.trim() === "GLOBAL_ATTENTION_COMPLETE",
            ),
        ),
    );
    const stopped = await create("状态验收：用户停止");
    ids.stopped = stopped.id;
    const entered = Promise.withResolvers();
    const off = stopped.ctx.on(
      "agent/request",
      async ({ signal: turnSignal }, next) => {
        entered.resolve();
        await new Promise((_, reject) => {
          if (turnSignal.aborted) return reject(turnSignal.reason);
          turnSignal.addEventListener(
            "abort",
            () => reject(turnSignal.reason),
            { once: true },
          );
        });
        return next();
      },
      { prepend: true },
    );
    const pending = prompt(
      stopped,
      "Reply only after the acceptance gate is released.",
    );
    void pending.catch(() => {});
    await Promise.race([
      entered.promise,
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
    stopped.cancel({ kind: "user" }, { keepInbox: false });
    await pending;
    off();
    const failed = await create("状态验收：失败待处理");
    ids.error = failed.id;
    const offError = failed.ctx.on(
      "agent/request",
      () => {
        throw Error("Synthetic expected status failure");
      },
      { prepend: true },
    );
    await prompt(failed, "Reply after the synthetic request check.");
    offError();
    assert.equal(
      failed.session.snapshotEvents().findLast((e) => e.type === "turn/end")
        .data.reason.kind,
      "error",
    );
    for (const agent of [completed, stopped, failed]) {
      assert.equal(
        ctx.get("sessionProjections").snapshot(agent.session).values
          .nestedAttention,
        undefined,
        "Legacy fixture already contained the new projection",
      );
      await ctx.sessions.flush(agent.session);
      hashes[agent.id] = digest(agent.session.snapshotEvents());
    }
    assert(modelCalls > 0, "No real provider call ran");
    await runtime.shutdown.shutdown(0);
    runtime = undefined;
    await open(false);
    const service = await new Promise((resolve) =>
      ctx.inject(["nestedSessions"], (scope) => resolve(scope.nestedSessions)),
    );
    for (const id of Object.values(ids))
      assert.equal(
        ctx.agents.get(id),
        undefined,
        "Cold fixture Agent was already activated",
      );
    const beforeCalls = modelCalls;
    const response = await service.attention({
      sessionIds: Object.values(ids),
    });
    for (const [expected, id] of Object.entries(ids)) {
      assert.equal(
        response.rows.find((row) => row.sessionId === id)?.status,
        expected,
      );
      assert.equal(
        ctx.agents.get(id),
        undefined,
        "Projection lookup activated a cold Agent",
      );
      const inspected = await ctx.sessionController.inspect(id);
      assert.equal(
        digest(inspected.events),
        hashes[id],
        "Status lookup changed durable history",
      );
    }
    assert.equal(modelCalls, beforeCalls, "Metadata lookup called a model");
    result = {
      passed: true,
      sessionIds: ids,
      legacyHistoriesClassified: true,
      coldAgentsNotActivated: true,
      historiesUnchanged: true,
      noMetadataModelCalls: true,
      completedStoppedErrorDistinct: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify({ error: error.message, ids }, null, 2),
    );
    throw error;
  } finally {
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
  console.log("GLOBAL_ATTENTION_PASS " + JSON.stringify(result));
}
if (require.main === module)
  withOutputLock(output, () =>
    withAgentTestHomeLock(process.env.DSH_HOME, main),
  ).catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
