const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { assertIsolatedHome, withAgentTestHomeLock } = require("./test-home.cjs");
const { withOutputLock } = require("./test-output-lock.cjs");

async function main() {
  assert(
    process.env.OPENAI_API_KEY,
    "Set OPENAI_API_KEY locally; this test uses the configured real proxy",
  );
  assert(
    process.env.DSH_HOME && process.env.DSH_NATIVE_ROOT,
    "Run through harness.mjs automatic-test with an isolated --home",
  );
  assertIsolatedHome(process.env.DSH_HOME);
  const native = process.env.DSH_NATIVE_ROOT;
  const { runProfile } = await import(
    pathToFileURL(path.join(native, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(native, "dsh-app-boot/lib/index.js"))
  );
  const output = path.resolve(__dirname, "../.local/automatic-session-test"),
    project = path.join(output, "project");
  fs.mkdirSync(project, { recursive: true });
  for (const name of ["result.json", "failure.json"]) {
    const file = path.join(output, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  fs.writeFileSync(
    path.join(output, "progress.json"),
    JSON.stringify({
      phase: "starting",
      startedAt: new Date().toISOString(),
      childrenRequested: 0,
      tools: [],
    }),
  );
  fs.writeFileSync(
    path.join(project, "AGENTS.md"),
    "This is a synthetic read-only review fixture. Read only files in this folder. Do not change files, store memory, read credentials, access the network or control other apps.",
  );
  const files = {
    "api/orders.js": `export async function orders(req, db) {
  const account = req.query.account;
  return db.query("SELECT * FROM orders WHERE account = '" + account + "'");
}
export async function changeOrder(req, db) {
  const user = req.headers['x-user'];
  if (!user) throw new Error('Login required');
  return db.query('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, req.body.id]);
}
export async function exportOrders(req, db) {
  return JSON.stringify(await db.query('SELECT * FROM orders'));
}
export function logError(error, req) {
  console.error({error, headers: req.headers, body: req.body});
}
`,
    "web/panel.js": `export function render(root, order, onSave) {
  root.innerHTML = '<h1>' + order.customerName + '</h1><div class="save">Save</div>';
  root.querySelector('.save').onclick = onSave;
  root.querySelector('.save').style.color = '#aaa';
  root.querySelector('.save').style.background = '#bbb';
}
export function signIn(token) { localStorage.setItem('access_token', token); }
export function showLoading(root) { root.innerHTML = '<span>Loading</span>'; }
export function showValidation(input, message) { input.title = message; }
export function focusModal(modal) { modal.style.display = 'block'; }
`,
    "storage/files.js": `import fs from 'node:fs/promises';
import path from 'node:path';
export async function load(root, name) { return fs.readFile(path.join(root, name), 'utf8'); }
export async function save(file, value) { await fs.writeFile(file, JSON.stringify(value)); }
export async function update(file, patch) {
  const old = JSON.parse(await fs.readFile(file, 'utf8'));
  await save(file, {...old, ...patch});
}
export async function recover(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { await save(file, {}); return {}; }
}
export async function rotate(file) { await fs.rename(file, file + '.bak'); }
`,
    "README.md":
      "# Review fixture\nThree independently maintained components: API access to orders, browser UI, and file persistence. No production data.\n",
  };
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(project, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const overlay = path.join(output, "runtime.patch.yml");
  fs.writeFileSync(
    overlay,
    JSON.stringify([
      { id: "desktop-product-telemetry", disabled: true },
      { id: "product-analytics", disabled: true },
    ]),
  );
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: "desktop",
    patchFiles: [overlay],
    args: ["--port", "0", "--no-open"],
  });
  const toolCalls = [],
    started = Date.now(),
    progressFile = path.join(output, "progress.json");
  let parent;
  try {
    ctx.on("tools/execute", async (exec, next) => {
      toolCalls.push({
        agentId: exec.agent?.id,
        name: exec.name,
        ...(exec.name === "start_session" ? { arguments: exec.arguments } : {}),
      });
      fs.writeFileSync(
        progressFile,
        JSON.stringify({
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
          tools: toolCalls.map((row) => row.name),
          childrenRequested: toolCalls.filter(
            (row) => row.name === "start_session",
          ).length,
        }),
      );
      return next();
    });
    const service = await new Promise((resolve) =>
      ctx.inject(["nestedSessions"], (scope) => resolve(scope.nestedSessions)),
    );
    const workspace = await ctx.workspaceRegistry.create(
      project,
      "Automatic allocation acceptance",
    );
    const created = await ctx.sessionController.create({
      workspaceId: workspace.id,
    });
    parent = (await ctx.sessionController.resolveAgent(created.sessionId))
      .agent;
    ctx.permissionPresets.set(parent.session, "read-only");
    const defaultBefore = ctx.agentDefaultModel.currentSelection();
    assert(service.automatic(parent.id));
    const signal = AbortSignal.timeout(480000);
    const task =
      "请完整审查这个仓库，分别产出 API 安全风险清单、前端可访问性整改清单、文件存储可靠性与恢复方案三个可独立阅读的小报告。每部分都要引用实际文件和代码证据，最后统一汇总改进优先级。只做审查，不修改文件，也不要保存记忆。";
    // The command requests collaboration; neither it nor this test prescribes count, assignments or models.
    const accepted = await ctx.commands.execute(
      parent,
      "/collaborate " + task,
      [],
      signal,
    );
    assert.equal(accepted.result.kind, "success");
    let stable = 0,
      previous = -1;
    while (stable < 2) {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await service.tail;
      const links = (await service.list({ sessionId: parent.id })).links;
      const active = links.some((link) =>
        ["queued", "running"].includes(link.status),
      );
      const parentActive =
        parent.status === "running" ||
        parent.inbox.nextTurn.length ||
        parent.inbox.nextStep.length;
      const last = parent.session.snapshotEvents().at(-1)?.seq ?? -1;
      stable = !active && !parentActive && previous === last ? stable + 1 : 0;
      previous = last;
    }
    const links = (await service.list({ sessionId: parent.id })).links;
    const createdByAgent = toolCalls.filter(
      (row) => row.name === "start_session" && row.agentId === parent.id,
    );
    assert(
      toolCalls.some(
        (row) =>
          row.name === "list_session_models" && row.agentId === parent.id,
      ),
      "Agent did not query available models",
    );
    assert(
      createdByAgent.length > 0,
      "Natural request finished without automatic visible delegation",
    );
    const choices = [];
    for (const link of links) {
      const child = ctx.agents.get(link.sessionId);
      assert(child, "Child is not a real live Agent");
      const header = child.session.requestHeader();
      assert(header, "No child model request was executed");
      assert.equal(header.config.model, link.selection.model);
      assert.equal(header.config.provider, link.selection.provider);
      assert.equal(ctx.permissionPresets.current(child.session), "read-only");
      assert.equal(
        link.status,
        "completed",
        "A child task did not complete: " + link.title,
      );
      choices.push({
        title: link.title,
        model: header.config.model,
        provider: header.config.provider,
        reason: link.reason,
        sessionId: link.sessionId,
        status: link.status,
      });
    }
    assert.deepEqual(
      ctx.agentDefaultModel.currentSelection(),
      defaultBefore,
      "Delegation changed the global default model",
    );
    const final = parent.session
      .snapshotEvents()
      .findLast((event) => event.type === "assistant/message");
    const summary =
      (final?.data?.message ?? final?.data)?.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n") ?? "";
    assert(
      summary.length > 200 &&
        /API|接口/i.test(summary) &&
        /前端|无障碍|界面/.test(summary) &&
        /存储|文件/.test(summary),
      "No final synthesis covering the requested areas",
    );
    assert(/SQL|注入|授权/i.test(summary)&&/键盘|焦点|对比度|keyboard|contrast|focus/i.test(summary)&&/原子|恢复|并发|损坏|atomic|recover|concurr/i.test(summary)&&/优先|P0|priority/i.test(summary),'Final response did not synthesize substantive findings and priorities');
    const report = {
      passed: true,
      entry: "/collaborate <task>",
      naturalTask: task,
      parentSessionId: parent.id,
      agentChosenCount: createdByAgent.length,
      choices,
      toolNames: toolCalls.map((row) => row.name),
      globalModelUnchanged: true,
      permissionInherited: true,
      finalSummary: summary,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      "AUTOMATIC_SESSIONS_PASS " +
        JSON.stringify({
          count: report.agentChosenCount,
          choices,
          elapsedSeconds: report.elapsedSeconds,
        }),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          message: error.message,
          toolCalls,
          parentSessionId: parent?.id,
          parentStatus: parent?.status,
          lastParentMessages: parent?.session
            .snapshotEvents()
            .filter((event) => event.type === "assistant/message")
            .slice(-3)
            .map((event) => (event.data.message ?? event.data).content),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    for (const agent of ctx.agents.list())
      if (agent.status === "running")
        agent.cancel({ kind: "user" }, { keepInbox: false });
    await shutdown.shutdown(0);
  }
}
withOutputLock(path.resolve(__dirname, "../.local/automatic-session-test"), () => withAgentTestHomeLock(process.env.DSH_HOME, main)).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
