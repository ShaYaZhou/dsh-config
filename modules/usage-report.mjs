import {defineTool} from '@deepseek-ai/dsh-tools';

export const name = 'usage-report';
export const inject = ['agents', 'tools', 'sessionController', 'remoteAccess'];

const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];

function tokenTotal(usage) {
  return ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
    .reduce((sum, key) => sum + (Number(usage?.[key]) || 0), 0);
}

function ratesFor(pricing, model) {
  if (!model || !pricing || typeof pricing !== 'object') return undefined;
  const row = pricing[model];
  if (!row || typeof row !== 'object') return undefined;
  if (typeof row.input !== 'number' && typeof row.output !== 'number') return undefined;
  const rates = {};
  for (const key of RATE_KEYS) {
    const value = row[key] ?? 0;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    rates[key] = value;
  }
  return rates;
}

function costOf(usage, rates) {
  if (!rates) return null;
  const input = Number(usage?.uncachedInputTokens) || 0;
  const output = Number(usage?.outputTokens) || 0;
  const cacheRead = Number(usage?.cacheReadTokens) || 0;
  const cacheWrite = Number(usage?.cacheWriteTokens) || 0;
  return (input * rates.input + output * rates.output + cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite) / 1e6;
}

export function summarizeUsage(rows, pricing = {}) {
  const sessions = rows.map((row) => {
    if (row.unavailable) return {sessionId: row.sessionId, unavailable: true};
    const usage = row.usage ?? {};
    const tokens = {
      uncachedInputTokens: Number(usage.uncachedInputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
      cacheReadTokens: Number(usage.cacheReadTokens) || 0,
      cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
    };
    const model = row.model?.model;
    const rates = ratesFor(pricing, model);
    const context = row.context ?? {};
    const contextWindow = Number(context.contextWindow);
    return {
      sessionId: row.sessionId,
      ...(row.title ? {title: row.title} : {}),
      ...(row.cwd ? {cwd: row.cwd} : {}),
      ...(model ? {model, ...(row.model.provider ? {provider: row.model.provider} : {})} : {}),
      tokens,
      totalTokens: tokenTotal(tokens),
      cacheHitRate: tokens.uncachedInputTokens + tokens.cacheReadTokens > 0
        ? tokens.cacheReadTokens / (tokens.uncachedInputTokens + tokens.cacheReadTokens)
        : null,
      ...(Number.isFinite(contextWindow) && contextWindow > 0
        ? {context: {
            pressureTokens: Number(context.pressureTokens) || 0,
            contextWindow,
            pressurePercent: (Number(context.pressureTokens) || 0) / contextWindow,
            ...(Number.isFinite(Number(context.projectedTokens)) ? {projectedTokens: Number(context.projectedTokens)} : {}),
          }}
        : {}),
      ...(row.stats ? {stats: {
        turns: Number(row.stats.turns) || 0,
        steps: Number(row.stats.steps) || 0,
        llmMs: Number(row.stats.llmMs) || 0,
        toolMs: Number(row.stats.toolMs) || 0,
        ttftMs: Number(row.stats.ttftMs) || 0,
        decodeMs: Number(row.stats.decodeMs) || 0,
      }} : {}),
      cost: costOf(tokens, rates),
    };
  });
  const priced = sessions.filter((row) => !row.unavailable && row.cost !== null);
  const tokens = sessions.reduce((sum, row) => {
    if (row.unavailable) return sum;
    for (const key of Object.keys(row.tokens)) sum[key] = (sum[key] ?? 0) + row.tokens[key];
    return sum;
  }, {});
  return {
    sessions,
    totals: {
      sessions: sessions.length,
      totalTokens: tokenTotal(tokens),
      tokens,
      cost: priced.length ? priced.reduce((sum, row) => sum + row.cost, 0) : null,
      pricedSessions: priced.length,
      unpricedSessions: sessions.filter((row) => !row.unavailable && row.cost === null).length,
    },
    pricing: {provided: Object.keys(pricing ?? {}).length > 0, unit: 'per million tokens'},
    note: 'DSH records token usage without a native price field. cost is null unless the user configured pricing in this module.',
  };
}

class UsageReport {
  constructor(ctx, pricing) {
    this.ctx = ctx;
    this.pricing = pricing ?? {};
  }
  assertAccess(sessionId) {
    if (!this.ctx.remoteAccess.allows({kind: 'session', id: sessionId}))
      throw new Error('Session is not accessible');
  }
  async report(agent, args, signal) {
    const ids = [...new Set(args.session_ids?.length ? args.session_ids : [agent.id])];
    if (ids.length > 20) throw new Error('At most 20 sessions per usage report');
    const timeout = AbortSignal.timeout(30000);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let meta = new Map();
    try {
      const listed = await this.ctx.sessionController.list({}, combined);
      meta = new Map(listed.items.map((row) => [row.sessionId, row]));
    } catch (error) {
      if (combined.aborted) throw error;
    }
    const rows = await Promise.all(ids.map(async (sessionId) => {
      this.assertAccess(sessionId);
      let snapshot;
      try {
        snapshot = await this.ctx.sessionController.projections({sessionId}, combined);
      } catch (error) {
        if (combined.aborted) throw error;
        return {sessionId, unavailable: true};
      }
      this.assertAccess(sessionId);
      if (snapshot?.kind !== 'sequenced') return {sessionId, unavailable: true};
      const values = snapshot.values ?? {};
      const info = meta.get(sessionId);
      return {
        sessionId,
        title: info?.projections?.values?.title,
        cwd: info?.cwd,
        model: values.modelSelection?.lastUsed,
        usage: values.tokenUsage,
        context: values.contextPressure,
        stats: values.sessionStats,
      };
    }));
    return summarizeUsage(rows, this.pricing);
  }
}

function installTools(agent, service) {
  return [agent.ctx.tools.register(defineTool({
    name: 'usage_report',
    description: 'Report native token usage, cache-hit rate, context pressure and timing for this session or explicitly named local sessions. There is no built-in price table; cost is estimated only when the user configured pricing.',
    parameters: {
      session_ids: {
        type: 'array',
        items: {type: 'string'},
        description: 'Local session IDs to summarize. Omit for the current session.',
      },
    },
    output: {
      schema: {type: 'object', additionalProperties: true},
      render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}],
    },
    execute: (args, exec) => service.report(agent, args, exec.signal),
  }))];
}

export function apply(ctx, config = {}) {
  const service = new UsageReport(ctx, config.pricing);
  const installed = new Map();
  const install = (agent) => {
    if (installed.has(agent)) return;
    installed.set(agent, installTools(agent, service));
  };
  for (const agent of ctx.agents.list()) install(agent);
  ctx.on('agent/created', ({agent}) => install(agent));
  ctx.on('agent/disposed', ({agent}) => {
    for (const dispose of installed.get(agent) ?? []) dispose();
    installed.delete(agent);
  });
  ctx.effect(() => () => {
    for (const disposers of installed.values()) for (const dispose of disposers) dispose();
    installed.clear();
  });
}
