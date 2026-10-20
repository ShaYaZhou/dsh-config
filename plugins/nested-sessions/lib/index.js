import { z } from 'zod';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'nested-sessions';
export const inject = ['sessionController', 'storage', 'agents', 'tools', 'remoteAccess', 'typert', 'sessions', 'workspaceRegistry'];
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);
const text = z.string().trim().min(1).max(16000);
const schemas = {
  list: z.strictObject({ sessionId: id.optional() }).default({}),
  start: z.strictObject({ sessionId: id, title: z.string().trim().min(1).max(160), prompt: text.optional(), context: z.enum(['fresh', 'fork']), agentPreset: id.optional(), cwd: z.string().min(1).max(4000).optional(), wakeParent: z.boolean().optional() }),
  detach: z.strictObject({ sessionId: id }),
  send: z.strictObject({ sessionId: id, targetSessionId: id, message: text }),
  read: z.strictObject({ sessionId: id, limit: z.number().int().min(1).max(40).optional() }),
  stop: z.strictObject({ sessionId: id }),
};
const linkSchema = z.strictObject({ sessionId: id, parentId: id, title: z.string(), kind: z.enum(['fresh', 'fork']), wakeParent: z.boolean(), lastReportedSeq: z.number().int().optional(), lastOutcome: z.enum(['completed', 'error', 'blocked']).optional() });
const domainSpec = defineDomain({ name: 'nested_sessions', version: 1, tables: {}, global: { initial: { links: {}, stopped: {} }, schema: z.strictObject({ links: z.record(z.string(), linkSchema), stopped: z.record(z.string(), z.boolean()) }) } });
const initializers = [];
const messageText = data => {
  const message = data?.message ?? data;
  return Array.isArray(message?.content) ? message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
};
const limited = (value, size = 8000) => value.length > size ? value.slice(0, size) + '\n[truncated]' : value;
function outcomeOf(reason) {
  if (!reason) return undefined;
  return { kind: reason.kind, ...(reason.kind === 'error' ? { code: reason.error?.code ?? 'UNKNOWN', message: limited(String(reason.error?.message ?? 'The turn failed'), 1000) } : {}), ...(reason.kind === 'aborted' ? { cause: reason.reason?.kind ?? 'unknown' } : {}) };
}
function parse(method, request) {
  const result = schemas[method].safeParse(request);
  if (!result.success) throw new RemoteError('gateway/bad-request', result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), {});
  return result.data;
}
function familyRoot(state, sessionId) {
  const visited = new Set();
  while (Object.hasOwn(state.links, sessionId)) {
    if (visited.has(sessionId)) throw new Error('Nested session relationship contains a cycle');
    visited.add(sessionId);
    sessionId = state.links[sessionId].parentId;
  }
  return sessionId;
}

