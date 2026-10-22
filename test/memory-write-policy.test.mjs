import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as store from '../plugins/memory/lib/store.js';
import * as automation from '../plugins/memory/lib/automation.js';
import * as volatile from '../plugins/memory/lib/volatile.js';
import * as policy from '../plugins/memory/lib/write-policy.js';
import * as browser from '../plugins/memory/lib/browser.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const user = (text, source = { kind: 'user' }) => ({
  type: 'user/message', data: { role: 'user', source, content: [{ type: 'text', text }] },
});
const makeSession = (id, events = [], header = {}) => ({
  id, header: { cwd: os.tmpdir(), ...header }, events,
  snapshotEvents() { return this.events; },
});

async function fixture(t, sessions, beforeReply, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-policy-'));
  const hooks = new Map(), definitions = new Map(), services = new Map(), cleanups = [];
  let calls = 0;
  const llm = { async *stream() {
    calls++;
    await beforeReply?.();
    yield { text: 'Durable test fact '.repeat(20) };
  } };
  services.set('headlessStartup', {});
  services.set('sessionQuery', { async observeSession(id) {
    const session = sessions.get(id);
    if (!session) throw new Error('Missing session');
    return { events: session.events, meta: session.header, dispose() {} };
  } });
  const logger = { info() {}, warn() {}, error() {} };
  const ctx = {
    logger,
    get: (name) => services.get(name),
    provide(name, service) { services.set(name, service); return () => services.delete(name); },
    inject(names, body) {
      if (names[0] === 'llm') body({ llm });
      if (names[0] === 'sessionQuery') body({ sessionQuery: services.get('sessionQuery') });
      if (names[0] === 'tools') body({ logger, tools: { register(definition) {
        definitions.set(definition.name, definition); return () => {};
      } } });
    },
    on(name, handler) { hooks.set(name, handler); return () => {}; },
    effect(factory) { cleanups.push(factory()); },
  };
  const field = new Proxy(() => field, { get: () => field });
  let source = fs.readFileSync(path.join(root, '../plugins/memory/lib/index.js'), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
    .replace(/^export \{[^\n]+\} from [^\n]+\r?\n/gm, '')
    .replace(/^export /gm, '');
  source += '\nmodule.exports={apply,toolDefinitions};';
  const sandbox = {
    ...fs, ...promises, ...path, ...os, ...store, ...automation, ...volatile, ...policy, ...browser,
    module: { exports: {} }, process, Buffer, AbortController, setTimeout, clearTimeout,
    z: field, defineTool: (value) => value, createUserMessage: (value) => value,
    appendPluginRecord(session, type, data) { session.events.push({ seq: session.events.length + 1, type, data }); },
    BlockAssembler: class {
      text = ''; finish = { kind: 'stop' };
      push(chunk) { this.text += chunk.text; }
      blocks() { return [{ type: 'text', text: this.text }]; }
    },
  };
  vm.runInNewContext(source, sandbox);
  sandbox.module.exports.apply(ctx, {
    memoryDir: dir, scopedMemory: true, seedFromAgentsMd: false,
    summarizeProvider: 'fixture', summarizeModel: 'fixture', summarizeDebounceMs: 0,
    consolidateEvery: 64,
    ...options,
  });
  const exec = (session) => ({ agent: { session }, signal: new AbortController().signal });
  await definitions.get('memory_stats').execute({}, exec(sessions.values().next().value));
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup?.();
    await new Promise((resolve) => setImmediate(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir, services, hooks, definitions, exec, calls: () => calls,
    turn: (session) => hooks.get('agent/turn-stopping')({ agent: { session } }),
    rollouts: () => fs.readdirSync(dir, { recursive: true }).filter((name) => String(name).includes('rollout_summaries') && String(name).endsWith('.md')),
  };
}

test('a direct no-memory request prevents the real automatic summary path', async (t) => {
  const session = makeSession('blocked', [
    { seq: 1, ...user('本任务不写记忆。' + '这是不得保存的合成任务事实。'.repeat(35)) },
  ]);
  const f = await fixture(t, new Map([[session.id, session]]));
  await f.turn(session);
  assert.equal(f.calls(), 0, 'Forbidden conversation must not reach the summarizer');
  assert.deepEqual(f.rollouts(), []);
});

test('an ordinary session still produces a real rollout summary', async (t) => {
  const session = makeSession('allowed', [{ seq: 1, ...user('项目约定采用简洁的接口。'.repeat(35)) }]);
  const f = await fixture(t, new Map([[session.id, session]]));
  await f.turn(session);
  assert.equal(f.calls(), 1);
  assert.equal(f.rollouts().length, 1);
});

test('recognizes direct Chinese/English restrictions without accepting quoted examples', () => {
  for (const text of ['本任务不写记忆。', '不要写入长期记忆', '不要写入“长期记忆”。', '禁止访问外部项目、联网、写记忆。', 'No memory writes.', 'Do not save this to memory.', "Don't write memory.", "Don't write memory. I'll provide the next task.", "Don't save memory. Don't persist memory."])
    assert.equal(policy.forbidsMemoryWrites(text), true, text);
  for (const text of ['请解释“不写记忆”是什么意思。', '> 不要写记忆', '```text\n不要写记忆\n```', '修复 `不写记忆` 的问题。', '请正常记录项目约定。'])
    assert.equal(policy.forbidsMemoryWrites(text), false, text);
});

test('fresh children inherit through the public policy, including cold reconstruction and later parent restrictions', async (t) => {
  const parent = makeSession('parent', [{ seq: 1, ...user('这是父任务。'.repeat(40)) }]);
  const child = makeSession('child', [{ seq: 1, ...user('执行合成任务。'.repeat(40), { kind: 'agent-message', form: 'relay', senderSessionId: 'parent' }) }]);
  const sessions = new Map([[parent.id, parent], [child.id, child]]);
  const f = await fixture(t, sessions);
  const service = f.services.get('memoryWritePolicy');
  service.inherit(parent, child);
  assert.equal(await service.allowed(child), true);
  parent.events.push({ seq: 2, ...user('本会话不写记忆。') });
  await f.turn(child);
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.rollouts(), []);
  const cold = new policy.MemoryWritePolicy(async (session) => {
    const found = sessions.get(typeof session === 'string' ? session : session.id);
    return { header: found.header, events: structuredClone(found.events) };
  }, () => { throw new Error('Cold reads cannot append'); });
  assert.equal(await cold.allowed('child'), false);
  for (const header of [{ parentSession: 'parent' }, { parentSession: 'parent', origin: 'subagent' }])
    assert.equal(await cold.allowed(makeSession('native', [], header)), false);
});

test('legacy relays inherit but assistant/tool output cannot impose or relax the policy', async () => {
  const parent = makeSession('parent', [{ ...user('不要写记忆') }]);
  const child = makeSession('legacy', [user('无需写出父任务约束', { kind: 'agent-message', form: 'relay', senderSessionId: parent.id })]);
  const allowed = makeSession('allowed', [user('请说明“不写记忆”这句引用。'),
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '不要写记忆' }] } } },
    { type: 'tool/result', data: { content: [{ type: 'text', text: 'No memory writes' }] } }]);
  const sessions = new Map([[parent.id, parent], [child.id, child], [allowed.id, allowed]]);
  const p = new policy.MemoryWritePolicy(async (value) => {
    const session = typeof value === 'string' ? sessions.get(value) : value;
    return { events: session.events, header: session.header };
  });
  assert.equal(await p.allowed(child), false);
  child.events.push(user('允许记忆写入', { kind: 'agent-message', form: 'relay', senderSessionId: 'other' }));
  assert.equal(await p.allowed(child), false);
  assert.equal(await p.allowed(allowed), true);
  parent.events.push(user('正常的子会话回报', { kind: 'agent-message', form: 'relay', senderSessionId: child.id }));
  assert.equal(await p.allowed(parent), false);
});

