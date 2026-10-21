const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");
function client(react = {}) {
  let plugin;
  const source = fs
    .readFileSync(
      path.resolve(__dirname, "../plugins/local-environments/lib/client.js"),
      "utf8",
    )
    .replace(
      "return { inject, apply };",
      "return { inject, apply, variableEntries, call, createNavigation };",
    );
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: (value) => {
          plugin = value.factory(() => react);
        },
      },
    },
    AbortSignal,
  });
  return plugin;
}
test("environment editor treats variable text literally and rejects malformed or duplicate names", () => {
  const { variableEntries } = client();
  const parsed = variableEntries(
    "KEY=a=b\nEMPTY=\nLITERAL=$(not executed)`text`\n\n",
  );
  assert.equal(parsed.KEY, "a=b");
  assert.equal(parsed.EMPTY, "");
  assert.equal(parsed.LITERAL, "$(not executed)`text`");
  for (const input of ["BAD", "=bad", "A=one\na=two", "BAD-NAME=value"])
    assert.throws(() => variableEntries(input));
  assert.equal(Object.keys(variableEntries("\n")).length, 0);
  assert(Object.hasOwn(variableEntries("__proto__=literal"), "__proto__"));
  assert.equal({}.polluted, undefined);
});
test("starting from native settings closes the owning panel after navigation", () => {
  const calls = [],
    entries = new Map();
  const { apply } = client({
    createElement: (component, props) => ({ component, props }),
  });
  const ctx = {
    effect: () => {},
    slots: {
      inject: (_name, register) => register(),
      register: (entry, render) => entries.set(entry.name, render),
    },
    sessions: { retain: (sessionId) => ({ sessionId, release() {} }) },
    uiWorkspace: {
      selection: { getSnapshot: () => ({ sessionId: "draft" }) },
      openSession: (sessionId) => calls.push(sessionId),
    },
  };
  apply(ctx);
  const page = entries.get("settings.section")({
    close: () => calls.push("close settings"),
  });
  page.props.onNavigate("environment");
  assert.deepEqual(calls, ["environment", "close settings"]);
});

test("environment navigation retains its source draft through native session references and releases on return or failure", () => {
  const { createNavigation } = client();
  const calls = [];
  let current = "draft";
  const ctx = {
    sessions: {
      retain: (sessionId) => {
        calls.push("retain:" + sessionId);
        return { sessionId, release: () => calls.push("release:" + sessionId) };
      },
    },
    uiWorkspace: {
      selection: { getSnapshot: () => ({ sessionId: current }) },
      openSession: (sessionId) => {
        if (sessionId === "failed") throw new Error("navigation failed");
        calls.push("open:" + sessionId);
        current = sessionId;
      },
    },
  };
  const navigation = createNavigation(ctx);
  navigation.open("environment");
  assert.equal(navigation.previous, "draft");
  assert.deepEqual(calls, ["retain:draft", "open:environment"]);
  assert.throws(() => navigation.open("failed"), /navigation failed/);
  assert.equal(navigation.previous, "draft");
  assert.deepEqual(calls.slice(-2), [
    "retain:environment",
    "release:environment",
  ]);
  navigation.back();
  assert.equal(current, "draft");
  assert.equal(navigation.previous, undefined);
  assert.deepEqual(calls.slice(-2), ["open:draft", "release:draft"]);
  navigation.open("environment");
  navigation.dispose();
  navigation.dispose();
  assert.equal(calls.filter((call) => call === "release:draft").length, 2);
});

test("environment client uses its own RPC namespace, propagates failures and carries cancellation", async () => {
  const { call } = client();
  const controller = new AbortController();
  let request;
  const ctx = {
    connection: {
      rpc: {
        call: async (...args) => {
          request = args;
          return { ok: false, error: { message: "permission refused" } };
        },
      },
    },
  };
  await assert.rejects(
    call(ctx, "save", { id: "one" }, controller.signal),
    /permission refused/,
  );
  assert.equal(request[0], "/api");
  assert.equal(request[1], "localEnvironmentCatalog/save");
  assert.equal(request[2].args.request.id, "one");
  controller.abort();
  assert.equal(request[3].aborted, true);
});
