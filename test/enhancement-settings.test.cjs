const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");

const PANEL = "settings.enhancement.panel";

function reactHooks() {
  const states = [],
    refs = [];
  let cursor = 0,
    effects = [];
  return {
    reset() {
      cursor = 0;
      effects = [];
    },
    runEffects() {
      const pending = effects;
      effects = [];
      for (const effect of pending) effect();
    },
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, get) => get(),
    useState(initial) {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === "function" ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    useEffect(effect) {
      effects.push(effect);
    },
  };
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const PANEL_ROWS = [
  {
    options: { name: PANEL, id: "idle-compaction", order: 25, label: "上下文压缩" },
  },
];

function setup({ plugins = [], writes = [], toggles = [] } = {}) {
  const React = reactHooks();
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
              name === "react" ? React : { Switch: "native-switch" },
            );
          },
        },
      },
    },
  );
  const value = { ultracodeDefault: false };
  const form = {
    getSnapshot: () => ({
      status: "ready",
      writable: true,
      value,
      base: { ...value },
      user: {},
    }),
    subscribe: () => () => {},
    set: async (key, next) => {
      writes.push([key, next]);
      return true;
    },
  };
  const registrations = [];
  const injections = [];
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, register) => {
        injections.push(name);
        return register();
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
      getVersion: () => 7,
      entries: (name) => {
        assert.equal(name, PANEL);
        return PANEL_ROWS;
      },
      subscribe: (name) => {
        assert.equal(name, PANEL);
        return () => {};
      },
    },
    configForms: {
      get: (namespace) => {
        assert.equal(namespace, "enhancement-settings");
        return form;
      },
      whileServed: (names, register) => {
        assert.deepEqual([...names], ["enhancement-settings"]);
        // An empty Config has no served form in the real host.
        return () => {};
      },
    },
    remote: {
      pluginManager: {
        listPlugins: async () => ({ ok: true, value: plugins }),
        setPluginEnabled: async (entryId, enabled) => {
          toggles.push([entryId, enabled]);
          const row = plugins.find((entry) => entry.entryId === entryId);
          if (row) row.enabled = enabled;
          return { ok: true, value: undefined };
        },
      },
    },
  };
  plugin.apply(ctx);
  const { options, component } = registrations[0];
  const props = options.inject();
  const rows = props.hooks.tabs.getSnapshot();
  const draw = () => {
    React.reset();
    const tree = render(
      component({
        close: () => {},
        useTabs: (selector) => selector(rows),
        renderSlot: (name, slotProps, filter) => ({
          type: "panel-slot",
          props: { name, ...slotProps, ...filter },
        }),
      }),
    );
    React.runEffects();
    return tree;
  };
  return { options, props, draw, writes, toggles, plugins, injections };
}

test("Harness enhancement is one settings section owning the panel slot", () => {
  const { options, injections } = setup();
  assert.equal(injections[0], "settings.section");
  assert.equal(options.name, "settings.section");
  assert.equal(options.id, "enhancement-settings");
  assert.equal(options.order, 25);
  assert.equal(options.label, "Harness增强");
  assert.deepEqual(JSON.parse(JSON.stringify(options.children)), {
    [PANEL]: { kind: "list", scope: "root" },
  });
});

test('daily management UI has no retired strategy or profile switch',async()=>{
 const f=setup(); f.draw(); await settle(); const tree=f.draw();
 assert(!JSON.stringify(tree).includes('Ultracode'));
 assert(!JSON.stringify(tree).includes('功能清单'));
 assert(!JSON.stringify(tree).includes('--profile enhanced'));
 assert.equal(f.writes.length,0);assert.equal(f.toggles.length,0);
});

test("the section exposes its child pages as ordered tabs", () => {
  const { props, draw } = setup();
  assert.deepEqual(
    props.hooks.tabs.getSnapshot().map((row) => [row.id, row.label]),
    [
      ["idle-compaction", "上下文压缩"],
    ],
  );
  const tabs = find(draw(), "button").filter((node) => node.props.role === "tab");
  assert.deepEqual(
    tabs.map((node) => node.children[0]),
    ["Harness增强", "上下文压缩"],
  );
  assert.equal(tabs[0].props["aria-selected"], true);
  assert.equal(find(draw(), "panel-slot").length, 0);

  tabs[1].props.onClick();
  draw();
  const slot = find(draw(), "panel-slot");
  assert.equal(slot.length, 1);
  assert.equal(slot[0].props.name, PANEL);
  assert.equal(slot[0].props.only, "idle-compaction");
});

test("feature switches drive native plugin entries without an orchestration policy", async () => {
  const plugins = [{entryId:"include:claude-context",enabled:true}];
  const writes = [],
    toggles = [];
  const { draw } = setup({ plugins, writes, toggles });
  draw();
  await settle();
  const switches = find(draw(), "native-switch");
  assert.equal(switches.length, 1);
  assert.equal(switches[0].props.checked, true);
  assert.equal(switches[0].props.disabled, false);

  await switches[0].props.onChange(false);
  await settle();
  assert.deepEqual(toggles, [
    ["include:claude-context", false],
  ]);
  assert.equal(find(draw(), "native-switch")[0].props.checked, false);

  assert.deepEqual(writes, []);
});
