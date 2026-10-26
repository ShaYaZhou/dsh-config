import path from 'node:path';
import {createHash} from 'node:crypto';
import * as mcp from '@deepseek-ai/dsh-mcp-client';
import z from '@deepseek-ai/schemastery';

export const name = 'isolated-browser';
export const inject = ['agents', 'tools'];
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

export function apply(ctx, config) {
  // Each native agent scope owns its MCP connection and isolated browser profile.
  // No parent/child shares pages, cookies, navigation or screenshot destinations.
  const connections = new Map();
  const stopped = new Set();
  ctx.on('agent/created', async ({agent}) => {
    if (connections.has(agent.id)) return;
    const directory = createHash('sha256').update(agent.id).digest('hex');
    agent.ctx.tools.guard(exec => {
      if (exec.agent?.id !== agent.id) return;
      if (stopped.has(agent.id) && exec.name.startsWith('mcp__playwright__'))
        return 'This browser owner has stopped. Start a new session; uncertain actions are not replayed.';
      return browserRefusal(exec);
    });
    const fiber = agent.ctx.plugin(mcp, {
      transport: 'stdio', serverName: 'playwright', command: config.command,
      args: [config.cli, '--caps', 'vision,devtools', '--snapshot-boxes',
        '--browser', config.browser, '--isolated', '--output-dir', path.join(config.outputRoot, directory)],
      failOnStartupError: false, toolCallTimeoutMs: 60000,
    });
    connections.set(agent.id, fiber);
    await fiber.await();
  });
  const close = async id => {
    stopped.add(id);
    const fiber = connections.get(id);
    if (!fiber) return;
    await fiber.dispose();
    while (fiber.inertia) await fiber.inertia;
    if (connections.get(id) === fiber) connections.delete(id);
  };
  ctx.on('agent/disposed', ({agent}) => close(agent.id));
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && ['aborted', 'interrupted', 'error'].includes(event.data.reason?.kind))
      return close(session.id);
  });
  ctx.effect(() => async () => {
    await Promise.all([...connections.keys()].map(close));
  });
}
