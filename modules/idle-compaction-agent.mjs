import {scopeOf} from '@deepseek-ai/dsh-scope';

export const name = 'local-idle-compaction-agent';
export const inject = ['compaction', 'tokenMeter'];
export function apply(ctx) {
  // Only the optional idle scheduler may be absent; native compaction remains required.
  ctx.inject(['localIdleCompaction'], ctx => {
    ctx.effect(() => ctx.localIdleCompaction.register(scopeOf(ctx), ctx.compaction, ctx.tokenMeter));
  });
}
