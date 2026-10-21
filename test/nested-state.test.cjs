const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  test = require("node:test"),
  { createRequire } = require("node:module");
let z;
try {
  ({ z } = createRequire(
    path.join(
      process.env.APPDATA || "",
      "npm/node_modules/@deepseek-ai/dsh/package.json",
    ),
  )("zod"));
} catch {}
const nativeTest = (name, body) =>
  test(name, { skip: !z && "Requires installed Harness Zod" }, body);
const link = {
  sessionId: "child",
  parentId: "root",
  title: "Saved task",
  kind: "fresh",
  wakeParent: true,
};
function fixture(initial) {
  const stores = new Map();
  let closed = 0;
  const ctx = {
    storage: {
      domain: {
        open: async (spec) => {
          if (!stores.has(spec.name))
            stores.set(spec.name, {
              value: JSON.parse(
                JSON.stringify(
                  spec.name === "nested_sessions"
                    ? initial
                    : spec.global.initial,
                ),
              ),
              spec,
            });
          const store = stores.get(spec.name);
          return {
            global: {
              get: () => JSON.parse(JSON.stringify(store.value)),
              set: async (value) => {
                store.value = spec.global.schema.parse(
                  JSON.parse(JSON.stringify(value)),
                );
              },
            },
            close: async () => closed++,
          };
        },
      },
    },
  };
  let source = fs
    .readFileSync(
      path.join(__dirname, "../plugins/nested-sessions/lib/state-store.js"),
      "utf8",
    )
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export /gm, "");
  source += "\nmodule.exports={openNestedStore};";
  const sandbox = {
    module: { exports: {} },
    z,
    defineDomain: (value) => value,
  };
  vm.runInNewContext(source, sandbox);
  return {
    open: () => sandbox.module.exports.openNestedStore(ctx),
    stores,
    closed: () => closed,
  };
}
function assertOldFormat(value) {
  const old = z.strictObject({
    links: z.record(
      z.string(),
      z.strictObject({
        sessionId: z.string(),
        parentId: z.string(),
        title: z.string(),
        kind: z.enum(["fresh", "fork"]),
        wakeParent: z.boolean(),
        lastReportedSeq: z.number().int().optional(),
        lastOutcome: z.enum(["completed", "error", "blocked"]).optional(),
      }),
    ),
    stopped: z.record(z.string(), z.boolean()),
  });
  old.parse(value);
}
nativeTest(
  "new collaboration preferences keep the shipped v1 relationship file readable on revert",
  async () => {
    const f = fixture({ links: { child: link }, stopped: {} }),
      store = await f.open();
    const next = store.global.get();
    next.links.child = {
      ...next.links.child,
      selection: { provider: "proxy", model: "small" },
      reason: "Review",
      status: "queued",
    };
    next.auto = { root: true };
    next.requested = { root: true };
    await store.global.set(next);
    const legacy = f.stores.get("nested_sessions").value;
    assertOldFormat(legacy);
    assert.equal(legacy.links.child.selection, undefined);
    assert.equal(store.global.get().links.child.selection.model, "small");
    assert.equal(store.global.get().requested.root, true);
    legacy.links.child.lastOutcome = "completed";
    assert.equal(store.global.get().links.child.status, "completed");
    await store.close();
    assert.equal(f.closed(), 2);
  },
);
nativeTest(
  "extended test-era v1 metadata migrates without dropping models, policy, stops or relationships",
  async () => {
    const f = fixture({
        links: {
          child: {
            ...link,
            selection: { provider: "proxy", model: "strong" },
            status: "running",
            lastReportedSeq: 12,
          },
        },
        stopped: { root: true },
        auto: { root: false },
        requested: { root: true },
      }),
      store = await f.open();
    assertOldFormat(f.stores.get("nested_sessions").value);
    const state = store.global.get();
    assert.equal(state.links.child.parentId, "root");
    assert.equal(state.links.child.selection.model, "strong");
    assert.equal(state.links.child.lastReportedSeq, 12);
    assert.equal(state.stopped.root, true);
    assert.equal(state.auto.root, false);
    assert.equal(state.requested.root, true);
    await store.close();
  },
);
