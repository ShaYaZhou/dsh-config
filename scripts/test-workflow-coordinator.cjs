const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { withAgentTestHomeLock } = require("./test-home.cjs");
async function main() {
  const output = path.join(
    process.env.DSH_HOME,
    "coordinator-acceptance-" + Date.now(),
  );
  fs.mkdirSync(output, { recursive: true });
  for (let i = 0; i < 8; i++)
    fs.writeFileSync(path.join(output, `fixture-${i}.txt`), `FIX-${i}`);
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
  const reports = [],
    results = [],
    deliveries = [];
  ctx.on("tools/result", (exec, result) => {
    if (["workflow", "job_output"].includes(exec.name))
      deliveries.push({ name: exec.name, result });
    if (exec.name === "run_code")
      results.push({
        agentId: exec.agent.id,
        code: exec.arguments.code,
        result,
      });
  });
  try {
    const workspace = await ctx.workspaceRegistry.create(
      output,
      "Coordinator capability acceptance",
    );
    const made = await ctx.sessionController.create({
      workspaceId: workspace.id,
      agentPreset: "ptc",
    });
    const { agent } = await ctx.sessionController.resolveAgent(made.sessionId);
    const code =
      "const results=await Promise.all(Array.from({length:8},(_,i)=>tools.read({file_path:'fixture-'+i+'.txt'})));console.log(JSON.stringify({count:results.length,answer:6*7,results}));";
    async function probe(mode, source) {
      ctx.permissionPresets.set(agent.session, mode);
      const before = results.length,
        started = Date.now();
      await ctx.sessionController.prompt(
        {
          sessionId: agent.id,
          requestId: randomUUID(),
          mode: "queue",
          content: [
            {
              type: "text",
              text:
                "Synthetic capability test, not a project implementation. Invoke run_code exactly once with the following code unchanged. Do not delegate, retry, repair or change permissions. If refused, report the refusal and stop.\n" +
                source,
            },
          ],
        },
        AbortSignal.timeout(120000),
      );
      await agent.whenIdle();
      const result = results.slice(before).find((row) => row.code === source);
      assert(result, "Exact probe was not executed");
      reports.push({ mode, durationMs: Date.now() - started, ...result });
      fs.writeFileSync(
        path.join(output, "result.json"),
        JSON.stringify(reports, null, 2),
      );
      return result.result;
    }
    const allowed = await probe("read-only", code);
    assert(!allowed.isError, JSON.stringify(allowed));
    const text = JSON.stringify(allowed);
    for (let i = 0; i < 8; i++) assert(text.includes("FIX-" + i));
    assert(text.includes("42"));
    const denied = await probe("workspace-write", code);
    assert(denied.isError);
    assert.match(JSON.stringify(denied), /single literal JSON/);
    const workflowArgs = {
      budget_ms: 180000,
      meta: {
        name: "background-result",
        description: "Collect a default PTC job",
      },
      script:
        "return await agent('Read fixture-0.txt and return its content.',{read_only:true});",
    };
    await ctx.sessionController.prompt(
      {
        sessionId: agent.id,
        requestId: randomUUID(),
        mode: "queue",
        content: [
          {
            type: "text",
            text:
              "Call workflow once with these exact arguments, then collect its completed result with job_output before replying. Do not change permissions or write files.\n" +
              JSON.stringify(workflowArgs),
          },
        ],
      },
      AbortSignal.timeout(120000),
    );
    await agent.whenIdle();
    const started = deliveries.find((row) => row.name === "workflow");
    assert.equal(started?.result.value?.kind, "background");
    const completed = deliveries.find(
      (row) =>
        row.name === "job_output" &&
        row.result.value?.job?.status === "completed",
    );
    assert(completed, "Default background result was not collected");
    assert.match(completed.result.value.text, /FIX-0/);
    reports.push({ name: "default-background", deliveries });
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(reports, null, 2),
    );
    for (let i = 0; i < 8; i++)
      assert.equal(
        fs.readFileSync(path.join(output, `fixture-${i}.txt`), "utf8"),
        `FIX-${i}`,
      );
    console.log(
      "WORKFLOW_COORDINATOR_PASS PTC readonly computation and eight-call batching; workspace-write limitation remains explicit",
    );
  } finally {
    await shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
