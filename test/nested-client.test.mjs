import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

test("a list change invalidates an in-flight completion response before it can notify", async () => {
  let plugin,
    lastNotices = [],
    emitted,
    posted = 0,
    warned = 0;
  const effects = [],
    registrations = [],
    requests = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => {
      let value = typeof initial === "function" ? initial() : initial;
      return [
        value,
        (next) => {
          value = typeof next === "function" ? next(value) : next;
          if (Array.isArray(value)) lastNotices = value;
        },
      ];
    },
    useRef: (value) => ({ current: value }),
    useEffect: (callback) => effects.push(callback),
  };
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../plugins/nested-sessions/lib/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            plugin = entry.factory(() => React);
          },
        },
      },
      localStorage: { getItem: () => null },
      Notification: class {
        static permission = "granted";
        constructor() {
          posted++;
        }
        close() {}
      },
      AbortSignal,
      setInterval: () => 1,
      clearInterval: () => {},
      console: { warn: () => warned++ },
    },
  );
  const ctx = {
    effect: () => {},
    slots: {
      inject: (_, fn) => fn(),
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: {} }),
        subscribe: (fn) => {
          emitted = fn;
          return () => {};
        },
      },
    },
    connection: {
      rpc: { call: () => new Promise((resolve) => requests.push(resolve)) },
    },
  };
  plugin.apply(ctx);
  const element = registrations
    .find((item) => item.options.name === "shell.overlay")
    .component();
  element.type(element.props);
  const cleanup = effects.at(-1)();
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  requests.shift()({ ok: true, value: {} });
  await settle();
  assert.equal(warned, 0, "an older running backend remains compatible until normal restart");
  emitted();
  const stale = requests.shift();
  emitted();
  stale({
    ok: true,
    value: {
      completions: [
        {
          sessionId: "child",
          status: "completed",
          outcomeSeq: 1,
          notificationEligible: true,
        },
      ],
    },
  });
  await settle();
  assert.equal(
    posted,
    0,
    "a stale completion must never reach the operating system",
  );
  assert.equal(lastNotices.length, 0);
  assert.equal(
    requests.length,
    1,
    "the invalidated response must trigger an immediate fresh read",
  );
  requests.shift()({ ok: true, value: { completions: [] } });
  await settle();
  cleanup();
});

test("completion notices skip history, current work, duplicates and ineligible outcomes", () => {
  let plugin;
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../plugins/nested-sessions/lib/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            plugin = entry.factory(() => ({}));
          },
        },
      },
    },
  );
  const done = (id, seq, extra = {}) => ({
    sessionId: id,
    outcomeSeq: seq,
    status: "completed",
    notificationEligible: true,
    ...extra,
  });
  let value = plugin.completionUpdates(null, [done("old", 1)], "current");
  assert.equal(value.notifications.length, 0);
  value = plugin.completionUpdates(
    value.seen,
    [
      done("old", 1),
      done("new", 2),
      done("current", 2),
      done("stopped", 2, { notificationEligible: false }),
      done("failed", 2, { status: "error" }),
    ],
    "current",
  );
  assert.deepEqual(
    Array.from(value.notifications, (item) => item.sessionId),
    ["new"],
  );
  assert.equal(
    plugin.completionUpdates(value.seen, [done("new", 2)], "current")
      .notifications.length,
    0,
  );
  assert.equal(
    plugin.completionUpdates(value.seen, [done("new", 3)], "current")
      .notifications.length,
    1,
  );
  const hidden = plugin.completionUpdates(value.seen, [], "current");
  assert.equal(
    plugin.completionUpdates(hidden.seen, [done("new", 2)], "current")
      .notifications.length,
    0,
    "restoring access must not repeat a previously seen completion",
  );
});

test("split addresses accept one ordinary native session identity only", () => {
  let plugin;
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../plugins/nested-sessions/lib/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            plugin = entry.factory(() => ({}));
          },
        },
      },
    },
  );
  assert.equal(
    plugin.splitSessionId("dsh-resource://linked-session/session-abc_1"),
    "session-abc_1",
  );
  for (const bad of [
    "https://example.com",
    "dsh-resource://linked-session/../secret",
    "dsh-resource://linked-session/a/b",
    "dsh-resource://linked-session/a?token=x",
    "dsh-resource://linked-session/" + "a".repeat(201),
  ])
    assert.equal(plugin.splitSessionId(bad), undefined);
});

