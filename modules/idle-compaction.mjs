import z from '@deepseek-ai/schemastery';

export const name = 'local-idle-compaction';
export const inject = ['agents', 'compaction', 'tokenMeter', 'sessionProjections'];
export const Config = z.object({
  enabled: z.boolean().default(true),
  idleMs: z.natural().min(60000).max(2147483647).default(54 * 60000),
  minTokens: z.natural().min(100000).max(Number.MAX_SAFE_INTEGER).default(200000),
});

export function apply(ctx, config) {
  if (!config.enabled) return;
  const activity = new Map(), pending = new Map();
  const touch = agent => activity.set(agent.id, Date.now());
  for (const agent of ctx.agents.list()) touch(agent);
  ctx.on('agent/created', ({agent}) => touch(agent));
  ctx.on('agent/status', ({agent}) => touch(agent));
  ctx.on('session/event', session => {
    if (activity.has(session.id)) activity.set(session.id, Date.now());
  });
  ctx.on('agent/disposed', ({agent}) => {
    activity.delete(agent.id);
    pending.get(agent.id)?.abort();
  });
  const tick = async () => {
    for (const agent of ctx.agents.list()) {
      if (pending.has(agent.id) || agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) continue;
      if (Date.now() - (activity.get(agent.id) ?? Date.now()) < config.idleMs) continue;
      if (ctx.sessionProjections.snapshot(agent.session, ['userQuestions']).values.userQuestions?.active.length) continue;
      if (ctx.tokenMeter.measure(agent.session).totalTokens < config.minTokens) continue;
      const abort = new AbortController();
      pending.set(agent.id, abort);
      touch(agent);
      try {
        // Native maintenance admission reserves the idle agent before any asynchronous summary work.
        await ctx.compaction.compactNow(agent, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) ctx.logger.warn(`Idle compaction for ${agent.id}: ${error.message}`);
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
    };
  });
}