export class NestedSessions extends TypertRemoteService {
  static inject = inject;
  constructor(ctx, domain) {
    super(ctx, 'nestedSessions', { namespace: 'nestedSessions' });
    for (const initialize of initializers) initialize.call(this);
    this.domain = domain;
    this.tail = Promise.resolve();
    this.disposed = false;
  }
  serialize(action) {
    const pending = this.tail.then(action);
    this.tail = pending.catch(() => {});
    return pending;
  }
  assertAccess(sessionId) {
    if (!this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) throw new RemoteError('gateway/forbidden', 'Session is not accessible', {});
  }
  assertFamily(source, target) {
    const state = this.domain.global.get();
    if (familyRoot(state, source) !== familyRoot(state, target)) throw new RemoteError('gateway/forbidden', 'The target is outside this linked session family', {});
  }
  assertActive(sessionId) {
    if (this.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) throw new RemoteError('session/agent-busy', 'Archived sessions cannot start or receive agent work; unarchive the session first', { reason: 'archived' });
  }
  async agent(sessionId) {
    this.assertActive(sessionId);
    const found = await this.ctx.sessionController.resolveAgent(sessionId);
    if (found.error) throw found.error;
    return found.agent;
  }
  async list(request) {
    const input = parse('list', request);
    if (input.sessionId) this.assertAccess(input.sessionId);
    const state = this.domain.global.get();
    const root = input.sessionId ? familyRoot(state, input.sessionId) : undefined;
    return { links: Object.values(state.links).filter(link => (!root || familyRoot(state, link.sessionId) === root) && this.ctx.remoteAccess.allows({ kind: 'session', id: link.sessionId }) && this.ctx.remoteAccess.allows({ kind: 'session', id: link.parentId })).map(link => ({ ...link, stoppedByUser: state.stopped[link.sessionId] === true })) };
  }
  async start(request) {
    const input = parse('start', request);
    this.assertAccess(input.sessionId);
    if (input.context === 'fork' && (input.cwd || input.agentPreset)) throw new RemoteError('gateway/bad-request', 'A fork retains its source workspace and agent preset', {});
    return this.serialize(async () => {
      this.assertActive(input.sessionId);
      const parent = await this.ctx.sessionController.inspect(input.sessionId);
      const inheritedPreset = parent.events.findLast(event => event.type === 'agent-preset/selected')?.data.agentPreset ?? parent.meta.agentPreset;
      const workspace = this.ctx.workspaceRegistry.list().find(row => row.sessionIds.includes(input.sessionId));
      const created = input.context === 'fork' ? await this.ctx.sessionController.fork({ sessionId: input.sessionId }) : await this.ctx.sessionController.create({ ...(input.cwd ? { cwd: input.cwd } : workspace ? { workspaceId: workspace.id } : { cwd: parent.meta.cwd }), agentPreset: input.agentPreset ?? inheritedPreset });
      await this.ctx.sessionController.rename({ sessionId: created.sessionId, title: input.title });
      const state = this.domain.global.get();
      const link = { sessionId: created.sessionId, parentId: input.sessionId, title: input.title, kind: input.context, wakeParent: input.wakeParent ?? true };
      await this.domain.global.set({ ...state, links: { ...state.links, [created.sessionId]: link } });
      if (input.prompt) {
        const child = await this.agent(created.sessionId);
        child.followup(createUserMessage({ content: [{ type: 'text', text: `Task from linked parent session ${input.sessionId}:\n${input.prompt}` }], source: { kind: 'agent-message', form: 'relay', senderSessionId: input.sessionId } }));
        await this.ctx.sessions.flush(child.session);
      }
      return { sessionId: created.sessionId, parentId: input.sessionId };
    });
  }
  async detach(request) {
    const input = parse('detach', request);
    this.assertAccess(input.sessionId);
    return this.serialize(async () => {
      const state = this.domain.global.get();
      const link = state.links[input.sessionId];
      if (link) this.assertAccess(link.parentId);
      const { [input.sessionId]: removed, ...links } = state.links;
      await this.domain.global.set({ ...state, links });
      return { detached: !!removed };
    });
  }
  async send(request) {
    const input = parse('send', request);
    this.assertAccess(input.sessionId);
    this.assertAccess(input.targetSessionId);
    if (input.sessionId === input.targetSessionId) throw new RemoteError('gateway/bad-request', 'A session cannot message itself', {});
    return this.serialize(async () => {
      this.assertFamily(input.sessionId, input.targetSessionId);
      this.assertActive(input.sessionId);
      if (this.domain.global.get().stopped[input.targetSessionId]) throw new RemoteError('session/agent-busy', 'The user stopped the target; open it and send a user message before sending agent messages', { reason: 'user-stopped' });
      const target = await this.agent(input.targetSessionId);
      this.assertActive(input.targetSessionId);
      target.steer(createUserMessage({ content: [{ type: 'text', text: `Message from linked session ${input.sessionId}:\n${input.message}` }], source: { kind: 'agent-message', form: 'relay', senderSessionId: input.sessionId } }));
      await this.ctx.sessions.flush(target.session);
      return { sent: true };
    });
  }
  async read(request) {
    const input = parse('read', request);
    this.assertAccess(input.sessionId);
    const observation = await this.ctx.sessionController.inspect(input.sessionId);
    const messages = observation.events.filter(event => event.type === 'assistant/message' || event.type === 'user/message' && ['user', 'agent-message'].includes(event.data.source?.kind)).slice(-(input.limit ?? 12)).map(event => ({ role: event.type === 'user/message' ? 'user' : 'assistant', text: limited(messageText(event.data), 2000) }));
    const outcome = outcomeOf(observation.events.findLast(event => event.type === 'turn/end')?.data.reason);
    return { sessionId: input.sessionId, content: limited(messages.map(message => `${message.role}: ${message.text}`).join('\n\n'), 16000), running: this.ctx.agents.get(input.sessionId)?.status === 'running', ...(outcome ? { outcome } : {}) };
  }
  async stop(request) {
    const input = parse('stop', request);
    this.assertAccess(input.sessionId);
    await this.serialize(async () => {
      const state = this.domain.global.get();
      await this.domain.global.set({ ...state, stopped: { ...state.stopped, [input.sessionId]: true } });
      const agent = this.ctx.agents.get(input.sessionId);
      if (agent) {
        agent.cancel({ kind: 'user' }, { keepInbox: false });
        await this.ctx.sessions.flush(agent.session);
      }
    });
    return { stopped: true };
  }
  async observe(session, event) {
    if (this.disposed) return;
    const human = event.type === 'user/message' && event.data.source?.kind === 'user';
    const userStop = event.type === 'turn/end' && event.data.reason?.kind === 'aborted' && event.data.reason.reason?.kind === 'user';
    if (human || userStop) await this.serialize(async () => {
      const state = this.domain.global.get();
      if (human && state.stopped[session.id] || userStop) {
        const stopped = { ...state.stopped };
        if (human) delete stopped[session.id]; else stopped[session.id] = true;
        await this.domain.global.set({ ...state, stopped });
      }
    });
    if (event.type !== 'turn/end' || !['completed', 'error', 'blocked'].includes(event.data.reason?.kind)) return;
    await this.serialize(async () => {
      let state = this.domain.global.get(), link = Object.hasOwn(state.links, session.id) ? state.links[session.id] : undefined;
      if (!link) return;
      const outcome = outcomeOf(event.data.reason);
      link = { ...link, lastOutcome: outcome.kind };
      state = { ...state, links: { ...state.links, [session.id]: link } };
      await this.domain.global.set(state);
      if (!link?.wakeParent || state.stopped[session.id] || state.stopped[link.parentId] || (link.lastReportedSeq ?? -1) >= event.seq || this.ctx.workspaceRegistry.archivedSessionIds.includes(link.parentId) || this.ctx.workspaceRegistry.archivedSessionIds.includes(session.id)) return;
      const marker = `[Nested result ${session.id}:${event.seq}]`;
      const parentHistory = await this.ctx.sessionController.inspect(link.parentId);
      if (!parentHistory.events.some(row => JSON.stringify(row.data).includes(marker))) {
        const childHistory = await this.ctx.sessionController.inspect(session.id);
        const last = childHistory.events.filter(row => row.seq <= event.seq && row.type === 'assistant/message' && row.data.turn === event.data.turn).at(-1);
        const parent = await this.agent(link.parentId);
        const status = outcome.kind === 'completed' ? 'completed' : outcome.kind === 'error' ? 'failed' : 'is blocked and needs attention';
        const summary = outcome.kind === 'error' ? `${outcome.code}: ${outcome.message}` : outcome.kind === 'blocked' ? 'The child did not finish its task. Inspect the session before continuing.' : limited(messageText(last?.data));
        parent.steer(createUserMessage({ content: [{ type: 'text', text: `${marker}\nLinked session "${link.title}" ${status}.\n${summary}` }], source: { kind: 'agent-message', form: 'relay', senderSessionId: session.id } }));
        await this.ctx.sessions.flush(parent.session);
      }
      const current = this.domain.global.get();
      if (current.links[session.id]?.parentId === link.parentId) await this.domain.global.set({ ...current, links: { ...current.links, [session.id]: { ...current.links[session.id], lastReportedSeq: event.seq } } });
    });
  }
}
for (const method of Object.keys(schemas)) {
  const resources = { session: request => method === 'send' ? [request?.sessionId, request?.targetSessionId] : request?.sessionId };
  Remote({ resources })(NestedSessions.prototype[method], { kind: 'method', name: method, private: false, static: false, addInitializer: initialize => initializers.push(initialize) });
}