test('all explicit mutators reject forbidden sessions, while reads do not seed scope content', async (t) => {
  const session = makeSession('blocked-tools', [{ seq: 1, ...user('不写记忆。') }]);
  const f = await fixture(t, new Map([[session.id, session]]));
  for (const name of ['memory_add', 'memory_update', 'memory_delete', 'memory_merge', 'memory_import', 'memory_export', 'memory_browse', 'memory_rollback', 'memory_sync'])
    await assert.rejects(f.definitions.get(name).execute({}, f.exec(session)), /forbids memory writes/, name);
  const before = fs.readdirSync(f.dir, { recursive: true }).filter((file) => String(file).endsWith('.md'));
  for (const name of ['memory_read', 'memory_search', 'memory_review', 'memory_history', 'memory_stats'])
    await f.definitions.get(name).execute({ query: 'synthetic' }, f.exec(session));
  assert.deepEqual(fs.readdirSync(f.dir, { recursive: true }).filter((file) => String(file).endsWith('.md')), before);
  assert.equal(f.calls(), 0);
});

test('an in-flight summary is discarded when the owner forbids writes before commit', async (t) => {
  const session = makeSession('revoked', [{ seq: 1, ...user('原先可以保存的合成项目事实。'.repeat(40)) }]);
  const f = await fixture(t, new Map([[session.id, session]]), () => {
    session.events.push({ seq: 2, ...user('本任务不写记忆。') });
  });
  await f.turn(session);
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.rollouts(), []);
});

