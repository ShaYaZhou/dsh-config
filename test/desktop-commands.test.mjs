import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
test("Rewind read RPC validates attached session and sequence without starting work", async () => {
  const source = fs.readFileSync(new URL('../plugins/rewind/lib/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('function isRecord(value) {', source.indexOf('async function previewImpact'));
  const end = source.indexOf('function renderFailures', start);
  assert(start >= 0 && end > start);
  const calls = [], events = Object.freeze([]), nodes = Object.freeze([]);
  const session = {snapshotEvents: () => events, surface: {nodes}};
  const box = {
    previewImpact: async (store, selected, seq, enabled) => {calls.push({selected, seq, enabled}); return {files: [], backupOff: !enabled};},
    listRewindCandidates: (seen, surface) => {assert.equal(seen, events); assert.equal(surface, nodes); return [];},
  };
  vm.runInNewContext(source.slice(start, end)+'\nthis.create = createRewindRpcHandler;', box);
  const handler = box.create({}, () => new Map([['fixture', {session}]]), () => true);
  assert.equal((await handler('preview', {sessionId:'fixture', seq:8})).ok, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].selected, session);
  for(const payload of [{sessionId:'fixture',seq:'8'},{sessionId:'missing',seq:8},{seq:8},null])
    assert.equal((await handler('preview',payload)).ok,false);
  assert.equal((await handler('unknown',{sessionId:'fixture'})).ok,false);
  assert.equal(calls.length,1);
  assert.equal((await handler('candidates',{sessionId:'fixture'})).ok,true);
  assert.equal(events.length,0); assert.equal(nodes.length,0);
});
test("desktop commands choose real native presets and preserve source sessions", async () => {
  let plugin;
  const listeners = new Map();
  let clicked = 0;
  const row = {
    querySelectorAll: () => [{ textContent: "help" }],
    dispatchEvent: (event) => {
      assert.equal(event.type, "mousedown");
      clicked++;
    },
  };
  const document = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: () => {},
    querySelectorAll: () => [row],
  };
  const source = fs.readFileSync(
    new URL("../plugins/desktop-commands/lib/client.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    document,
    MouseEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    window: {
      __ModuleLoader__: {
        load: (definition) => {
          plugin = definition.factory();
        },
      },
    },
  });
  assert(plugin.inject.includes("remote.commands"));
  assert(plugin.inject.includes("remote.agentPresets"));
  const commands = new Map(),
    started = [],
    opened = [],
    drafts = [];
  const context = {
    effect: (factory) => factory(),
    commandUi: {
      register: (definition) => {
        assert(!commands.has(definition.name));
        commands.set(definition.name, definition);
        return () => {};
      },
    },
    uiWorkspace: {
      startSession: (...args) => started.push(args),
      openSession: (id) => opened.push(id),
      forkSession: async () => "forked",
    },
    sessions: {
      subagentAddress: () => undefined,
      binding: () => ({
        session: {
          getSnapshot: () => ({
            projectionValues: { agentPreset: "reviewer" },
          }),
        },
      }),
      list: {
        getSnapshot: () => ({
          byId: {
            old: { id: "old", title: "Old task", updatedAt: 1 },
            blank: { id: "blank", blank: true },
            child: { id: "child", origin: "subagent" },
          },
        }),
      },
      scope: () => ({}),
    },
    remote: {
      agentPresets: {
        list: async () => ({
          ok: true,
          value: {
            presets: [
              { id: "reviewer", name: "Reviewer" },
              { id: "broken", broken: "missing" },
            ],
          },
        }),
      },
      commands: {
        list: async () => ({
          ok: true,
          value: [{ name: "btw", description: "side question" }],
        }),
      },
    },
    conversation: {
      input: {
        for: () => ({
          setDraft: (value) => drafts.push(value),
          focus: () => {},
        }),
      },
    },
  };
  plugin.apply(context);
  assert.deepEqual([...commands.keys()].sort(), [
    "agents",
    "clear",
    "fork",
    "help",
    "resume",
  ]);
  assert(!commands.has("btw"));
  assert(!commands.has("rewind"));
  const roles = await commands.get("agents").ui.options();
  assert.equal(roles.length, 2);
  commands.get("agents").ui.onSelect(roles[0], { sessionId: "current" });
  assert.equal(started[0][1].agentPreset, "reviewer");
  commands.get("clear").ui.run({ sessionId: "current" });
  assert.equal(started[1][1].agentPreset, "reviewer");
  assert.equal(started[1][1].clearPreviousDraft, true);
  assert.equal(opened.length, 0);
  const resumed = await commands.get("resume").ui.options();
  assert.equal(resumed.length, 1);
  commands.get("resume").ui.onSelect(resumed[0], { sessionId: "current" });
  assert.equal(opened[0], "old");
  commands.get("help").ui.onSelect({ id: "btw" }, { sessionId: "current" });
  assert.equal(drafts[0], "/btw ");
  const event = {
    key: "Enter",
    target: { closest: () => ({ textContent: "/help" }) },
    preventDefault: () => {},
    stopImmediatePropagation: () => {},
  };
  listeners.get("keydown")(event);
  assert.equal(clicked, 1, "Exact command must win over a fuzzy skill");
  listeners.get("keydown")({ ...event, key: "ArrowDown" });
  listeners.get("keydown")(event);
  assert.equal(clicked, 1, "Explicit picker navigation must stay in control");
  listeners.get("input")();
  listeners.get("keydown")(event);
  assert.equal(clicked, 2);
});
test("rewind advertises argument support without replacing the original command handlers", () => {
  const source = fs.readFileSync(
    new URL("../plugins/rewind/lib/index.js", import.meta.url),
    "utf8",
  );
  for (const name of ["rewind", "undo"])
    assert(
      source.includes('name: "' + name + '",') &&
        source.includes('input: {hint:"[@消息序号 chat|code|both]"}'),
    );
  const client = fs.readFileSync(
    new URL("../plugins/rewind/lib/client.js", import.meta.url),
    "utf8",
  );
  assert(client.includes("dsh-rewind-header"));
  assert(client.includes("createRewindBridge"));
});

test('Rewind distinguishes actual restoration from absent or partial checkpoints',()=>{
 const source=fs.readFileSync(new URL('../plugins/rewind/lib/index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('export function completeFileRestore'),source.indexOf('async function restoreFiles')).replace('export ','');
 const scope={};vm.runInNewContext(code+'\nthis.check=completeFileRestore;',scope);
 assert.equal(scope.check({supported:true,restored:1,deleted:0,failed:0,skipped:0}),true);
 assert.equal(scope.check({supported:true,restored:0,deleted:1,failed:0,skipped:0}),true);
 for(const outcome of [{},{supported:true,restored:0,deleted:0,failed:0,skipped:0},{supported:true,restored:1,deleted:0,failed:1,skipped:0},{supported:true,restored:1,deleted:0,failed:0,skipped:1}])assert.equal(scope.check(outcome),false);
});
