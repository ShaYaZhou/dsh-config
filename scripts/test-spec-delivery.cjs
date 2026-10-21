const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { assertIsolatedHome } = require("./test-home.cjs");
const output = path.resolve(__dirname, "../.local/spec-delivery-test");

async function withOutputLock(folder, action) {
  fs.mkdirSync(folder, { recursive: true });
  const lock = path.join(folder, "runner.lock");
  let handle;
  try {
    handle = fs.openSync(lock, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Another spec-test owns ${lock}. Run these checks serially; remove a stale lock only after its recorded process has exited.`);
    throw error;
  }
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid }));
    return await action();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

async function main() {
  process.env.OPENSPEC_TELEMETRY = '0';
  process.env.DO_NOT_TRACK = '1';
  assert(
    process.env.OPENAI_API_KEY &&
      process.env.DSH_HOME &&
      process.env.DSH_NATIVE_ROOT,
    "Use spec-test with an isolated home and your configured proxy key",
  );
  assertIsolatedHome(process.env.DSH_HOME);
  const previous = process.env.DSH_SPEC_RESUME_LAST === "1"
    ? JSON.parse(fs.readFileSync(path.join(output, "failure.json"), "utf8"))
    : null;
  const project = previous?.project ?? path.join(output, "project-" + Date.now());
  assert.equal(path.dirname(path.resolve(project)), output, "Resume only this test's synthetic project");
  if (!previous) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "acceptance"), { recursive: true });
  for (const name of ["result.json", "failure.json", "progress.json"])
    fs.rmSync(path.join(output, name), { force: true });
  }
  const source = path.join(project, "src/parse-count.js"),
    oracle = path.join(project, "acceptance/check.mjs");
  const hash = (file) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (!previous) {
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({
      name: "spec-delivery-fixture",
      private: true,
      type: "module",
      scripts: { test: "node acceptance/check.mjs" },
    }),
  );
  fs.writeFileSync(
    source,
    "export function parseCount(value) { return parseInt(value, 10); }\n",
  );
  fs.writeFileSync(
    path.join(project, "AGENTS.md"),
    "Synthetic delivery fixture. Work only inside this project. Do not access network, credentials, memory or other apps. Do not commit or push. Keep acceptance/check.mjs and AGENTS.md unchanged. Only the main coordinator may edit openspec/**. Worker implementers may edit src/** and add their own tests. Reviewer agents must not edit project files.",
  );
  fs.writeFileSync(
    oracle,
    `import assert from 'node:assert/strict';
import {parseCount} from '../src/parse-count.js';
for(const [input,expected] of [[0,0],[12,12],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],['0',0],[' 0012 ',12]]) assert.equal(parseCount(input),expected);
for(const input of ['', ' ', '12x', '-1', '+1', '1.5', '9007199254740992', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER+1, true, null, undefined, {}]) assert.throws(()=>parseCount(input),TypeError, String(input));
console.log('SPEC_COUNT_ACCEPTANCE_PASS');
`,
  );
  }
  const baselineOracle = previous ? spawnSync("rtk", ["proxy", "git", "show", "HEAD:acceptance/check.mjs"], {cwd: project, encoding: "utf8"}) : null;
  if (baselineOracle) assert.equal(baselineOracle.status, 0, baselineOracle.stderr);
  const oracleHash = previous?.oracleHash ?? (baselineOracle ? createHash("sha256").update(baselineOracle.stdout).digest("hex") : hash(oracle));
  assert(oracleHash, "Original oracle digest is required for resume");
  const runGit = (args) => {
    const result = spawnSync("rtk", ["proxy", "git", ...args], {
      cwd: project,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  };
  if (!previous) {
  runGit(["init", "--quiet"]);
  runGit(["add", "."]);
  runGit([
    "-c",
    "user.name=DSH Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Synthetic baseline",
  ]);
  assert.notEqual(
    spawnSync(process.execPath, [oracle], { encoding: "utf8" }).status,
    0,
    "Baseline must reproduce the invalid-input bug",
  );
  }
  const overlay = path.join(output, "runtime.patch.yml");
  fs.writeFileSync(
    overlay,
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
    patchFiles: [overlay],
    args: ["--port", "0", "--no-open"],
  });
  let parent,
    seenHash = hash(source);
  const started = Date.now(),
    calls = previous?.calls ?? [],
    sourceChanges = previous?.sourceChanges ?? [],
    planningAtDelegation = previous?.planningAtDelegation ?? [];
  function changes() {
    const dir = path.join(project, "openspec/changes");
    return fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name !== "archive")
          .map((entry) => path.join(dir, entry.name))
      : [];
  }
  function hasSpec(change) {
    return (
      ["proposal.md", "design.md", "tasks.md", "specs"].every((file) =>
        fs.existsSync(path.join(change, file)),
      ) &&
      fs
        .readdirSync(path.join(change, "specs"), { recursive: true })
        .some((file) => file.endsWith(".md"))
    );
  }
  try {
    const reviewerProbe = await ctx.sessionController.create({
      cwd: project,
      agentPreset: "reviewer",
    });
    const probe = await ctx.sessionController.resolveAgent(reviewerProbe.sessionId);
    assert.equal(probe.agent.session.header.agentPreset, "reviewer");
    console.log("REVIEWER_NATIVE_PREFLIGHT_PASS");
    ctx.on("tools/execute", async (exec, next) => {
      calls.push({
        agentId: exec.agent?.id,
        name: exec.name,
        ...(["skill", "start_session"].includes(exec.name)
          ? { arguments: exec.arguments }
          : {}),
        ...(exec.agent?.id === parent?.id &&
        ["pwsh", "bash"].includes(exec.name)
          ? { command: JSON.stringify(exec.arguments) }
          : {}),
      });
      if (exec.name === "start_session")
        planningAtDelegation.push({
          agentId: exec.agent?.id,
          ready: changes().some(hasSpec),
        });
      fs.writeFileSync(
        path.join(output, "progress.json"),
        JSON.stringify({
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
          tools: calls.map((row) => row.name),
          childrenRequested: calls.filter((row) => row.name === "start_session")
            .length,
        }),
      );
      const result = await next();
      const current = hash(source);
      if (current !== seenHash) {
        sourceChanges.push({ agentId: exec.agent?.id, tool: exec.name });
        seenHash = current;
      }
      return result;
    });
    const service = await new Promise((resolve) =>
      ctx.inject(["nestedSessions"], (scope) => resolve(scope.nestedSessions)),
    );
    const workspace = previous ? null : await ctx.workspaceRegistry.create(
      project,
      "Natural spec delivery acceptance",
    );
    const created = previous ? {sessionId: previous.parentSessionId} : await ctx.sessionController.create({
      workspaceId: workspace.id,
    });
    parent = (await ctx.sessionController.resolveAgent(created.sessionId))
      .agent;
    const skill = await ctx.skills.get("dsh-spec-delivery", {
      scope: parent,
      cwd: project,
    });
    assert(skill, "Delivery skill not discovered by the native host");
    const task =
      "先用 OpenSpec 写 spec，再由你自动分配嵌套会话实现、独立审查和验收，全程不用我切命令。允许在当前项目初始化 OpenSpec。修复 src/parse-count.js 的 parseCount，保留现有导出：接受非负安全整数的 number，或去掉两端空白后只含十进制数字的非空 string（允许前导零）；其他类型、空白、负数、小数、混入字符、正号、NaN、Infinity 和超出安全整数范围的值均抛 TypeError。验收运行 node acceptance/check.mjs，保留该验收文件原样。只做这个本地项目，不保存记忆、不访问网络、不提交或推送。由主会话自行决定子会话数量和模型，完成后报告规格位置和实际验收结果。";
    const signal = AbortSignal.timeout(900000);
    await ctx.sessionController.prompt(
      {
        sessionId: parent.id,
        requestId: randomUUID(),
        mode: "queue",
        content: [{ type: "text", text: previous ? "继续完成上次被验收超时中断的同一任务。先检查现有规格、实现、审查结果与验收记录，已通过的检查不必重复。若已全部完成，直接给出最终交付总结；否则补齐真实缺口。保持原任务的权限、范围与禁止事项，不提交或推送，不保存记忆。" : task }],
      },
      signal,
    );
    let stable = 0,
      last = -1;
    while (stable < 2) {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await service.tail;
      const links = (await service.list({ sessionId: parent.id })).links;
      const active =
        parent.status === "running" ||
        parent.inbox.nextTurn.length ||
        parent.inbox.nextStep.length ||
        links.some((link) => ["queued", "running"].includes(link.status));
      const seq = parent.session.snapshotEvents().at(-1)?.seq ?? -1;
      stable = !active && last === seq ? stable + 1 : 0;
      last = seq;
    }
    const links = (await service.list({ sessionId: parent.id })).links;
    assert(
      calls.some(
        (call) =>
          call.agentId === parent.id &&
          call.name === "skill" &&
          call.arguments.name === "dsh-spec-delivery",
      ),
      "Natural request did not invoke the delivery skill",
    );
    assert(
      links.length >= 2,
      "Implementation and independent review were not both delegated",
    );
    assert(
      planningAtDelegation.length &&
        planningAtDelegation.every((row) => row.ready),
      "A child started before planning artifacts were ready",
    );
    assert(
      sourceChanges.length &&
        sourceChanges.every(
          (row) =>
            row.agentId !== parent.id &&
            links.some((link) => link.sessionId === row.agentId),
        ),
      "Source implementation was not done by linked workers",
    );
    const choices = [];
    for (const link of links) {
      assert.equal(link.parentId, parent.id);
      assert.equal(link.status, "completed");
      const child = (await ctx.sessionController.resolveAgent(link.sessionId)).agent,
        header = child.session.requestHeader();
      assert(header, "Child had no real model request");
      choices.push({
        title: link.title,
        model: header.config.model,
        preset: child.session.header.agentPreset,
      });
    }
    assert(
      choices.some((row) => row.preset === "reviewer"),
      "No independent reviewer preset was used",
    );
    assert(
      calls.some(
        (row) =>
          row.agentId === parent.id && /check\.mjs/.test(row.command ?? ""),
      ),
      "The coordinator did not run acceptance",
    );
    assert.equal(hash(oracle), oracleHash, "The acceptance oracle was edited");
    const actual = spawnSync(process.execPath, [oracle], { encoding: "utf8" });
    assert.equal(actual.status, 0, actual.stdout + actual.stderr);
    assert(actual.stdout.includes("SPEC_COUNT_ACCEPTANCE_PASS"));
    const change = changes().find(hasSpec);
    assert(change, "No complete specification artifacts");
    const instructions = spawnSync(
      "rtk",
      [
        "proxy",
        "openspec",
        "instructions",
        "apply",
        "--change",
        path.basename(change),
        "--json",
      ],
      {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, OPENSPEC_TELEMETRY: "0", DO_NOT_TRACK: "1" },
      },
    );
    assert.equal(instructions.status, 0, instructions.stderr);
    const state = JSON.parse(instructions.stdout);
    assert(
      state.tasks.length && state.tasks.every((task) => task.done),
      "Unfinished spec tasks remain",
    );
    assert(
      fs.existsSync(path.join(change, "acceptance.md")),
      "No acceptance evidence document",
    );
    const summary = (await service.read({ sessionId: parent.id, limit: 4 }))
      .latestResult;
    assert(summary && summary.length > 100, "Missing final delivery summary");
    const result = {
      passed: true,
      entry: "natural language without slash commands",
      parentSessionId: parent.id,
      project,
      change: path.basename(change),
      choices,
      sourceChanges,
      planningBeforeDelegation: true,
      oracleUnchanged: true,
      acceptance: actual.stdout.trim(),
      allTasksDone: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      resumedAfterTimeout: !!previous,
    };
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      "SPEC_DELIVERY_PASS " +
        JSON.stringify({
          change: result.change,
          choices,
          elapsedSeconds: result.elapsedSeconds,
        }),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          error: error.message,
          parentSessionId: parent?.id,
          project,
          oracleHash,
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
          calls,
          sourceChanges,
          planningAtDelegation,
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
module.exports = { withOutputLock };
if (require.main === module) withOutputLock(output, main).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
