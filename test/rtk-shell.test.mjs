import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  rewriteCommand,
  rewriteSpec,
  explainCommand,
  validateSettings,
} from "../plugins/rtk-shell/lib/rewrite.js";

test("RTK accepts only a bounded human-output Git grammar on either shell", () => {
  for (const command of [
    "git status",
    "git diff",
    "git diff --stat",
    "git diff --cached",
    "git log -3",
    "git log -n 3 --oneline",
    "git show --stat",
  ])
    assert.equal(rewriteCommand(command), "rtk " + command);
  for (const command of [
    "git status --porcelain",
    "git status --short",
    "git diff --name-only",
    "git log --format=%H",
    "git status | wc -l",
    "git status > out",
    "git status && git push",
    "git status; touch file",
    "git status\nwhoami",
    "X=1 git status",
    "env git status",
    "git -C repo status",
    "git status $(touch x)",
    "git status `whoami`",
    "git status #comment",
    "git status\0",
    "git push",
    "git commit -m message",
    "rtk git status",
    "rtk.exe git status",
    "rtk proxy git status",
    "ls",
    "Get-ChildItem",
    "& git status",
    "git log -n 0",
    "git log -n",
    "git log -- -n",
  ])
    assert.equal(rewriteCommand(command), command, command);
});

test("RTK preserves native specs and calls the environment/native executor exactly once", async () => {
  for (const dialect of ["bash", "pwsh"]) {
    let calls = [];
    let mode = "success";
    const handle = {
      result: async () => ({ exitCode: 0 }),
      kill() {},
      done: Promise.resolve(),
    };
    class Base {
      static inject = ["subprocess", "sandbox", "sandboxPolicy"];
      static Config = { native: true };
      constructor() {
        this.ctx = { rtkRules: { current: () => ({}) } };
      }
      get sandboxMode() {
        return "workspace-write";
      }
      execute(spec) {
        calls.push(spec);
        if (mode === "throw") throw Error("execution started then failed");
        if (mode === "reject") return Promise.reject(Error("execution failed"));
        return Promise.resolve(handle);
      }
    }
    const source = fs.readFileSync(
      new URL(`../plugins/rtk-shell/lib/${dialect}.js`, import.meta.url),
      "utf8",
    );
    const className =
      dialect === "bash" ? "RtkBashExecutor" : "RtkPwshExecutor";
    const code =
      source
        .slice(source.indexOf("export default class"))
        .replace("export default class", "class") +
      `;this.Executor=${className};`;
    const box = {
      EnvironmentBashExecutor: Base,
      EnvironmentPwshExecutor: Base,
      rewriteSpec,
    };
    vm.runInNewContext(code, box);
    const executor = new box.Executor();
    const controller = new AbortController();
    const spec = {
      command: "git status",
      workdir: "workspace with spaces",
      env: { TEST_ENV: "selected" },
      dshEnv: { DSH_SESSION_ID: "fixture" },
      sandboxPolicy: { mode: "workspace-write", workspaceRoot: "root" },
      signal: controller.signal,
      timeoutMs: 4321,
      onExpiry: "none",
    };
    assert.equal(await executor.execute(spec), handle);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "rtk git status");
    assert.equal(spec.command, "git status");
    for (const key of Object.keys(spec).filter((k) => k !== "command"))
      assert.equal(calls[0][key], spec[key]);
    assert.deepEqual(Array.from(box.Executor.inject), [
      ...Base.inject,
      "rtkRules",
    ]);
    assert.equal(box.Executor.Config, Base.Config);
    for (mode of ["throw", "reject"]) {
      calls = [];
      await assert.rejects(async () => executor.execute(spec), /failed/);
      assert.equal(calls.length, 1, "Never replay the raw command");
    }
    mode = "success";
    calls = [];
    const originalResult = handle.result;
    handle.result = async () => {
      throw Error("late process failure");
    };
    const published = await executor.execute(spec);
    await assert.rejects(published.result(), /late process failure/);
    assert.equal(calls.length, 1);
    handle.result = async () => ({
      exitCode: null,
      timedOut: true,
      aborted: false,
    });
    assert.equal((await published.result()).timedOut, true);
    assert.equal(calls.length, 1);
    handle.result = originalResult;
    calls = [];
    controller.abort();
    assert.throws(() => executor.execute(spec));
    assert.equal(calls.length, 0);
  }
});

