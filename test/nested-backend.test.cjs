const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');

let z;
try { ({ z } = createRequire(path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/package.json'))('zod')); } catch {}
const nativeTest = (title, body) => test(title, { skip: !z && 'Requires the installed Harness Zod runtime' }, body);
function fixture() {
  let next = 0, denied;
  const records = new Map(), agents = new Map(), deliveries = [];
  const domain = { state: { links: {}, stopped: {} }, global: { get: () => domain.state, set: async value => { domain.state = JSON.parse(JSON.stringify(value)); } } };
  const make = (sessionId, meta = {}) => {
    records.set(sessionId, { meta: { id: sessionId, cwd: '/fixture', agentPreset: 'standard', ...meta }, events: [] });
    const agent = { id: sessionId, status: 'idle', session: { id: sessionId }, cancel: (cause, options) => { agent.status = 'idle'; agent.cancelled = { cause, options }; agent.queued = []; }, steer: message => deliveries.push({ sessionId, message }), followup: message => deliveries.push({ sessionId, message }) };
    agents.set(sessionId, agent);
    return agent;
  };
  make('root'); make('unrelated');
  const ctx = {
    remoteAccess: { allows: resource => resource.id !== denied },
    agents: { get: sessionId => agents.get(sessionId) },
    sessions: { flush: async () => {} },
    workspaceRegistry: { list: () => [{ id: 'workspace', sessionIds: ['root'] }], archivedSessionIds: [] },
    sessionController: {
      inspect: async sessionId => { assert(records.has(sessionId)); return records.get(sessionId); },
      resolveAgent: async sessionId => ({ agent: agents.get(sessionId) }),
      create: async request => { const sessionId = 'fresh-' + ++next; make(sessionId, { agentPreset: request.agentPreset }); return { sessionId }; },
      fork: async ({ sessionId: parentId }) => { const sessionId = 'fork-' + ++next; make(sessionId, { parentSession: parentId }); records.get(sessionId).events = [...records.get(parentId).events]; return { sessionId }; },
      rename: async () => {},
      cancel: ({ sessionId }) => { agents.get(sessionId).status = 'idle'; },
    },
  };
  let source = fs.readFileSync(path.join(__dirname, '../plugins/nested-sessions/lib/index.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export (?:const|class|async function)/g, match => match.replace('export ', ''));
  source += '\nmodule.exports={NestedSessions};';
  const sandbox = { module: { exports: {} }, z, Remote: () => () => {}, RemoteError: class extends Error { constructor(code, message) { super(message); this.code = code; } }, TypertRemoteService: class { constructor(context) { this.ctx = context; } }, defineDomain: value => value, createUserMessage: value => value, defineTool: value => value, Buffer };
  vm.runInNewContext(source, sandbox);
  const service = new sandbox.module.exports.NestedSessions(ctx, domain);
  return { service, domain, records, agents, deliveries, ctx, deny: value => { denied = value; } };
}

nativeTest('independent fresh/fork children can detach without deleting history', async () => {
  const f = fixture();
  f.records.get('root').events.push({ seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'kept' }] } } });
  const fresh = await f.service.start({ sessionId: 'root', title: 'A', context: 'fresh' });
  const fork = await f.service.start({ sessionId: fresh.sessionId, title: 'B', context: 'fork' });
  assert.equal(fresh.parentId, 'root'); assert.equal(fork.parentId, fresh.sessionId);
  assert.equal((await f.service.list({ sessionId: 'root' })).links.length, 2);
  f.records.get(fork.sessionId).events.push({ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'fork history' }] } } });
  await f.service.detach({ sessionId: fork.sessionId });
  assert.equal((await f.service.list({ sessionId: 'root' })).links.length, 1);
  assert((await f.service.read({ sessionId: fork.sessionId })).content.includes('fork history'));
});

nativeTest('fresh children inherit the latest selected preset after an old header was migrated', async () => {
  const f = fixture();
  f.records.get('root').meta.agentPreset = 'retired-preset';
  f.records.get('root').events.push({ type: 'agent-preset/selected', seq: 0, data: { agentPreset: 'standard' } });
  const child = await f.service.start({ sessionId: 'root', title: 'Migrated child', context: 'fresh' });
  assert.equal(f.records.get(child.sessionId).meta.agentPreset, 'standard');
  const explicit = await f.service.start({ sessionId: 'root', title: 'Explicit child', context: 'fresh', agentPreset: 'reviewer' });
  assert.equal(f.records.get(explicit.sessionId).meta.agentPreset, 'reviewer');
});

