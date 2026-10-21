import z from '@deepseek-ai/schemastery';
import {Service} from '@deepseek-ai/cordis';
import {scopeChainOf} from '@deepseek-ai/dsh-scope';

export const name = 'local-idle-compaction';
export const inject = ['agents', 'sessionProjections', 'workspaceRegistry'];
export const Config = z.object({
  enabled: z.boolean().default(true).description('空闲时自动压缩长会话；关闭会取消进行中的空闲摘要').volatile(),
  idleMs: z.natural().min(60000).max(2147483647).default(54 * 60000),
  minTokens: z.natural().min(100000).max(Number.MAX_SAFE_INTEGER).default(200000),
});

class IdleCompactionRegistry extends Service {
  bindings = new Map();
  constructor(ctx) { super(ctx, 'localIdleCompaction'); }
  register(owner, engine, meter) {
    if (!owner || this.bindings.has(owner)) throw new Error('Idle compaction requires one engine per Agent composition scope');
    this.bindings.set(owner, {engine, meter});
    return () => this.bindings.delete(owner);
  }
  forAgent(agent) {
    for (const owner of scopeChainOf(agent)) if (this.bindings.has(owner)) return this.bindings.get(owner);
  }
}

export function apply(ctx, config) {
  const engines = new IdleCompactionRegistry(ctx);
  const activity = new Map(), pending = new Map(), paused = new Set();
  const enabled = () => typeof config.enabled?.get === 'function' ? config.enabled.get() : config.enabled;
  const touch = agent => activity.set(agent.id, Date.now());
  const attach = agent => {
    touch(agent);
    if (agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason?.kind === 'aborted') paused.add(agent.id);
  };
  for (const agent of ctx.agents.list()) attach(agent);
  ctx.on('agent/created', ({agent}) => attach(agent));
  ctx.on('agent/status', ({agent}) => touch(agent));
  ctx.on('session/event', (session, event) => {
    if (activity.has(session.id)) activity.set(session.id, Date.now());
    if (event.type === 'turn/start') paused.delete(session.id);
    if (event.type === 'turn/end' && event.data.reason?.kind === 'aborted') paused.add(session.id);
  });
  ctx.on('agent/disposed', ({agent}) => {
    activity.delete(agent.id);
    paused.delete(agent.id);
    pending.get(agent.id)?.abort();
  });
  ctx.on('loader/volatile-update', () => {
    if (!enabled()) for (const abort of pending.values()) abort.abort();
    else for (const agent of ctx.agents.list()) touch(agent);
  });
  ctx.on('workspace/session-activity', async ({sessionId}, next) => {
    const other = await next();
    return pending.has(sessionId) && !other.some(item => item.kind === 'turn') ? [{kind:'turn'}, ...other] : other;
  });
  ctx.on('workspace/session-stop', ({sessionId}) => { pending.get(sessionId)?.abort(); });
  const tick = async () => {
    if (!enabled() || pending.size) return;
    for (const agent of ctx.agents.list()) {
      if (!enabled()) break;
      if (paused.has(agent.id) || ctx.workspaceRegistry.archivedSessionIds.includes(agent.id)) continue;
      if (pending.has(agent.id) || agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) continue;
      if (Date.now() - (activity.get(agent.id) ?? Date.now()) < config.idleMs) continue;
      if (ctx.sessionProjections.snapshot(agent.session, ['userQuestions']).values.userQuestions?.active.length) continue;
      const binding = engines.forAgent(agent);
      if (!binding || binding.meter.measure(agent.session).totalTokens < config.minTokens) continue;
      const abort = new AbortController();
      pending.set(agent.id, abort);
      touch(agent);
      try {
        // Native maintenance admission reserves the idle agent before any asynchronous summary work.
        await binding.engine.compactNow(agent, abort.signal);
      } catch (error) {
        if (error.code === 'cancelled' && agent.status === 'idle' && activity.has(agent.id)) paused.add(agent.id);
        if (!abort.signal.aborted && error.code !== 'cancelled') ctx.logger.warn(`Idle compaction for ${agent.id}: ${error.message}`);
      } finally {
        pending.delete(agent.id);
        if (activity.has(agent.id)) touch(agent);
      }
    }
  };
  ctx.effect(() => {
    const timer = setInterval(() => { void tick().catch(error => ctx.logger.warn(`Idle compaction: ${error.message}`)); }, 30000);
    timer.unref?.();
    return () => {
      clearInterval(timer);
      for (const abort of pending.values()) abort.abort();
      activity.clear();
      paused.clear();
    };
  });
}
