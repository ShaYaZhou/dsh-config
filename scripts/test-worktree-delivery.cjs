const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const {
  assertIsolatedHome,
  withAgentTestHomeLock,
} = require("./test-home.cjs");
const { withOutputLock } = require("./test-output-lock.cjs");

const output = path.resolve(__dirname, "../.local/worktree-delivery-test");
async function main() {
  assert(
    process.env.OPENAI_API_KEY && process.env.DSH_NATIVE_ROOT,
    "Use worktree-test with your configured proxy",
  );
  assertIsolatedHome(process.env.DSH_HOME);
  const previous =
    process.env.DSH_WORKTREE_VERIFY_LAST === "1"
      ? JSON.parse(fs.readFileSync(path.join(output, "failure.json"), "utf8"))
      : null;
  const rollbackReceipt = path.join(output, "rollback-started.json");
  // shortcut: verification-only recovery stops at rollback; use a fresh fixture after rollback interruption.
  if (previous && fs.existsSync(rollbackReceipt))
    assert.notEqual(
      JSON.parse(fs.readFileSync(rollbackReceipt, "utf8")).project,
      previous.project,
      "Rollback already started; inspect the retained fixture or run a fresh worktree-test without DSH_WORKTREE_VERIFY_LAST.",
    );
  for (const name of [
    "result.json",
    "progress.json",
    ...(!previous ? ["failure.json", "rollback-started.json"] : []),
  ])
    fs.rmSync(path.join(output, name), { force: true });
  const project =
    previous?.project ?? path.join(output, "project-" + Date.now());
  assert.equal(
    fs.realpathSync(path.dirname(path.resolve(project))),
    fs.realpathSync(output),
    "Resume only this synthetic fixture",
  );
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  const run = (command, args, cwd = project, codes = [0]) => {
    const result = spawnSync("rtk", ["proxy", command, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60000,
    });
    assert(
      codes.includes(result.status),
      result.error?.message ?? result.stdout + result.stderr,
    );
    return result.stdout.trim();
  };
  const git = (args, cwd = project) => run("git", args, cwd);
  const hash = (file) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const digest = (text) =>
    createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
  const sourceHash = (file) => digest(fs.readFileSync(file, "utf8"));
  const oracle = path.join(project, "acceptance.mjs");
  const note = "Keep this uncommitted user note.\n";
  const selected = '{"fixture":true,"units":"metric"}\n';
  if (!previous) {
    fs.writeFileSync(
      path.join(project, ".gitignore"),
      "fixture.config.json\nexcluded.private\nintegration.md\n",
    );
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    fs.writeFileSync(path.join(project, "local-note.txt"), "baseline note\n");
    fs.writeFileSync(
      path.join(project, "src/area.mjs"),
      "export const area = (width, height) => width + height;\n",
    );
    fs.writeFileSync(
      path.join(project, "src/temperature.mjs"),
      "export const fahrenheit = c => c * 9 / 5 - 32;\n",
    );
    fs.writeFileSync(
      path.join(project, "AGENTS.md"),
      "Synthetic worktree acceptance. Stay inside this Git repository and its worktrees. Do not access network, credentials, external apps or memory. Local commits and cherry-picks are authorized, no push. Preserve acceptance.mjs, AGENTS.md and local-note.txt. Only explicitly selected fixture.config.json may be copied to worktrees; do not read or copy excluded.private. Only the coordinator may edit integration.md; workers edit only their assigned src file. Do not create grandchildren.",
    );
    fs.writeFileSync(
      oracle,
      `import assert from 'node:assert/strict';
import {area} from './src/area.mjs';
import {fahrenheit} from './src/temperature.mjs';
for(const [a,b,result] of [[3,4,12],[0,4,0],[2.5,2,5]])assert.equal(area(a,b),result);
for(const [c,f] of [[0,32],[100,212],[-40,-40]])assert.equal(fahrenheit(c),f);
console.log('WORKTREE_INTEGRATION_ACCEPTANCE_PASS');
`,
    );
    git(["init", "--quiet"]);
    git(["config", "core.hooksPath", path.join(project, ".no-fixture-hooks")]);
    git(["config", "core.fsmonitor", "false"]);
    git(["config", "user.name", "DSH Worktree Fixture"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "Synthetic baseline"]);
    fs.writeFileSync(path.join(project, "local-note.txt"), note);
    fs.writeFileSync(path.join(project, "fixture.config.json"), selected);
    fs.writeFileSync(
      path.join(project, "excluded.private"),
      "SYNTHETIC_EXCLUDED_CANARY\n",
    );
    run("node", [oracle], project, [1]);
  }
  const baseline =
    previous?.baseline ?? git(["rev-list", "--max-parents=0", "HEAD"]);
  const originalHash = (file) => {
    const result = spawnSync(
      "rtk",
      ["proxy", "git", "show", baseline + ":" + file],
      { cwd: project },
    );
    assert.equal(result.status, 0, "Cannot read original fixture blob");
    return createHash("sha256").update(result.stdout).digest("hex");
  };
  const oracleHash = previous?.oracleHash ?? originalHash("acceptance.mjs");
  const agentsHash = previous?.agentsHash ?? originalHash("AGENTS.md");
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
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: "desktop",
    patchFiles: [overlay],
    args: ["--port", "0", "--no-open"],
  });
  const started = Date.now(),
    calls = previous?.calls ?? [],
    directories = previous?.directories ?? [];
  const checkouts = new Set([project]),
    mutations = previous?.mutations ?? [],
    parentShellChanges = previous?.parentShellChanges ?? [];
  const sourceNames = ["src/area.mjs", "src/temperature.mjs"];
  const sourceSnapshot = (roots) =>
    new Map(
      [...roots].flatMap((cwd) =>
        sourceNames.map((name) => {
          const file = path.join(cwd, name);
          return [file, sourceHash(file)];
        }),
      ),
    );
  let parent,
    maxConcurrent = previous?.maxConcurrent ?? 0,
    result;
  const progress = (phase) =>
    fs.writeFileSync(
      path.join(output, "progress.json"),
      JSON.stringify({
        phase,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        maxConcurrent,
        tools: calls.map((call) => call.name),
      }),
    );
  try {
    const service = await new Promise((resolve) =>
      ctx.inject(["nestedSessions"], (scope) => resolve(scope.nestedSessions)),
    );
    const workspace = previous
      ? null
      : await ctx.workspaceRegistry.create(
          project,
          "Parallel worktree acceptance",
        );
    const created = previous
      ? { sessionId: previous.parentSessionId }
      : await ctx.sessionController.create({ workspaceId: workspace.id });
    parent = (await ctx.sessionController.resolveAgent(created.sessionId))
      .agent;
    assert.equal(
      path.resolve(parent.session.header.cwd),
      project,
      "Parent does not own this fixture",
    );
    ctx.on("agent/status", () => {
      const active = ctx.agents
        .list()
        .filter(
          (agent) =>
            agent.id !== parent.id &&
            agent.status === "running" &&
            (path.resolve(agent.session.header.cwd ?? "") === project ||
              path
                .resolve(agent.session.header.cwd ?? "")
                .startsWith(project + path.sep)),
        );
      maxConcurrent = Math.max(maxConcurrent, active.length);
    });
    ctx.on("session/event", (session, event) => {
      if (event.type === "working-directory/change")
        directories.push({ sessionId: session.id, cwd: event.data.cwd });
    });
    ctx.on("tools/execute", async (exec, next) => {
      calls.push({
        agentId: exec.agent?.id,
        name: exec.name,
        startedAt: Date.now(),
        ...(["create_worktree", "start_session"].includes(exec.name)
          ? { arguments: exec.arguments }
          : {}),
        ...(["pwsh", "bash"].includes(exec.name)
          ? { command: JSON.stringify(exec.arguments) }
          : {}),
      });
      progress("executing");
      const shell = ["pwsh", "bash"].includes(exec.name);
      const cwd = exec.agent && ctx.workingDirectory.get(exec.agent.session);
      const watched =
        shell && cwd && checkouts.has(cwd)
          ? exec.agent.id === parent.id
            ? checkouts
            : [cwd]
          : [];
      const before = sourceSnapshot(watched);
      const startedAt = Date.now();
      const outcome = await next();
      for (const [file, previous] of before) {
        const after = sourceHash(file);
        if (previous === after) continue;
        const change = {
          agentId: exec.agent.id,
          file,
          before: previous,
          after,
        };
        if (exec.agent.id === parent.id)
          parentShellChanges.push({
            ...change,
            startedAt,
            command: JSON.stringify(exec.arguments),
          });
        else mutations.push({ ...change, tool: exec.name, startedAt });
      }
      return outcome;
    });
    ctx.on("tools/result", (exec, outcome) => {
      if (outcome.isError) return;
      const value = outcome.value;
      if (exec.name === "create_worktree" && value?.path)
        checkouts.add(value.path);
      if (
        ["edit", "write"].includes(exec.name) &&
        value?.path &&
        sourceNames.some((name) =>
          [...checkouts].some((cwd) => path.join(cwd, name) === value.path),
        )
      ) {
        assert(
          typeof value.before === "string" && typeof value.after === "string",
          "Source mutation lacks native before/after evidence",
        );
        const mutation = {
          agentId: exec.agent?.id,
          file: value.path,
          before: digest(value.before),
          after: digest(value.after),
          tool: exec.name,
        };
        if (exec.agent?.id === parent.id)
          parentShellChanges.push({ ...mutation, startedAt: Date.now() });
        else mutations.push({ ...mutation, startedAt: Date.now() });
      }
    });
    const task = `并行修复 src/area.mjs 的 area（返回 width*height）和 src/temperature.mjs 的 fahrenheit（返回 c*9/5+32），保留导出。两个实现应独立推进，由你自行选择模型与分工。
使用独立 Git worktree 和嵌套会话，交付工作区是 ${project}；主会话不得代替实现者编写源码，仅负责审阅和整合。每个实现者只改分配的 src 文件。每个分支必须有一个只包含该分配文件的本地 commit；worktree 的 git 元数据在该 checkout 之外，实现者本身无法提交，可由协调者或以仓库根为 cwd 的执行者代为提交并回报 SHA；不用推送。
只将源目录忽略文件 fixture.config.json 显式复制到每个写入者 worktree，保留原样；其他忽略文件不带入，尤其不读取或复制 excluded.private。不要覆盖源目录的未提交 local-note.txt。
收集实际结果后检查每个 commit 的 diff，并在最终回报里贴出每个 commit 的补丁原文（git show --format= --no-ext-diff --no-textconv 的输出），再由主会话整合回源 checkout（优先 cherry-pick），整合提交须对应实现者的实际补丁，运行原样的 node acceptance.mjs，最后写 integration.md 说明分支、实际并发、整合的 SHA 和验收结果。保持验收文件与 AGENTS.md 原样。工作区与分支保留；不要 reset、clean、删除目录或自行做回滚。主会话须等全部任务结束后再报告。`;
    const signal = AbortSignal.timeout(900000);
    if (!previous) {
      await ctx.sessionController.prompt(
        {
          sessionId: parent.id,
          requestId: randomUUID(),
          mode: "queue",
          content: [{ type: "text", text: task }],
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
        stable = !active && seq === last ? stable + 1 : 0;
        last = seq;
      }
    }
    progress("verifying");
    const links = (await service.list({ sessionId: parent.id })).links;
    assert(links.length >= 2, "Parallel implementation was not delegated");
    assert(
      links.every((link) => ["completed", "error"].includes(link.status)),
      "A linked worker is unfinished or stopped",
    );
    assert(maxConcurrent >= 2, "Two independent child turns never overlapped");
    const worktrees = git(["worktree", "list", "--porcelain"])
      .split(/\r?\n\r?\n/)
      .map((block) => {
        const lines = block.split(/\r?\n/);
        return {
          path: lines.find((line) => line.startsWith("worktree "))?.slice(9),
          head: lines.find((line) => line.startsWith("HEAD "))?.slice(5),
        };
      })
      .filter((tree) => tree.path && path.resolve(tree.path) !== project);
    assert(worktrees.length >= 2, "Independent Git worktrees were not created");
    for (const tree of worktrees)
      assert(
        !worktrees.some(
          (other) =>
            other !== tree &&
            path
              .resolve(tree.path)
              .startsWith(path.resolve(other.path) + path.sep),
        ),
        "A worker checkout was nested inside another checkout",
      );
    assert(
      calls.filter((call) => call.name === "create_worktree").length >= 2,
      "Native worktree tool was not used",
    );
    const reviews = parent.session
      .snapshotEvents()
      .filter((event) =>
        ["tool/result", "tool/ptc-dispatch"].includes(event.type),
      )
      .map((event) => {
        const message = event.data.message ?? event.data;
        return (message.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .replaceAll("\r\n", "\n");
      })
      .filter(
        (text) =>
          !text.includes("[exit code:") && !text.includes("[output truncated;"),
      );
    const choices = [],
      intervals = [];
    for (const link of links) {
      const child = (await ctx.sessionController.resolveAgent(link.sessionId))
        .agent;
      if (link.status === "completed")
        assert(
          child.session.requestHeader(),
          "A completed child had no actual model request",
        );
      const cwd = ctx.workingDirectory.get(child.session);
      const events = child.session.snapshotEvents();
      for (const start of events.filter(
        (event) => event.type === "turn/start",
      )) {
        const end = events.find(
          (event) =>
            event.type === "turn/end" && event.data.turn === start.data.turn,
        );
        if (end)
          intervals.push({ id: child.id, start: start.time, end: end.time });
      }
      choices.push({
        sessionId: child.id,
        title: link.title,
        status: link.status,
        cwd,
        model: child.session.requestHeader()?.config.model,
      });
    }
    const writers = choices.filter(
      (choice) =>
        choice.status === "completed" &&
        worktrees.some(
          (tree) => path.resolve(tree.path) === path.resolve(choice.cwd),
        ),
    );
    assert(
      writers.length >= 2,
      "Workers did not actually execute in separate worktree directories",
    );
    assert.equal(
      new Set(writers.map((writer) => path.resolve(writer.cwd))).size,
      writers.length,
    );
    const writerIds = new Set(writers.map((writer) => writer.sessionId));
    const first = intervals.find(
      (a) =>
        writerIds.has(a.id) &&
        intervals.some(
          (b) =>
            writerIds.has(b.id) &&
            a.id !== b.id &&
            Math.max(a.start, b.start) < Math.min(a.end, b.end),
        ),
    );
    const second =
      first &&
      intervals.find(
        (b) =>
          writerIds.has(b.id) &&
          first.id !== b.id &&
          Math.max(first.start, b.start) < Math.min(first.end, b.end),
      );
    assert(
      second,
      "Actual linked writer turns did not overlap in their durable event timestamps",
    );
    const overlappingWriters = [first.id, second.id];
    for (const writer of writers) {
      assert.equal(
        fs.readFileSync(path.join(writer.cwd, "fixture.config.json"), "utf8"),
        selected,
        "Selected ignored config missing or changed",
      );
      assert(
        !fs.existsSync(path.join(writer.cwd, "excluded.private")),
        "Unselected ignored data leaked into worktree",
      );
      assert.equal(
        fs
          .readFileSync(path.join(writer.cwd, "local-note.txt"), "utf8")
          .replaceAll("\r\n", "\n"),
        "baseline note\n",
        "Uncommitted source data was copied implicitly",
      );
      assert.equal(git(["merge-base", baseline, "HEAD"], writer.cwd), baseline);
      const changed = git(
        ["diff", "--name-only", baseline, "HEAD"],
        writer.cwd,
      ).split(/\r?\n/);
      assert.equal(
        changed.length,
        1,
        "Worker commit crossed its ownership boundary",
      );
      assert(["src/area.mjs", "src/temperature.mjs"].includes(changed[0]));
      const file = path.join(writer.cwd, changed[0]);
      assert(
        mutations.some(
          (change) =>
            change.agentId === writer.sessionId &&
            change.file === file &&
            change.after === sourceHash(file),
        ),
        "Implementation has no source-write evidence from its own child",
      );
      const patch = git(
        [
          "show",
          "--format=",
          "--no-ext-diff",
          "--no-textconv",
          "HEAD",
          "--",
          changed[0],
        ],
        writer.cwd,
      ).replaceAll("\r\n", "\n");
      // Workflow return values are JSON, so a worker's patch arrives with escaped
      // newlines inside the coordinator's tool result. Unescape before matching.
      const unescaped = (text) =>
        text
          .replaceAll("\\n", "\n")
          .replaceAll("\\t", "\t")
          .replaceAll('\\"', '"');
      assert(
        reviews.some(
          (text) => text.includes(patch) || unescaped(text).includes(patch),
        ),
        "A worker patch was not returned to the coordinator for review",
      );
      assert.equal(
        git(["status", "--porcelain"], writer.cwd),
        "",
        "Worker left uncommitted tracked changes",
      );
    }
    // Under mandatory workflow the coordinator integrates through a delegated worker, so a
    // non-writer may replay a writer's exact change into the delivery checkout after that
    // writer finished. Anything else is still an independent edit of implementation sources.
    const sourceRelative = (file) => {
      const absolute = path.resolve(file);
      let best = null;
      for (const cwd of [
        project,
        ...worktrees.map((tree) => tree.path),
        ...checkouts,
      ]) {
        const relative = path.relative(path.resolve(cwd), absolute);
        if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
        if (best === null || relative.length < best.length) best = relative;
      }
      return best ?? absolute;
    };
    const integrationEcho = (change) =>
      mutations.some(
        (source) =>
          source !== change &&
          writerIds.has(source.agentId) &&
          sourceRelative(source.file) === sourceRelative(change.file) &&
          source.before === change.before &&
          source.after === change.after &&
          source.startedAt <= change.startedAt,
      );
    const unauthorized = mutations.filter(
      (change) => !writerIds.has(change.agentId) && !integrationEcho(change),
    );
    assert(
      unauthorized.length === 0,
      "A non-writer directly edited implementation sources",
    );
    for (const change of parentShellChanges) {
      if (
        sourceNames.some((name) => path.join(project, name) === change.file) &&
        mutations.some(
          (mutation) =>
            sourceNames.some(
              (name) =>
                path.join(project, name) === change.file &&
                [...checkouts].some(
                  (cwd) =>
                    cwd !== project && path.join(cwd, name) === mutation.file,
                ),
            ) &&
            mutation.before === change.before &&
            mutation.after === change.after &&
            intervals.some(
              (interval) =>
                interval.id === mutation.agentId &&
                interval.end <= change.startedAt,
            ),
        )
      )
        continue;
      assert(
        mutations.some(
          (mutation) =>
            mutation.file === change.file &&
            mutation.before === change.before &&
            mutation.after === change.after,
        ),
        "Coordinator shell changed implementation outside integration",
      );
    }
    // Under mandatory workflow the integrated acceptance is delegated to a worker, so it only
    // has to run after the final integration write, not by the parent itself.
    const lastIntegrationWrite = Math.max(
      0,
      ...mutations
        .filter((change) => !writerIds.has(change.agentId))
        .map((change) => change.startedAt ?? 0),
    );
    assert(
      calls.some(
        (call) =>
          /acceptance\.mjs/.test(call.command ?? "") &&
          (call.startedAt ?? 0) >= lastIntegrationWrite,
      ),
      "Coordinator did not run integrated acceptance",
    );
    assert.equal(hash(oracle), oracleHash, "Protected acceptance changed");
    assert.equal(
      hash(path.join(project, "AGENTS.md")),
      agentsHash,
      "Protected project instructions changed",
    );
    assert.deepEqual(
      git(["diff", "--name-only", baseline, "HEAD"]).split(/\r?\n/).sort(),
      ["src/area.mjs", "src/temperature.mjs"],
    );
    assert.equal(
      git(["diff", "--name-only"]),
      "local-note.txt",
      "Integration left unexpected tracked edits",
    );
    assert.equal(
      fs.readFileSync(path.join(project, "local-note.txt"), "utf8"),
      note,
    );
    const acceptance = run("node", [oracle]);
    assert(acceptance.includes("WORKTREE_INTEGRATION_ACCEPTANCE_PASS"));
    assert(
      fs.existsSync(path.join(project, "integration.md")),
      "No integration evidence from coordinator",
    );
    const report = fs.readFileSync(
      path.join(project, "integration.md"),
      "utf8",
    );
    const recoveredFailures = choices.filter(
      (choice) => choice.status === "error",
    );
    for (const failure of recoveredFailures) {
      assert(
        writers.some(
          (writer) => path.resolve(writer.cwd) === path.resolve(failure.cwd),
        ),
        "A failed worker has no successful replacement in its checkout",
      );
      assert(
        /失败|重试|failed|error|retry/i.test(report) &&
          [failure.title, failure.model].some(
            (value) => value && report.includes(value),
          ),
        "Integration report concealed an earlier failure",
      );
    }
    const integrated = git([
      "rev-list",
      "--reverse",
      baseline + "..HEAD",
    ]).split(/\r?\n/);
    assert.equal(integrated.length, 2, "Expected two integrated commits");
    for (const writer of writers) {
      const changed = git(
        ["diff", "--name-only", baseline, "HEAD"],
        writer.cwd,
      );
      const patch = git(
        [
          "show",
          "--format=",
          "--no-ext-diff",
          "--no-textconv",
          "HEAD",
          "--",
          changed,
        ],
        writer.cwd,
      );
      assert(
        integrated.some(
          (commit) =>
            git([
              "show",
              "--format=",
              "--no-ext-diff",
              "--no-textconv",
              commit,
              "--",
              changed,
            ]) === patch,
        ),
        "An integration commit does not carry its worker's actual patch",
      );
    }
    fs.writeFileSync(
      rollbackReceipt,
      JSON.stringify({
        project,
        parentSessionId: parent.id,
        integrated,
        beforeHead: git(["rev-parse", "HEAD"]),
      }),
    );
    for (const commit of [...integrated].reverse())
      git(["revert", "--no-edit", commit]);
    assert.equal(
      git(["diff", baseline, "HEAD", "--", "src", "acceptance.mjs"]),
      "",
      "Revert did not restore baseline sources",
    );
    assert.equal(
      fs.readFileSync(path.join(project, "local-note.txt"), "utf8"),
      note,
      "Rollback overwrote uncommitted note",
    );
    for (const writer of writers) {
      const tree = worktrees.find(
        (tree) => path.resolve(tree.path) === path.resolve(writer.cwd),
      );
      assert.equal(
        git(["rev-parse", "HEAD"], writer.cwd),
        tree.head,
        "Revert changed a worker branch",
      );
    }
    for (const link of links)
      assert(
        (await ctx.sessionController.inspect(link.sessionId)).events.length,
        "Child history lost after rollback",
      );
    run("node", [oracle], project, [1]);
    result = {
      passed: true,
      parentSessionId: parent.id,
      project,
      maxConcurrent,
      overlappingWriters,
      choices,
      recoveredFailures: recoveredFailures.map((failure) => failure.sessionId),
      worktrees,
      integrated,
      mutations,
      workerPatchesReviewed: true,
      oracleUnchanged: true,
      selectedIgnoredIncluded: true,
      unselectedExcluded: true,
      dirtyNotePreserved: true,
      integratedAcceptance: acceptance,
      revertRestoredBaseline: true,
      historiesRetained: true,
      resumedVerification: !!previous,
      priorAttemptSeconds: previous?.elapsedSeconds,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (error) {
    fs.writeFileSync(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          error: error.message,
          project,
          baseline,
          oracleHash,
          agentsHash,
          parentSessionId: parent?.id,
          maxConcurrent,
          calls,
          directories,
          mutations,
          parentShellChanges,
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
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
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  fs.rmSync(path.join(output, "failure.json"), { force: true });
  console.log(
    "WORKTREE_DELIVERY_PASS " +
      JSON.stringify({
        maxConcurrent: result.maxConcurrent,
        workers: result.choices.length,
        elapsedSeconds: result.elapsedSeconds,
      }),
  );
}
if (require.main === module)
  withOutputLock(output, () =>
    withAgentTestHomeLock(process.env.DSH_HOME, main),
  ).catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
