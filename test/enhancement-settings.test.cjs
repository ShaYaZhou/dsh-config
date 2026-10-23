const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");

function load() {
  let plugin;
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, "../plugins/enhancement-settings/lib/client.js"),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (value) => {
            plugin = value.factory((name) =>
              name === "react"
                ? {
                    createElement: (type, props, ...children) => ({ type, props, children }),
                    useSyncExternalStore: (_subscribe, get) => get(),
                    useState: (initial) => [
                      typeof initial === "function" ? initial() : initial,
                      () => {},
                    ],
                    useRef: (value) => ({ current: value }),
                    useEffect: () => {},
                  }
                : { Switch: "native-switch" },
            );
          },
        },
      },
    },
  );
  return plugin;
}

function setup() {
  const registrations = [];
  const writes = [];
  const rows = [
    { id: "idle-compaction", order: 25, label: "上下文压缩" },
    { id: "local-environments", order: 28, label: "本地环境" },
  ];
  const value = {
    team: true,
    worktree: true,
    browser: true,
    sessionBus: true,
    claudeContext: true,
    usageReport: true,
    ultracodeDefault: false,
  };
  const snapshot = {
    status: "ready",
    writable: true,
    value,
    base: { ...value },
    user: {},
  };
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async (key, next) => {
      writes.push([key, next]);
      return true;
    },
  };
  const slots = {
    inject: (_name, register) => register(),
    register: (options, component) => {
      registrations.push({ options, component });
      return () => {};
    },
    getVersion: () => 1,
    entries: () => rows.map((row) => ({ options: row })),
    subscribe: () => () => {},
  };
  const ctx = {
    effect: (fn) => fn(),
    slots,
    configForms: {
      get: (namespace) => {
        assert.equal(namespace, "enhancement-settings");
        return form;
      },
      whileServed: (names, register) => {
        assert.deepEqual([...names], ["enhancement-settings"]);
        return register();
      },
    },
  };
  return { ctx, registrations, writes, rows };
}

function render(node) {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return render(node.type(node.props));
  return { ...node, children: (node.children ?? []).map(render) };
}

function find(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type));
  if (!node || typeof node !== "object") return [];
  return node.type === type ? [node] : find(node.children, type);
}

test("one settings entry owns the local enhancement pages and keeps close for its children", () => {
  const { ctx, registrations, rows } = setup();
  const { apply } = load();
  apply(ctx);
  const { options, component } = registrations[0];
  assert.equal(options.name, "settings.section");
  assert.equal(options.id, "enhancement-settings");
  assert.equal(options.label, "Harness增强");
  assert.deepEqual(JSON.parse(JSON.stringify(options.children)), {
    "settings.enhancement.panel": { kind: "list", scope: "root" },
  });

  const calls = [];
  const tree = component({
    close: () => calls.push("close"),
    renderSlot: (name, props, only) => {
      calls.push([name, props, only]);
      return { type: "slot" };
    },
    useTabs: (selector) => selector(rows),
  });
  assert.equal(calls[0][0], "settings.enhancement.panel");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { only: rows[0].id });
  assert.equal(typeof calls[0][1].close, "function");
  assert.equal(find(render(tree), "slot").length, 1);
});

test("feature switches write through the shared form", async () => {
  const { ctx, registrations, writes } = setup();
  load().apply(ctx);
  const switches = find(render(registrations[0].component({
    close: () => {},
    renderSlot: () => null,
    useTabs: (selector) => selector([]),
  })), "native-switch");
  assert.equal(switches.length, 7);
  assert.equal(switches[0].props.checked, true);
  assert.equal(switches[6].props.checked, false);
  await switches[0].props.onChange(false);
  await switches[6].props.onChange(true);
  assert.deepEqual(writes, [["team", false], ["ultracodeDefault", true]]);
});