function installTools(agent, service) {
  const target = { type: 'string', required: true, description: 'Session ID returned by start_session or list_linked_sessions.' };
  const definitions = [
    ['start_session', 'Start an independent nested conversation. fresh gets only your task brief; fork inherits the latest completed conversation prefix. The child remains separately openable in the desktop.', { title: { type: 'string', required: true }, prompt: { type: 'string', required: true }, context: { type: 'string', enum: ['fresh', 'fork'] }, wake_parent: { type: 'boolean' } }, args => service.start({ sessionId: agent.id, title: args.title, prompt: args.prompt, context: args.context ?? 'fresh', ...(args.wake_parent === undefined ? {} : { wakeParent: args.wake_parent }) })],
    ['list_linked_sessions', 'List this conversation family and addressable nested sessions.', {}, () => service.list({ sessionId: agent.id })],
    ['send_session_message', 'Send a message to another linked family session. User-stopped sessions require the user to resume them first.', { target_session_id: target, message: { type: 'string', required: true } }, args => { service.assertFamily(agent.id, args.target_session_id); return service.send({ sessionId: agent.id, targetSessionId: args.target_session_id, message: args.message }); }],
    ['read_session', 'Read bounded conversation text from this linked family only.', { session_id: target }, args => { service.assertFamily(agent.id, args.session_id); return service.read({ sessionId: args.session_id }); }],
    ['stop_session', 'Stop a linked session without deleting its history.', { session_id: target }, args => { service.assertFamily(agent.id, args.session_id); return service.stop({ sessionId: args.session_id }); }],
  ];
  return definitions.map(([toolName, description, parameters, execute]) => agent.ctx.tools.register(defineTool({ name: toolName, description, parameters, output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute })));
}

export async function apply(ctx) {
  const domain = await ctx.storage.domain.open(domainSpec);
  const service = new NestedSessions(ctx, domain);
  const installed = new Map();
  const install = agent => {
    if (agent.session.header.origin === 'subagent' || installed.has(agent)) return;
    installed.set(agent, installTools(agent, service));
  };
  for (const agent of ctx.agents.list()) install(agent);
  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => { for (const dispose of installed.get(agent) ?? []) dispose(); installed.delete(agent); });
  ctx.on('session/event', (session, event) => { service.observe(session, event).catch(error => ctx.logger.warn(`nested-sessions: ${String(error)}`)); });
  ctx.effect(() => async () => {
    service.disposed = true;
    for (const disposers of installed.values()) for (const dispose of disposers) dispose();
    installed.clear();
    await service.tail;
    await domain.close();
  }, 'nested-sessions lifecycle');
}
