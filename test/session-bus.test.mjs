import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const z = {
  object: () => ({passthrough() { return this; }}),
  record: () => ({optional() { return this; }}),
  string: () => ({}),
  boolean: () => ({}),
};
const sandbox = {
  z,
  defineDomain: (value) => value,
  defineTool: (value) => value,
  createUserMessage: (value) => value,
};
const code = fs.readFileSync(new URL('../modules/session-bus.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.BusService = BusService; this.resolveSessionPrefix = resolveSessionPrefix; this.formatBusList = formatBusList;', sandbox);

function setup({archived = [], agents = {}} = {}) {
  let stored = {grants: {}};
  const domain = {global: {
    get: () => stored,
    set: async (value) => { stored = value; },
  }};
  const flushed = [];
  const ctx = {
    workspaceRegistry: {archivedSessionIds: archived},
    agents: {get: (id) => agents[id]},
    sessions: {flush: async (session) => { flushed.push(session); }},
  };
  return {ctx, domain, flushed};
}

function makeAgent(id, {origin = 'user'} = {}) {
  return {
    id,
    session: {header: {origin}, id},
    sent: null,
    followup(message) { this.sent = message; },
  };
}

test('grants are explicit, reversible and scoped to the sending session', async () => {
  const {ctx, domain} = setup();
  const service = new sandbox.BusService(ctx, domain);
  await service.grant('a', 'b');
  await service.grant('a', 'c');
  assert.deepEqual([...service.authorized('a')].sort(), ['b', 'c']);
  assert.deepEqual([...service.authorized('b')], []);
  await service.revoke('a', 'b');
  assert.deepEqual([...service.authorized('a')], ['c']);
  await assert.rejects(() => service.grant('a', 'a'), /自己/);
});

test('session prefixes resolve exactly, uniquely or not at all', () => {
  const items = [{sessionId: 'abcdef'}, {sessionId: 'abcxyz'}];
  assert.equal(sandbox.resolveSessionPrefix(items, 'abcdef').sessionId, 'abcdef');
  assert.equal(sandbox.resolveSessionPrefix([{sessionId: 'abcdef'}], 'abc').sessionId, 'abcdef');
  assert.throws(() => sandbox.resolveSessionPrefix(items, 'abc'), /不唯一/);
  assert.equal(sandbox.resolveSessionPrefix(items, 'zzz'), undefined);
});

test('an authorized send becomes a relay user message and flushes the target session', async () => {
  const target = makeAgent('b');
  const {ctx, domain, flushed} = setup({agents: {b: target}});
  const service = new sandbox.BusService(ctx, domain);
  await service.grant('a', 'b');
  const sent = await service.send('a', 'b', 'hello');
  assert.equal(sent.sent, true);
  assert.equal(sent.targetSessionId, 'b');
  assert.equal(target.sent.source.kind, 'agent-message');
  assert.equal(target.sent.source.form, 'relay');
  assert.equal(target.sent.source.senderSessionId, 'a');
  assert.match(target.sent.content[0].text, /Peer message/);
  assert.deepEqual(flushed, [target.session]);
});

test('unauthorized, self, empty, oversized, archived and inactive targets are refused', async () => {
  const active = makeAgent('b');
  const sub = makeAgent('s', {origin: 'subagent'});
  const {ctx, domain} = setup({archived: ['z'], agents: {b: active, s: sub}});
  const service = new sandbox.BusService(ctx, domain);
  await assert.rejects(() => service.send('a', 'b', 'hello'), /尚未授权/);
  await assert.rejects(() => service.send('a', 'a', 'hello'), /自己/);
  await service.grant('a', 'b');
  await service.grant('a', 'z');
  await service.grant('a', 's');
  await service.grant('a', 'missing');
  await assert.rejects(() => service.send('a', 'b', '   '), /不能为空/);
  await assert.rejects(() => service.send('a', 'b', 'x'.repeat(16001)), /16000/);
  await assert.rejects(() => service.send('a', 'z', 'hello'), /归档/);
  await assert.rejects(() => service.send('a', 'missing', 'hello'), /未运行/);
  await assert.rejects(() => service.send('a', 's', 'hello'), /子代理/);
});

test('a user-stopped target is refused until the user sends a message again', async () => {
  const target = makeAgent('b');
  const {ctx, domain} = setup({agents: {b: target}});
  const service = new sandbox.BusService(ctx, domain);
  await service.grant('a', 'b');
  await service.observe({id: 'b'}, {type: 'turn/end', data: {reason: {kind: 'aborted', reason: {kind: 'user'}}}});
  await assert.rejects(() => service.send('a', 'b', 'hello'), /停止/);
  assert(new sandbox.BusService(ctx, domain).stopped.has('b'));
  await service.observe({id: 'b'}, {type: 'user/message', data: {source: {kind: 'user'}}});
  assert.equal((await service.send('a', 'b', 'hello')).sent, true);
  assert(!new sandbox.BusService(ctx, domain).stopped.has('b'));
});

test('the list output trims long IDs and marks running sessions', () => {
  const text = sandbox.formatBusList(
    [{sessionId: '123456789012345678', projections: {values: {title: 'T'}}, running: true}],
    ['abcdef'],
  );
  assert.match(text, /\[运行中\]/);
  assert.match(text, /已授权发送到/);
  assert.match(text, /1234567890123456…/);
});