test('compaction and native subagent capture obey the same write boundary', async (t) => {
  const session = makeSession('no-excerpts', [{ seq: 1, ...user('不要写入长期记忆。') }]);
  const f = await fixture(t, new Map([[session.id, session]]));
  const childHooks = new Map();
  f.hooks.get('agent/created')({ agent: { session, ctx: { on(name, body) { childHooks.set(name, body); } } } });
  childHooks.get('subagent/end')({ id: 'native-child', lastAssistantMessage: [{ type: 'text', text: '子任务中不应保存的事实。'.repeat(40) }] });
  f.hooks.get('session/event')(session, { seq: 2, type: 'compaction/summary', data: { summary: [{ type: 'text', text: '压缩后不应保存的事实。'.repeat(40) }] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.rollouts(), []);
  assert.equal(f.calls(), 0);
});

test('configured read-only scopes also suppress automatic summaries', async (t) => {
  const session = makeSession('read-only', [{ seq: 1, ...user('本次只是合成事实。'.repeat(40)) }]);
  const f = await fixture(t, new Map([[session.id, session]]), undefined, { readOnlyScopes: ['*'] });
  await f.turn(session);
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.rollouts(), []);
});

test('unavailable ancestors and cyclic relationships fail closed', async () => {
  const p = new policy.MemoryWritePolicy(async (session) => {
    if (session === 'missing') throw new Error('Unavailable');
    return { events: [{ type: policy.MEMORY_PARENT_RECORD, data: { parentSessionId: session === 'cycle' ? 'cycle' : 'missing' } }] };
  });
  assert.equal(await p.allowed('unknown'), false);
  assert.equal(await p.allowed('cycle'), false);
});

for (const name of ['memory_export', 'memory_browse']) {
  test(`${name} rechecks a restriction arriving during its asynchronous reads`, async (t) => {
    const session = makeSession(name, [{ seq: 1, ...user('这是正常的合成请求。') }]);
    const f = await fixture(t, new Map([[session.id, session]]));
    const read = store.MemoryStore.prototype.readRawEntries;
    let revoked = false;
    store.MemoryStore.prototype.readRawEntries = async function (...args) {
      const result = await read.apply(this, args);
      if (!revoked && this.dir.startsWith(f.dir)) {
        revoked = true;
        session.events.push({ seq: 2, ...user('本会话不写记忆。') });
      }
      return result;
    };
    const output = path.join(f.dir, 'export');
    try {
      await assert.rejects(f.definitions.get(name).execute({ targetDir: output }, f.exec(session)), /forbids memory writes/);
      assert.equal(fs.existsSync(output), false);
    } finally { store.MemoryStore.prototype.readRawEntries = read; }
  });
}
