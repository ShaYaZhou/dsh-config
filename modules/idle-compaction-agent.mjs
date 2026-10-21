import {scopeOf} from '@deepseek-ai/dsh-scope';

export const name = 'local-idle-compaction-agent';
export const inject = ['localIdleCompaction', 'compaction', 'tokenMeter'];
export function apply(ctx) {
  ctx.effect(() => ctx.localIdleCompaction.register(scopeOf(ctx), ctx.compaction, ctx.tokenMeter));
}
