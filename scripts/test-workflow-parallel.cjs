const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { withAgentTestHomeLock } = require("./test-home.cjs");

async function main() {
  assert(process.env.OPENAI_API_KEY, "Real model credential required");
  const home = process.env.DSH_HOME;
  const output = path.join(home, "parallel-acceptance-" + Date.now());
  fs.mkdirSync(output, { recursive: true });
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
  const timeline = [],
    calls = [],
    reports = [];
  const workflowResults = new Map();
  ctx.on("tools/result", (exec, result) => {
    if (exec.name === "workflow") workflowResults.set(exec.agent.id, result);
  });
  const save = () =>
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify({ reports, timeline, calls }, null, 2),
    );
  ctx.on("workflow/agent-start", (run, info) => {
    timeline.push({ type: "start", runId: run.id, ...info, time: Date.now() });
    save();
  });
  ctx.on("workflow/agent-end", (run, info) => {
    timeline.push({ type: "end", runId: run.id, ...info, time: Date.now() });
    save();
  });
  ctx.on("tools/execute", async (exec, next) => {
    calls.push({ agentId: exec.agent?.id, name: exec.name, time: Date.now() });
    save();
    return next();
  });
  async function dispatch(parent, args) {
    workflowResults.delete(parent.id);
    const beforeRuns = parent.session
      .snapshotEvents()
      .filter((e) => e.type === "tool-workflow/run-start").length;
    await ctx.sessionController.prompt(
      {
        sessionId: parent.id,
        requestId: randomUUID(),
        mode: "queue",
        content: [
          {
            type: "text",
            text:
              "Synthetic acceptance. Call workflow exactly once with these arguments unchanged. In PTC use the required JSON envelope. You may correct a syntax or JSON transport error only before any workflow starts. After the workflow returns or refuses execution, report it and stop; no retries, repairs, extra workflows or other tools.\n" +
              JSON.stringify(args),
          },
        ],
      },
      AbortSignal.timeout(300000),
    );
    await parent.whenIdle();
    const result = workflowResults.get(parent.id);
    assert(result, "Model did not invoke workflow");
    assert.equal(
      parent.session
        .snapshotEvents()
        .filter((e) => e.type === "tool-workflow/run-start").length -
        beforeRuns,
      1,
      "Duplicate workflow dispatch",
    );
    return result;
  }
  try {
    for (const preset of ["standard", "ptc"]) {
      const cwd = path.join(output, preset);
      fs.mkdirSync(cwd);
      const git = (...args) =>
        execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
      git("init", "-q");
      fs.writeFileSync(
        path.join(cwd, "evidence.txt"),
        "Independent evidence: 1729\n",
      );
      fs.writeFileSync(
        path.join(cwd, "AGENTS.md"),
        "Synthetic acceptance. Stay inside the assigned workspace. No network, memory, browser, extra workers or repository pushes. Perform only the requested small task. Report any refusal and stop.",
      );
      git("add", ".");
      git(
        "-c",
        "user.name=Acceptance",
        "-c",
        "user.email=acceptance@example.invalid",
        "commit",
        "-qm",
        "baseline",
      );
      const workspace = await ctx.workspaceRegistry.create(
        cwd,
        "Parallel " + preset,
      );
      const made = await ctx.sessionController.create({
        workspaceId: workspace.id,
        agentPreset: preset,
      });
      const { agent: parent } = await ctx.sessionController.resolveAgent(
        made.sessionId,
      );
      ctx.permissionPresets.set(parent.session, "workspace-write");
      assert(ctx.get("ultracodeState").requiresWorkflow(parent));
      const trees = await Promise.all(
        [1, 2].map(() =>
          ctx.worktrees.create(
            parent,
            { enter: false },
            AbortSignal.timeout(60000),
          ),
        ),
      );
      assert.equal(
        ctx.workingDirectory.get(parent.session),
        cwd,
        "Preparation changed coordinator cwd",
      );
      assert.equal(trees[0].baseCommit, trees[1].baseCommit);
      async function run(name, script) {
        const before = Date.now();
        const args = {
          meta: { name, description: "Parallel safety acceptance" },
          script,
          budget_ms: 240000,
          run_in_background: false,
        };
        const response = await dispatch(parent, args);
        const result = response.value;
        const row = {
          preset,
          name,
          runId: result?.runId,
          durationMs: Date.now() - before,
          result,
          responseError: response.isError ? response : undefined,
        };
        reports.push(row);
        save();
        assert(!response.isError, JSON.stringify(response));
        return row;
      }
      if (process.env.DSH_PARALLEL_RECOVERY_ONLY !== "1") {
        const preference = await ctx.commands.execute(
          parent,
          "/collaborate on",
          [],
          AbortSignal.timeout(30000),
        );
        assert.equal(preference.result.kind, "success");
        const mixed = await run(
          "mixed-executors",
          "return await parallel([()=>agent('Read evidence.txt and return the number.',{read_only:true,session:'subagent'}),()=>agent('Read evidence.txt and return twice the number.',{read_only:true,session:'linked'})]);",
        );
        const family = (
          await ctx.get("nestedSessions").list({ sessionId: parent.id })
        ).links;
        assert.equal(
          family.length,
          1,
          "Temporary stages became persistent sessions",
        );
        assert.equal(family[0].wakeParent, false);
        const starts = timeline.filter(
          (e) => e.runId === mixed.runId && e.type === "start",
        );
        const ends = timeline.filter(
          (e) => e.runId === mixed.runId && e.type === "end",
        );
        assert.equal(starts.length, 2);
        assert.equal(ends.length, 2);
        assert(
          Math.max(...starts.map((e) => e.time)) <
            Math.min(...ends.map((e) => e.time)),
        );
        mixed.retainedSessions = family.length;
        const followupAt = Date.now();
        const runCount = parent.session
          .snapshotEvents()
          .filter((e) => e.type === "tool-workflow/run-start").length;
        fs.writeFileSync(
          path.join(cwd, "evidence.txt"),
          "Independent evidence: 1730\n",
        );
        await ctx.sessionController.prompt(
          {
            sessionId: parent.id,
            requestId: randomUUID(),
            mode: "queue",
            content: [
              {
                type: "text",
                text: `Ask the existing linked session ${family[0].sessionId} to read evidence.txt again and return the current number. Send the clarification through send_session_message, wait for its new answer and report it. This is a read-only follow-up to the existing conversation: do not create a workflow or another worker, do not write files, and do not reuse the old answer.`,
              },
            ],
          },
          AbortSignal.timeout(120000),
        );
        await parent.whenIdle();
        const final = parent.session
          .snapshotEvents()
          .findLast((e) => e.type === "assistant/message");
        const answer = final.data.message.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        assert.match(answer, /1730/);
        assert(
          calls.some(
            (c) =>
              c.agentId === family[0].sessionId &&
              c.name === "read" &&
              c.time >= followupAt,
          ),
        );
        assert.equal(
          parent.session
            .snapshotEvents()
            .filter((e) => e.type === "tool-workflow/run-start").length,
          runCount,
        );
        mixed.followupRead = true;
        fs.writeFileSync(
          path.join(cwd, "evidence.txt"),
          "Independent evidence: 1729\n",
        );
        await ctx.commands.execute(
          parent,
          "/collaborate auto",
          [],
          AbortSignal.timeout(30000),
        );
        save();
        if (process.env.DSH_PARALLEL_MIXED_ONLY === "1") continue;
        const read = await run(
          "parallel-read",
          `return await parallel([()=>agent('Read evidence.txt and report the evidence number. Do not write.',{read_only:true}),()=>agent('Read evidence.txt and report twice its evidence number. Do not write.',{read_only:true})]);`,
        );
        const write = await run(
          "parallel-write",
          `return await parallel(${JSON.stringify(trees.map((t) => t.path))}.map(cwd=>()=>agent('Read evidence.txt. Write result.txt containing its evidence number exactly once using the write tool, then report done. Do not commit or use browser.',{cwd})));`,
        );
        for (const row of [read, write]) {
          const spans = timeline
            .filter((e) => e.runId === row.runId && e.type === "start")
            .map((start) => ({
              start: start.time,
              end: timeline.find(
                (e) =>
                  e.runId === row.runId &&
                  e.type === "end" &&
                  e.seq === start.seq,
              )?.time,
              childId: start.childId,
            }));
          assert.equal(spans.length, 2);
          assert(
            spans.every((s) => s.end),
            "Missing completion",
          );
          assert(
            Math.max(...spans.map((s) => s.start)) <
              Math.min(...spans.map((s) => s.end)),
            "Independent workers did not actually overlap",
          );
          row.spans = spans;
          row.overlapMs = Math.min(...spans.map(s => s.end)) - Math.max(...spans.map(s => s.start));
          row.workerWindowMs = Math.max(...spans.map(s => s.end)) - Math.min(...spans.map(s => s.start));
          row.effectiveConcurrency = spans.reduce((sum, s) => sum + s.end - s.start, 0) / row.workerWindowMs;
        }
        for (const tree of trees)
          assert.match(
            fs.readFileSync(path.join(tree.path, "result.txt"), "utf8"),
            /1729/,
          );
        assert(
          !fs.existsSync(path.join(cwd, "result.txt")),
          "Isolated workers wrote the integration checkout",
        );
        for (const row of [read, write]) {
          row.toolCalls = calls.filter((call) =>
            row.spans.some((span) => span.childId === call.agentId),
          ).length;
          row.usage = [];
          for (const span of row.spans) {
            const observation = await ctx
              .get("sessionQuery")
              .observeSession(span.childId, { projectionMode: "all" });
            try {
              row.usage.push({
                childId: span.childId,
                tokenUsage: observation.projections?.values.tokenUsage,
              });
            } finally {
              observation[Symbol.dispose]();
            }
          }
        }
        const integrationPrompt =
          "Read " +
          JSON.stringify(trees.map((t) => path.join(t.path, "result.txt"))) +
          ". Write integrated.json in the delivery checkout with keys a and b containing the two integer values, and baseCommit equal to " +
          trees[0].baseCommit +
          ". Return the output path. No other changes.";
        const integrated = await run(
          "integrate-results",
          `return await agent(${JSON.stringify(integrationPrompt)});`,
        );
        const delivered = JSON.parse(
          fs.readFileSync(path.join(cwd, "integrated.json"), "utf8"),
        );
        assert.deepEqual(delivered, {
          a: 1729,
          b: 1729,
          baseCommit: trees[0].baseCommit,
        });
        integrated.delivered = delivered;
        const conflictMade = await ctx.sessionController.create({
          workspaceId: workspace.id,
          agentPreset: preset,
        });
        const { agent: conflictParent } =
          await ctx.sessionController.resolveAgent(conflictMade.sessionId);
        ctx.permissionPresets.set(conflictParent.session, "workspace-write");
        const counter = path.join(trees[0].path, "counter.txt");
        fs.writeFileSync(counter, "0");
        const independentCounter = path.join(trees[1].path, "counter.txt");
        fs.writeFileSync(independentCounter, "0");
        const prompt =
          "Read counter.txt, write its integer plus one exactly once using read/write tools, and report the value. Do not retry or delegate.";
        const conflictArgs = {
          budget_ms: 180000,
          run_in_background: false,
          meta: {
            name: "conflicting-writers",
            description: "Refuse overlapping writable roots",
          },
          script: `return await parallel([()=>agent(${JSON.stringify(prompt)},{cwd:${JSON.stringify(trees[0].path)},browser:true}),()=>agent(${JSON.stringify(prompt)},{cwd:${JSON.stringify(trees[0].path)}}),()=>agent(${JSON.stringify(prompt)},{cwd:${JSON.stringify(trees[1].path)}}),()=>agent('Read evidence.txt only.',{cwd:${JSON.stringify(trees[1].path)},read_only:true,browser:true})]);`,
        };
        const before = Date.now();
        const denied = await dispatch(conflictParent, conflictArgs);
        assert(denied.isError, "Conflicting writers must not both be admitted");
        assert.equal(
          fs.readFileSync(counter, "utf8").trim(),
          "1",
          "Conflict caused duplicate or absent write",
        );
        assert.equal(
          fs.readFileSync(independentCounter, "utf8").trim(),
          "1",
          "Conflict cancelled unrelated isolated work",
        );
        reports.push({
          preset,
          name: "conflicting-writers",
          expectedFailure: true,
          durationMs: Date.now() - before,
          response: denied,
          counter: 1,
        });
      }
      const recoveryMade = await ctx.sessionController.create({
        workspaceId: workspace.id,
        agentPreset: preset,
      });
      const { agent: recoveryParent } =
        await ctx.sessionController.resolveAgent(recoveryMade.sessionId);
      ctx.permissionPresets.set(recoveryParent.session, "workspace-write");
      for (const tree of trees)
        fs.writeFileSync(path.join(tree.path, "resume-counter.txt"), "0");
      const recoveryPrompt =
        "Read resume-counter.txt, write its integer plus one exactly once with read/write tools, then report the value. Do not retry.";
      const recoveryArgs = {
        budget_ms: 180000,
        run_in_background: false,
        meta: {
          name: "parallel-recovery",
          description: "Replay completed parallel writes before integration",
        },
        script: `const results=await parallel(${JSON.stringify(trees.map((t) => t.path))}.map(cwd=>()=>agent(${JSON.stringify(recoveryPrompt)},{cwd})));const integrated=await agent('Write resume.json containing {"completed":2} using the write tool exactly once. No other changes.');return {results,integrated};`,
      };
      const runtime = ctx.ptcRuntime,
        resolve = runtime.resolve.bind(runtime);
      let injected = false;
      runtime.resolve = (input) =>
        resolve({
          ...input,
          bindings: input.bindings?.map((binding) =>
            binding.global !== "workflowHost"
              ? binding
              : {
                  ...binding,
                  functions: {
                    ...binding.functions,
                    startChild: async (request) => {
                      if (request.seq === 3 && !injected) {
                        injected = true;
                        throw new Error("SYNTHETIC_PRE_ADMISSION_FAILURE");
                      }
                      return binding.functions.startChild(request);
                    },
                  },
                },
          ),
        });
      let failed;
      const recoveryStarted = Date.now();
      try {
        failed = await dispatch(recoveryParent, recoveryArgs);
      } finally {
        runtime.resolve = resolve;
      }
      assert(injected && failed.isError);
      const failedId = recoveryParent.session
        .snapshotEvents()
        .findLast((e) => e.type === "tool-workflow/run-start").data.runId;
      for (const tree of trees)
        assert.equal(
          fs
            .readFileSync(path.join(tree.path, "resume-counter.txt"), "utf8")
            .trim(),
          "1",
        );
      const resumed = await ctx.commands.execute(
        recoveryParent,
        "/workflow resume " + failedId,
        [],
        AbortSignal.timeout(180000),
      );
      assert.equal(resumed.result.kind, "success", JSON.stringify(resumed));
      await recoveryParent.whenIdle();
      const resumedId = recoveryParent.session
        .snapshotEvents()
        .findLast((e) => e.type === "tool-workflow/run-start").data.runId;
      assert.notEqual(resumedId, failedId);
      const priorChildren = new Set(
        timeline
          .filter((e) => e.runId === failedId && e.type === "start")
          .map((e) => e.childId),
      );
      const newChildren = timeline.filter(
        (e) =>
          e.runId === resumedId &&
          e.type === "start" &&
          !priorChildren.has(e.childId),
      );
      assert.equal(
        newChildren.length,
        1,
        "Completed parallel workers were dispatched again",
      );
      const resumedStart = recoveryParent.session
        .snapshotEvents()
        .findLast((e) => e.type === "tool-workflow/run-start").time;
      assert(
        !calls.some(
          (call) =>
            priorChildren.has(call.agentId) && call.time >= resumedStart,
        ),
        "A replayed worker executed tools again",
      );
      for (const tree of trees)
        assert.equal(
          fs
            .readFileSync(path.join(tree.path, "resume-counter.txt"), "utf8")
            .trim(),
          "1",
        );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(cwd, "resume.json"), "utf8")),
        { completed: 2 },
      );
      reports.push({
        preset,
        name: "parallel-recovery",
        durationMs: Date.now() - recoveryStarted,
        failedId,
        resumedId,
        expectedFailure: failed,
        counters: [1, 1],
        newWorkersOnResume: 1,
      });
      save();
      console.log(
        "PARALLEL_RECOVERY_PASS " +
          preset +
          " completed parallel writes replay without new execution",
      );
    }
    console.log(
      "WORKFLOW_PARALLEL_PASS all selected Standard and PTC cases passed",
    );
  } catch (error) {
    reports.push({ failure: String(error.stack), time: Date.now() });
    save();
    throw error;
  } finally {
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