nativeTest('linked messages retain agent provenance and reject unrelated or user-stopped targets', async () => {
  const f = fixture(), child = await f.service.start({ sessionId: 'root', title: 'A', context: 'fresh' });
  await f.service.send({ sessionId: 'root', targetSessionId: child.sessionId, message: 'Check API' });
  assert.equal(f.deliveries[0].message.source.kind, 'agent-message');
  assert.equal(f.deliveries[0].message.source.senderSessionId, 'root');
  await assert.rejects(f.service.send({ sessionId: 'root', targetSessionId: 'unrelated', message: 'No' }), /outside/);
  await f.service.stop({ sessionId: child.sessionId });
  assert.equal(f.agents.get(child.sessionId).cancelled.options.keepInbox, false);
  await assert.rejects(f.service.send({ sessionId: 'root', targetSessionId: child.sessionId, message: 'No restart' }), /user stopped/i);
  await f.service.observe({ id: child.sessionId }, { type: 'user/message', data: { source: { kind: 'user' } } });
  await f.service.send({ sessionId: 'root', targetSessionId: child.sessionId, message: 'User resumed' });
});

nativeTest('stopping clears queued work and archived sessions cannot be revived by sends or starts', async () => {
  const f = fixture(), child = await f.service.start({ sessionId: 'root', title: 'A', context: 'fresh' });
  const agent = f.agents.get(child.sessionId); agent.queued = ['already queued']; agent.status = 'running';
  await f.service.stop({ sessionId: child.sessionId });
  assert.equal(agent.queued.length, 0); assert.equal(agent.status, 'idle');
  await f.service.observe({ id: child.sessionId }, { type: 'user/message', data: { source: { kind: 'user' } } });
  f.ctx.workspaceRegistry.archivedSessionIds.push(child.sessionId);
  await assert.rejects(f.service.send({ sessionId: 'root', targetSessionId: child.sessionId, message: 'No revival' }), /Archived/);
  await assert.rejects(f.service.start({ sessionId: child.sessionId, title: 'No new child', context: 'fresh' }), /Archived/);
  assert((await f.service.read({ sessionId: child.sessionId })).sessionId);
});

nativeTest('strict requests and session access guards reject before creating or disclosing data', async () => {
  const f = fixture();
  await assert.rejects(f.service.start({ sessionId: 'root', title: 'A', context: 'fresh', extra: true }), /Unrecognized|unrecognized/);
  await assert.rejects(f.service.start({ sessionId: 'root', title: 'A', context: 'fork', cwd: '/elsewhere' }), /retains/);
  await assert.rejects(f.service.read({ sessionId: '../escape' }), /Invalid|invalid/);
  const child = await f.service.start({ sessionId: 'root', title: 'A', context: 'fresh' });
  f.deny(child.sessionId);
  assert.equal((await f.service.list({ sessionId: 'root' })).links.length, 0);
  await assert.rejects(f.service.read({ sessionId: child.sessionId }), /not accessible/);
  await assert.rejects(f.service.send({ sessionId: 'root', targetSessionId: child.sessionId, message: 'No leak' }), /not accessible/);
});

nativeTest('completion is bounded and deduplicated, and never revives a stopped parent', async () => {
  const f = fixture(), child = await f.service.start({ sessionId: 'root', title: 'A', context: 'fresh' });
  f.records.get(child.sessionId).events.push({ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'x'.repeat(20000) }] } } });
  const complete = { seq: 2, type: 'turn/end', data: { reason: { kind: 'completed' } } };
  await f.service.observe({ id: child.sessionId }, complete);
  await f.service.observe({ id: child.sessionId }, complete);
  assert.equal(f.deliveries.length, 1);
  assert(f.deliveries[0].message.content[0].text.length < 8500);
  assert.equal(f.deliveries[0].message.source.kind, 'agent-message');
  await f.service.stop({ sessionId: 'root' });
  await f.service.observe({ id: child.sessionId }, { ...complete, seq: 3 });
  assert.equal(f.deliveries.length, 1);
});

nativeTest('failed and blocked child turns report explicit bounded outcomes without tool arguments', async () => {
  const f = fixture(), child = await f.service.start({ sessionId: 'root', title: 'Worker', context: 'fresh' });
  f.records.get(child.sessionId).events.push({ type: 'tool/call', seq: 1, data: { arguments: { token: 'secret-tool-argument' } } });
  const failure = { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'error', error: { code: 'FIXTURE_ERROR', message: 'failure'.repeat(1000), privateArguments: 'secret-tool-argument' } } } };
  f.records.get(child.sessionId).events.push(failure);
  await f.service.observe({ id: child.sessionId }, failure);
  await f.service.observe({ id: child.sessionId }, failure);
  assert.equal(f.deliveries.length, 1);
  assert(f.deliveries[0].message.content[0].text.includes('failed'));
  assert(f.deliveries[0].message.content[0].text.length < 1400);
  assert(!JSON.stringify(f.deliveries).includes('secret-tool-argument'));
  const read = await f.service.read({ sessionId: child.sessionId });
  assert.equal(read.outcome.kind, 'error'); assert.equal(read.outcome.code, 'FIXTURE_ERROR');
  assert(read.outcome.message.length < 1100);
  const blocked = { type: 'turn/end', seq: 3, data: { turn: 2, reason: { kind: 'blocked' } } };
  await f.service.observe({ id: child.sessionId }, blocked);
  assert(f.deliveries[1].message.content[0].text.includes('blocked and needs attention'));
  assert.equal((await f.service.list({ sessionId: 'root' })).links[0].lastOutcome, 'blocked');
});