test("native attention state uses the Map and pending interaction takes priority over running", () => {
  let plugin;
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../plugins/nested-sessions/lib/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            plugin = entry.factory(() => ({}));
          },
        },
      },
    },
  );
  const item = { id: "child", running: false },
    link = { status: "running" };
  for (const kind of ["question", "approval", "plan-review"]) {
    const states = new Map([
      [item.id, { running: true, pendingInteraction: { kind } }],
    ]);
    assert.equal(plugin.progressStatus(item, link, states), kind);
    assert.equal(plugin.attentionGroup(kind), "needs-input");
  }
  const running = new Map([[item.id, { running: true }]]);
  assert.equal(
    plugin.progressStatus(item, { status: "completed" }, running),
    "running",
  );
  assert.equal(
    plugin.progressStatus(
      item,
      { status: "stopped", stoppedByUser: true },
      running,
    ),
    "stopped",
  );
  assert.equal(
    plugin.progressStatus(
      item,
      null,
      new Map([[item.id, { completionUnread: true }]]),
    ),
    "unread",
  );
  assert.equal(plugin.attentionGroup("unread"), undefined);
  assert.equal(
    plugin.progressStatus(
      item,
      { status: "blocked" },
      new Map([[item.id, { completionUnread: true }]]),
    ),
    "blocked",
  );
  assert.equal(plugin.attentionGroup("queued"), "working");
  assert.equal(plugin.attentionGroup("completed"), "completed");
  assert.equal(plugin.attentionGroup("stopped"), undefined);
  assert.equal(plugin.progressStatus(item, null, new Map()), "idle");
});

test("nested tree preserves sibling ordering, descendants and orphan history without cycling", () => {
  let plugin;
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../plugins/nested-sessions/lib/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            plugin = entry.factory(() => ({}));
          },
        },
      },
    },
  );
  const rows = [
    { id: "parent" },
    { id: "a", updatedAt: 1 },
    { id: "b", updatedAt: 2 },
    { id: "grandchild" },
  ];
  const result = plugin.familyTree(
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "b", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
      { sessionId: "missing", parentId: "a" },
    ],
    rows,
  );
  assert.deepEqual([...result.roots], ["parent"]);
  assert.deepEqual([...result.children.get("parent")], ["b", "a"]);
  assert.equal(result.parents.get("grandchild"), "a");
  assert.equal(result.parents.has("missing"), false);
  const cycle = plugin.familyTree(
    [
      { sessionId: "a", parentId: "b" },
      { sessionId: "b", parentId: "a" },
    ],
    rows,
  );
  assert.equal(cycle.roots.length, 1);
  assert.equal(cycle.parents.size, 1);
  const focus = plugin.familyTree(
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
    ],
    [...rows, { id: "new-root" }],
    "new-root",
  );
  assert.deepEqual([...focus.roots], ["new-root", "parent"]);
  const childFocus = plugin.familyTree(
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
    ],
    rows,
    "grandchild",
  );
  assert.deepEqual([...childFocus.roots], ["parent"]);
  assert.equal(childFocus.parents.get("grandchild"), "a");
  const visible = plugin.sidebarRows(
    ["a", "unrelated", "parent", "grandchild"],
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
    ],
    new Set(["parent"]),
  );
  assert.deepEqual(
    Array.from(visible, (row) => [row.id, row.depth, row.hidden]),
    [
      ["parent", 0, false],
      ["a", 1, true],
      ["grandchild", 2, true],
      ["unrelated", 0, false],
    ],
  );
  const orphan = plugin.sidebarRows(
    ["a", "unrelated"],
    [{ sessionId: "a", parentId: "missing" }],
  );
  assert.deepEqual(
    Array.from(orphan, (row) => [row.id, row.depth, row.hidden]),
    [
      ["a", 0, false],
      ["unrelated", 0, false],
    ],
  );
  const linked = [{ sessionId: "a", parentId: "parent" }];
  assert.equal(
    plugin.hasPartialFamily(["a"], linked, new Set(["a", "parent"])),
    true,
  );
  assert.equal(
    plugin.hasPartialFamily(["a", "parent"], linked, new Set(["a", "parent"])),
    false,
  );
  assert.equal(plugin.hasPartialFamily(["a"], linked, new Set(["a"])), false);
  const registrations = [];
  plugin.apply({
    effect: () => {},
    slots: {
      inject: (_name, callback) => {
        const result = callback();
        if (result?.next)
          for (const _ of result) {
          }
      },
      register: (options) => {
        registrations.push(options);
        return () => {};
      },
    },
  });
  assert.deepEqual(
    registrations.map((row) => row.name),
    [
      "shell.overlay",
      "sidebar.right.pane.tab",
      "nested.split.conversation",
      "conversation.session.header.actions",
      "main",
    ],
  );
});
