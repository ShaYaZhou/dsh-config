const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const test = require("node:test"),
  assert = require("node:assert/strict");

test("BTW child strips all model tools and releases its own guard once", async () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../plugins/btw/lib/index.js"),
    "utf8",
  );
  const start = source.indexOf("  const childGuards =");
  const end = source.indexOf("  const stopWatch =", start);
  assert(start >= 0 && end > start);
  const calls = [];
  const sandbox = { protection: { own: () => calls.push("own") } };
  vm.runInNewContext(
    source.slice(start, end) + "\nthis.arm = arm; this.release = releaseChild;",
    sandbox,
  );
  let assemble;
  const agent = {
    ctx: {
      on: (event, callback) => {
        calls.push(event);
        assemble = callback;
        return () => {
          calls.push("release mode");
          throw Error("disposal failure");
        };
      },
      tools: {
        guard: () => {
          calls.push("guard");
          return () => calls.push("release guard");
        },
      },
    },
  };
  sandbox.arm(agent);
  sandbox.arm(agent);
  const original = {
    tools: [{ name: "subagent" }, { name: "run_code" }],
    variables: { model: "test" },
  };
  const assembled = await assemble({}, {}, async () => original);
  assert.equal(assembled.tools.length, 0);
  assert.equal(original.tools.length, 2);
  assert.equal(assembled.variables, original.variables);
  await assert.rejects(sandbox.release(agent), /disposal failure/);
  await sandbox.release(agent);
  assert.deepEqual(calls, [
    "own",
    "guard",
    "system-prompt/assemble",
    "own",
    "release mode",
    "release guard",
  ]);
});

test("BTW shortcut owns the focused conversation, preserves modal input and ignores hidden views", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../plugins/btw/lib/client.js"),
    "utf8",
  );
  const start = source.indexOf("function registerBtwShortcut(");
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../plugins/btw/package.json"),
      "utf8",
    ),
  );
  assert(
    pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-shortcuts"),
    "Client graph must inject the native shortcut service",
  );
  assert(
    source.match(/var inject = \[[^\]]*"shortcuts"/),
    "Client must declare its shortcut service dependency",
  );
  const end = source.indexOf("function apply(ctx)", start);
  assert(start >= 0 && end > start);
  const sandbox = {};
  vm.runInNewContext(
    source.slice(start, end) + "\nthis.register = registerBtwShortcut;",
    sandbox,
  );
  const mainTarget = {},
    sideTarget = {},
    calls = [];
  const scope = (target) => ({
    isConnected: true,
    getClientRects: () => [1],
    contains: (element) => element === target,
  });
  const main = scope(mainTarget),
    side = scope(sideTarget);
  const openers = new Map([
    [main, { sessionId: "main", open: () => calls.push("main") }],
    [side, { sessionId: "side", open: () => calls.push("side") }],
  ]);
  let command,
    disposed = false;
  const off = sandbox.register(
    {
      register: (value) => {
        command = value;
        return () => (disposed = true);
      },
    },
    openers,
    {
      list: {
        getSnapshot: () => ({
          byId: { main: { id: "main", retainedBy: { mainView: 1 } } },
        }),
      },
    },
    (key) => key,
  );
  assert.equal(command.defaults["desktop:windows"].code, "KeyB");
  assert.deepEqual(Object.keys(command.defaults), [
    "desktop:windows",
    "web:windows",
  ]);
  assert.equal(
    command.defaults["desktop:windows"].modifiers.join("+"),
    "control+alt+shift",
  );
  assert(!command.regions.includes("terminal"));
  command.resolve({ target: sideTarget, modal: null }).run();
  command.resolve({ target: null, modal: null }).run();
  assert.deepEqual(calls, ["side", "main"]);
  assert.equal(
    command.resolve({ target: mainTarget, modal: "approval" }).status,
    "pass",
  );
  main.getClientRects = () => [];
  assert.equal(
    command.resolve({ target: null, modal: null }).status,
    "blocked",
  );
  off();
  assert(disposed);
});