test("log, search and test rules preserve literal argv and reject complex or machine-output modes", () => {
  assert.equal(
    rewriteCommand('cat "server log.log"'),
    'rtk log "server log.log"',
  );
  assert.equal(
    rewriteCommand("Get-Content 'server log.log'", {}, "pwsh"),
    "rtk log 'server log.log'",
  );
  assert.equal(
    rewriteCommand("rg -n ERROR ."),
    `rtk summary 'rg "-n" "ERROR" "."'`,
  );
  assert.equal(
    rewriteCommand("rg --files ."),
    `rtk summary 'rg "--files" "."'`,
  );
  assert.equal(
    rewriteCommand('node --test "tests/my test.cjs"'),
    `rtk err 'node "--test" "tests/my test.cjs"'`,
  );
  for (const command of [
    "cat file.log | tail -5",
    "cat *.log",
    "tail -f file.log",
    "Get-Content file.log -Wait",
    "rg --json ERROR .",
    "rg -c ERROR .",
    "rg --pre script ERROR .",
    "find . -delete",
    "npm install",
    'node -e "process.exit(1)"',
    "python -c code",
    "npm test > results.txt",
    'rg "$PATTERN" .',
    "cat file.log; git status",
    'cat "bad%PATH%.log"',
  ])
    assert.equal(rewriteCommand(command), command);
  assert.equal(rewriteCommand("cat file.log", { logs: false }), "cat file.log");
  assert.equal(rewriteCommand("git status", { enabled: false }), "git status");
  assert.equal(
    rewriteCommand("git status", { excludedCommands: ["git status"] }),
    "git status",
  );
  const custom = {
    customRules: [{ command: "cargo check", filter: "summary", enabled: true }],
  };
  assert.equal(explainCommand("cargo check", custom).changed, true);
  assert.equal(explainCommand("cargo check --all", custom).changed, false);
  assert.equal(
    explainCommand("cargo check", {
      ...custom,
      excludedCommands: ["cargo check"],
    }).changed,
    false,
  );
  assert.throws(() =>
    validateSettings({
      customRules: [
        { command: "echo hi; git push", filter: "summary", enabled: true },
      ],
    }),
  );
  assert.throws(() =>
    validateSettings({
      customRules: [
        { command: "Write-Output hi", filter: "summary", enabled: true },
      ],
    }),
  );
  const stdin = { command: "git status", stdin: "fixture" };
  assert.equal(rewriteSpec(stdin), stdin);
});

test("settings page registers independently; preview uses only the owner RPC and does not save or execute", async () => {
  const source = fs.readFileSync(
    new URL("../plugins/rtk-shell/lib/client.js", import.meta.url),
    "utf8",
  );
  let plugin, Page;
  const requests = [],
    writes = [];
  const snapshot = {
    status: "ready",
    writable: true,
    value: {
      enabled: true,
      git: true,
      logs: true,
      search: true,
      tests: true,
      customRules: [],
      excludedCommands: [],
    },
  };
  const form = {
    subscribe() {
      return () => {};
    },
    getSnapshot: () => snapshot,
    set: async (...args) => {
      writes.push(args);
      return true;
    },
  };
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children,
    }),
    useState: (value) => [value, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: (fn) => fn(),
    useSyncExternalStore: (_fn, get) => get(),
  };
  const ctx = {
    configForms: { get: () => form, whileServed: (_ids, fn) => fn() },
    connection: {
      rpc: {
        call: async (...args) => {
          requests.push(args);
          return {
            ok: true,
            value: { changed: true, rewritten: "rtk git status" },
          };
        },
      },
    },
    effect: (fn) => fn(),
    slots: {
      inject: (_slot, fn) => fn(),
      register: (meta, view) => {
        assert.equal(meta.name, "settings.section");
        Page = view;
        return () => {};
      },
    },
  };
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: (def) => {
          plugin = def.factory((name) =>
            name === "react" ? React : { Switch: "switch" },
          );
        },
      },
    },
    document: { createElement: () => ({ remove() {} }), head: { append() {} } },
    AbortController,
    AbortSignal,
  });
  plugin.apply(ctx);
  assert(Page);
  const flatten = (node) =>
    !node
      ? []
      : Array.isArray(node)
        ? node.flatMap(flatten)
        : typeof node === "object"
          ? [node, ...flatten(node.children)]
          : [];
  const tree = flatten(Page());
  assert(tree.some(n=>n.type==='h2'&&n.children.includes('Hooks')));
  assert(tree.some(n=>n.type==='h3'&&n.children.includes('Shell 执行前')));
  assert.equal(tree.filter(n=>n.type==='button'&&String(n.props['aria-label']).startsWith('展开 RTK ·')).length,4);
  assert(tree.filter(n=>n.props.className==='hook-detail').every(n=>n.props.hidden===true));
  const preview = tree.find(
    (n) => n.type === "button" && n.children.includes("预览改写"),
  );
  assert(preview);
  await preview.props.onClick();
  assert.equal(writes.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1], "rtkRules/preview");
  assert.equal(requests[0][2].args.request.command, "git status");
  const toggle = tree.find(
    (n) => n.type === "switch" && n.props.label === "自动改写",
  );
  await toggle.props.onChange(false);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], ["enabled", false]);
});
