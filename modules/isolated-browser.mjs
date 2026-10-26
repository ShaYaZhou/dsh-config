import path from 'node:path';
import {createHash} from 'node:crypto';
import * as mcp from '@deepseek-ai/dsh-mcp-client';
import z from '@deepseek-ai/schemastery';
import {appendPluginRecord} from '@deepseek-ai/dsh-session';
import {z as stateZ} from 'zod';

export const name = 'isolated-browser';
export const inject = ['agents', 'tools', 'sessionProjections'];
export const Config = z.object({
  command: z.string().required(),
  cli: z.string().required(),
  browser: z.string().default('chrome'),
  outputRoot: z.string().required(),
});

export function browserRefusal(exec) {
  if (!exec.name.startsWith('mcp__playwright__')) return;
  if (exec.arguments?.sandbox_permissions !== undefined || /_unsafe$/.test(exec.name))
    return 'Browser server-side execution and permission escalation are unavailable.';
  if (exec.arguments?.filename !== undefined)
    return 'Use the browser default export directory; custom export paths are unavailable.';
}

const BLOCKED = 'plugin:isolated-browser/blocked';
export const browserLifecycleProjection = {
  key: 'isolatedBrowserLifecycle',
  stateVersion: 1,
  stateSchema: stateZ.object({blocked: stateZ.boolean()}).strict(),
  init: () => ({blocked: false}),
  apply: (state, event) => event.type === BLOCKED ||
    (event.type === 'turn/end' && ['aborted', 'interrupted', 'error'].includes(event.data.reason?.kind))
      ? {blocked: true} : state,
};
const SAFE_WHILE_BLOCKED = new Set([
  'read', 'read_image', 'glob', 'grep', 'list_agents', 'job_output', 'job_list', 'ask_user_question',
]);

export function apply(ctx, config) {
  const connections = new Map();
  const stopped = new Set();
  const writes = new Map();
  ctx.sessionProjections.register(browserLifecycleProjection);
  const block = (session, reason) => {
    if (stopped.has(session.id)) return;
    stopped.add(session.id);
    // Session event publication forbids reentrant appends. Native terminal events
    // already retain stops; cleanup uncertainty gets an ignorable record later.
    const pending = Promise.resolve().then(() => appendPluginRecord(session, BLOCKED, {reason}))
      .catch(error => ctx.logger.warn('Browser stop remains latched; persistence failed: '+String(error)));
    writes.set(session.id, pending);
  };
  const close = async record => {
    if (!record) return;
    if (record.closing) return record.closing;
    record.closing = (async () => {
      try {
        await record.fiber.dispose();
        while (record.fiber.inertia) await record.fiber.inertia;
        if (connections.get(record.agent.id) === record) connections.delete(record.agent.id);
      } catch (error) {
        block(record.agent.session, 'cleanup-unconfirmed');
        throw error;
      }
    })();
    return record.closing;
  };
  ctx.on('agent/created', async ({agent}) => {
    await writes.get(agent.id);
    if (ctx.sessionProjections.stateOf(agent.session, browserLifecycleProjection.key)?.blocked) {
      stopped.add(agent.id);
    }
    agent.ctx.tools.guard(exec => {
      if (exec.agent?.id !== agent.id) return;
      if (stopped.has(agent.id) && !SAFE_WHILE_BLOCKED.has(exec.name))
        return 'Browser owner explicitly stopped or cleanup is unconfirmed. Execution/delegation is blocked for this owner, including shell and PTC; use a new session. Do not bypass with another browser process.';
      return browserRefusal(exec);
    });
    const previous=connections.get(agent.id);
    if(previous?.agent===agent)return;
    if(previous) {
      try { await close(previous); } catch { return; }
    }
    if(stopped.has(agent.id))return;
    const directory=createHash('sha256').update(agent.id).digest('hex');
    const fiber=agent.ctx.plugin(mcp, {
      transport:'stdio',serverName:'playwright',command:config.command,
      args:[config.cli,'--caps','vision,devtools','--snapshot-boxes','--browser',config.browser,
        '--isolated','--output-dir',path.join(config.outputRoot,directory)],
      failOnStartupError:false,toolCallTimeoutMs:60000,
    });
    connections.set(agent.id,{agent,fiber});
    await fiber.await();
  });
  ctx.on('agent/disposed', ({agent}) => {
    const record=connections.get(agent.id);
    // Ordinary release is not a stop; stale generations cannot close a new owner.
    if(record?.agent===agent)return close(record);
  });
  ctx.on('session/event', (session,event) => {
    if(event.type==='turn/end'&&['aborted','interrupted','error'].includes(event.data.reason?.kind)) {
      block(session,event.data.reason.kind);
      return close(connections.get(session.id));
    }
  });
  ctx.effect(()=>async()=>{
    await Promise.all([...connections.values()].map(close));
    await Promise.all(writes.values());
  });
}
