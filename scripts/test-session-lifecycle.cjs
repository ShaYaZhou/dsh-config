const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { withAgentTestHomeLock } = require("./test-home.cjs");
const { withOutputLock } = require("./test-output-lock.cjs");
const output = path.resolve(__dirname, "../.local/session-lifecycle-test");

async function main() {
  assert(
    process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT,
    "Use lifecycle-test with an isolated installed home and proxy key",
  );
  for (const name of ["result.json", "failure.json"])
    fs.rmSync(path.join(output, name), { force: true });
  const project = path.join(output, "project-" + Date.now());
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(project, "AGENTS.md"),
    "Synthetic lifecycle acceptance. Do not edit files, save memory, access network or delegate. Read only the explicitly requested local fixture.",
  );
  fs.writeFileSync(
    path.join(project, "tool-noise.txt"),
    "PRIVATE_TOOL_NOISE: synthetic diagnostic text, never include it in a reply.\n",
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
  const signal = AbortSignal.timeout(240000),
    started = Date.now();
  let runtime, ctx, service, parent, child, result;
  const messageText = (data) =>
    (data?.message ?? data)?.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n") ?? "";
  const digest = (events) =>
    createHash("sha256").update(JSON.stringify(events)).digest("hex");
  const phase = (value) =>
    fs.writeFileSync(
      path.join(output, "progress.json"),
      JSON.stringify({
        phase: value,
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
    service = await new Promise((resolve) =>
      ctx.inject(["nestedSessions"], (scope) => resolve(scope.nestedSessions)),
    );
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
  };
  const idle = async (agent) => {
    await Promise.race([
      agent.whenIdle(),
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
    await service.tail;
  };
  const park = async (agent, text) => {
    const entered = Promise.withResolvers();
    const off = agent.ctx.on(
      "agent/request",
      async ({ signal: turnSignal }, next) => {
        entered.resolve();
        await new Promise((_, reject) => {
          if (turnSignal.aborted) reject(turnSignal.reason);
          else
            turnSignal.addEventListener(
              "abort",
              () => reject(turnSignal.reason),
              { once: true },
            );
        });
        return next();
      },
    );
    await prompt(agent, text);
    await Promise.race([
      entered.promise,
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
    await service.tail;
    return off;
  };
  try {
    await open();
    phase("booted");
    const workspace = await ctx.workspaceRegistry.create(
      project,
      "Session lifecycle acceptance",
    );
    const created = await ctx.sessionController.create({
      workspaceId: workspace.id,
    });
    parent = (await ctx.sessionController.resolveAgent(created.sessionId))
      .agent;
    ctx.permissionPresets.set(parent.session, "read-only");
    const linked = await service.start({
      sessionId: parent.id,
      title: "Lifecycle worker",
      context: "fresh",
      agentPreset: "explore",
    });
    child = (await ctx.sessionController.resolveAgent(linked.sessionId)).agent;
    assert.equal(ctx.permissionPresets.current(child.session), "read-only");
    const unrelated = await ctx.sessionController.create({ cwd: project });
    await assert.rejects(
      service.send({
        sessionId: child.id,
        targetSessionId: unrelated.sessionId,
        message: "Must not cross family",
      }),
      /outside/,
    );

    let off = await park(parent, "CURRENT_TASK: do not execute tools.");
    const prefix = parent.session.snapshotEvents();
    await service.send({
      sessionId: child.id,
      targetSessionId: parent.id,
      message: "QUEUED_SIDE_NOTE",
    });
    assert.equal(
      parent.inbox.nextTurn.length,
      1,
      "Explicit message did not queue after current turn",
    );
    assert.equal(
      parent.inbox.nextStep.length,
      0,
      "Explicit message steered the current turn",
    );
    assert(
      JSON.stringify(parent.inbox.nextTurn).includes(child.id),
      "Queued message lost sender identity",
    );
    await ctx.sessionController.cancel({ sessionId: parent.id });
    await assert.rejects(
      service.send({
        sessionId: child.id,
        targetSessionId: parent.id,
        message: "Cannot race native cancel",
      }),
      /user stopped/i,
    );
    await idle(parent);
    off();
    assert.equal(parent.status, "idle");
    assert.equal(
      parent.inbox.nextTurn.length,
      1,
      "Native UI cancel should retain its queued work",
    );
    await service.stop({ sessionId: parent.id });
    assert.equal(
      parent.inbox.nextTurn.length + parent.inbox.nextStep.length,
      0,
    );
    await assert.rejects(
      service.send({
        sessionId: child.id,
        targetSessionId: parent.id,
        message: "Cannot wake stopped parent",
      }),
      /user stopped/i,
    );
    assert.equal(
      digest(parent.session.snapshotEvents().slice(0, prefix.length)),
      digest(prefix),
    );

    off = await park(
      parent,
      "HUMAN_RESUME: keep this native request held for lifecycle acceptance.",
    );
    assert.equal(
      (await service.read({ sessionId: parent.id })).stoppedByUser,
      false,
      "Human prompt did not clear stopped state",
    );
    phase("real-child-request");
    await prompt(
      child,
      "Use read to read tool-noise.txt, then reply exactly CHILD_COMPLETED. Do not quote the file, use other tools, save memory or delegate.",
    );
    await idle(child);
    const childEvents = child.session.snapshotEvents();
    const end = childEvents.findLast((event) => event.type === "turn/end");
    assert.equal(end.data.reason.kind, "completed");
    assert(
      childEvents.some(
        (event) =>
          ["tool/result", "tool/ptc-dispatch"].includes(event.type) &&
          messageText(event.data).includes("PRIVATE_TOOL_NOISE"),
      ),
      "Child did not actually read the fixture",
    );
    assert(
      (await service.read({ sessionId: child.id })).latestResult.includes(
        "CHILD_COMPLETED",
      ),
    );
    assert.equal(
      parent.inbox.nextStep.length,
      1,
      "Coordinator did not receive exactly one terminal report",
    );
    const report = JSON.stringify(parent.inbox.nextStep);
    assert(report.includes("CHILD_COMPLETED") && report.includes(child.id));
    assert(
      !report.includes("PRIVATE_TOOL_NOISE"),
      "Raw tool output leaked to parent",
    );
    assert(report.length < 9000, "Terminal report was unbounded");
    await service.observe(child.session, end);
    assert.equal(
      parent.inbox.nextStep.length,
      1,
      "Duplicate completion delivered twice",
    );
    await service.stop({ sessionId: parent.id });
    await idle(parent);
    off();
    const parentLength = parent.session.snapshotEvents().length;
    await prompt(child, "Reply exactly SECOND_CHILD_COMPLETED. No tools.");
    await idle(child);
    assert.equal(parent.status, "idle");
    assert.equal(
      parent.inbox.nextTurn.length + parent.inbox.nextStep.length,
      0,
    );
    assert.equal(
      parent.session.snapshotEvents().length,
      parentLength,
      "Completion woke a stopped parent",
    );

    phase("archive-and-restart");
    const childPrefix = child.session.snapshotEvents(),
      childHash = digest(childPrefix);
    await ctx.workspaceRegistry.archiveSession(parent.id);
    assert(
      (await ctx.sessionController.list({})).items.some(
        (row) => row.sessionId === child.id,
      ),
      "Parent archive hid child history from roster",
    );
    await assert.rejects(
      service.send({
        sessionId: child.id,
        targetSessionId: parent.id,
        message: "Archived parent",
      }),
      /Archived/,
    );
    await ctx.workspaceRegistry.unarchiveSession(parent.id);
    await ctx.workspaceRegistry.archiveSession(child.id);
    await assert.rejects(
      service.send({
        sessionId: parent.id,
        targetSessionId: child.id,
        message: "Archived child",
      }),
      /Archived/,
    );
    assert(
      (await service.read({ sessionId: child.id })).latestResult.includes(
        "SECOND_CHILD_COMPLETED",
      ),
    );
    await ctx.workspaceRegistry.unarchiveSession(child.id);
    await ctx.sessionController.rename({
      sessionId: child.id,
      title: "Lifecycle worker preserved",
    });
    assert.equal(
      (await ctx.sessionController.list({})).items.find(
        (row) => row.sessionId === child.id,
      ).projections.values.title,
      "Lifecycle worker preserved",
    );
    assert.equal(
      digest(child.session.snapshotEvents().slice(0, childPrefix.length)),
      childHash,
    );
    await ctx.sessions.flush(child.session);
    await ctx.sessions.flush(parent.session);
    const ids = { parent: parent.id, child: child.id };
    await runtime.shutdown.shutdown(0);
    runtime = undefined;
    await open();
    const list = await service.list({ sessionId: ids.parent });
    assert(
      list.links.some(
        (link) => link.sessionId === ids.child && link.parentId === ids.parent,
      ),
    );
    const cold = await ctx.sessionController.inspect(ids.child);
    assert.equal(
      digest(cold.events.slice(0, childPrefix.length)),
      childHash,
      "Restart lost child history",
    );
    parent = (await ctx.sessionController.resolveAgent(ids.parent)).agent;
    assert((await service.read({ sessionId: parent.id })).stoppedByUser);
    await prompt(
      parent,
      "Reply exactly PARENT_RESUMED. Do not use tools or delegate.",
    );
    await idle(parent);
    assert(
      (await service.read({ sessionId: parent.id })).latestResult.includes(
        "PARENT_RESUMED",
      ),
    );
    assert(!(await service.read({ sessionId: parent.id })).stoppedByUser);
    assert.equal(ctx.permissionPresets.current(parent.session), "read-only");
    phase("explicit-local-history");
    const otherCwd = path.join(output, "other-project-" + Date.now());
    fs.mkdirSync(otherCwd, { recursive: true });
    fs.writeFileSync(
      path.join(otherCwd, "AGENTS.md"),
      "Synthetic history source. Do not use tools, edit files or store memory.",
    );
    const otherWorkspace = await ctx.workspaceRegistry.create(
      otherCwd,
      "Cross-workspace history source",
    );
    const createdSource = await ctx.sessionController.create({
      workspaceId: otherWorkspace.id,
    });
    const source = (
      await ctx.sessionController.resolveAgent(createdSource.sessionId)
    ).agent;
    const sourceTitle = "Local history source " + Date.now();
    const historyToken = "HISTORY-" + randomUUID().slice(0, 8);
    await ctx.sessionController.rename({
      sessionId: source.id,
      title: sourceTitle,
    });
    ctx.permissionPresets.set(source.session, "read-only");
    await prompt(
      source,
      "Reply exactly " +
        historyToken +
        ". Do not use tools, delegate or save memory.",
    );
    await idle(source);
    const archived = await ctx.sessionController.fork({ sessionId: source.id });
    await ctx.workspaceRegistry.archiveSession(archived.sessionId);
    const sourceHash = digest(source.session.snapshotEvents());
    await assert.rejects(
      service.recent({ sessionId: parent.id }),
      /local-history/,
    );
    await service.localAccess({ sessionId: parent.id, enabled: true });
    await assert.rejects(
      service.recent({ sessionId: ids.child }),
      /local-history/,
    );
    const recent = await service.recent({ sessionId: parent.id, limit: 20 });
    assert(recent.sessions.some((row) => row.sessionId === source.id));
    assert(
      !recent.sessions.some((row) => row.sessionId === archived.sessionId),
    );
    const historyCalls = [];
    const stopHistoryCapture = ctx.on("tools/execute", async (exec, next) => {
      if (exec.agent?.id === parent.id)
        historyCalls.push({ name: exec.name, arguments: exec.arguments });
      return next();
    });
    await prompt(
      parent,
      `Use only list_recent_sessions and read_local_session (or run_code wrapping those tools). Find the conversation titled "${sourceTitle}" in another workspace and read its verification token. Return LOCAL_HISTORY_PROXY_OK followed by that token. Do not use files, shell, native session search, delegate, or send messages.`,
    );
    await idle(parent);
    stopHistoryCapture();
    assert(historyCalls.some((call) => call.name === "list_recent_sessions"));
    assert(
      historyCalls.some(
        (call) =>
          call.name === "read_local_session" &&
          call.arguments.session_id === source.id,
      ),
    );
    assert(
      historyCalls.every((call) =>
        ["run_code", "list_recent_sessions", "read_local_session"].includes(
          call.name,
        ),
      ),
    );
    const historyReply = (await service.read({ sessionId: parent.id }))
      .latestResult;
    assert(
      historyReply.includes("LOCAL_HISTORY_PROXY_OK") &&
        historyReply.includes(historyToken),
    );
    assert.equal(
      digest(source.session.snapshotEvents()),
      sourceHash,
      "History read modified the source conversation",
    );
    assert.equal(source.status, "idle");
    await assert.rejects(
      service.send({
        sessionId: parent.id,
        targetSessionId: source.id,
        message: "No control grant",
      }),
      /family|linked/i,
    );
    await ctx.sessions.flush(source.session);
    await ctx.sessions.flush(parent.session);
    await runtime.shutdown.shutdown(0);
    runtime = undefined;
    await open();
    await assert.rejects(
      service.recent({ sessionId: ids.parent }),
      /local-history/,
    );
    assert(
      !ctx.agents.get(source.id),
      "Source unexpectedly resumed at restart",
    );
    await service.localAccess({ sessionId: ids.parent, enabled: true });
    assert(
      (
        await service.recent({ sessionId: ids.parent, limit: 20 })
      ).sessions.some((row) => row.sessionId === source.id),
    );
    assert(
      (
        await service.localRead({
          sessionId: ids.parent,
          targetSessionId: source.id,
        })
      ).latestResult.includes(historyToken),
    );
    assert(
      !ctx.agents.get(source.id),
      "Local history read activated the cold source Agent",
    );
    await service.localAccess({ sessionId: ids.parent, enabled: false });
    await service.detach({ sessionId: ids.child });
    assert(
      !(await service.list({ sessionId: ids.parent })).links.some(
        (link) => link.sessionId === ids.child,
      ),
    );
    assert.equal(
      digest(
        (await ctx.sessionController.inspect(ids.child)).events.slice(
          0,
          childPrefix.length,
        ),
      ),
      childHash,
      "Detach removed history",
    );
    result = {
      passed: true,
      ...ids,
      explicitQueuedAfterTurn: true,
      senderAttributed: true,
      terminalReportOnce: true,
      toolOutputStayedLocal: true,
      stopClearedQueue: true,
      nativeCancelRetainedQueueWithoutWake: true,
      stoppedParentNotRevived: true,
      archiveRetainsHistory: true,
      restartRetainsRelations: true,
      humanResumeThroughProxy: true,
      readOnlyPermissionRetained: true,
      detachRetainsHistory: true,
      localHistorySource: source.id,
      localHistoryExplicitPerCaller: true,
      localHistoryReadThroughProxy: true,
      localHistoryNoControlGrant: true,
      localHistoryResetOnRestart: true,
      localHistoryColdSourceNotActivated: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        { error: error.message, parent: parent?.id, child: child?.id },
        null,
        2,
      ),
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
  console.log("SESSION_LIFECYCLE_PASS " + JSON.stringify(result));
}
if (require.main === module)
  withOutputLock(output, () =>
    withAgentTestHomeLock(process.env.DSH_HOME, main),
  ).catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
