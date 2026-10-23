// render_widget：把模型产出的 HTML 片段内嵌渲染在当前会话的工具卡片里。
// 宿主只做参数校验和元数据；片段本身留在调用参数里，不落盘、不新增记录类型。
import {defineTool} from '@deepseek-ai/dsh-tools';

export const name = 'dynamic-ui-view';
export const inject = ['agents', 'tools'];

const MAX_HTML = 200000;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 900;
const DEFAULT_HEIGHT = 420;
// 只接受片段：文档外壳由客户端补，模型自带 doctype/body 会让两套外壳叠加。
const SHELL_TAG = /<\s*(?:!doctype|html|head|body)\b/i;

export function normalizeWidget(args = {}) {
  const html = typeof args.html === 'string' ? args.html : '';
  if (html.trim() === '') throw new Error('render_widget 需要一个非空的 html 片段');
  if (html.length > MAX_HTML) throw new Error(`html 片段为 ${html.length} 个字符，上限为 ${MAX_HTML}`);
  if (SHELL_TAG.test(html)) throw new Error('只传片段：不要包含 doctype/html/head/body，文档外壳由宿主补齐');
  const height = typeof args.height === 'number' && Number.isFinite(args.height)
    ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(args.height)))
    : DEFAULT_HEIGHT;
  const title = typeof args.title === 'string' && args.title.trim() !== ''
    ? args.title.trim().slice(0, 80)
    : '可视化';
  return {title, height, bytes: html.length};
}

const DESCRIPTION = `Render an interactive widget inline in this conversation, the way Claude artifacts appear. The fragment is displayed as a sandboxed card inside the current session, so use it instead of writing a standalone .html file whenever the user asks for a chart, diagram, dashboard, form, simulator or any interactive UI.

Pass a self-contained HTML fragment: inline <style>, <script>, inline SVG and data: URLs only. No external resources — the frame's CSP blocks every network request, and there is no localStorage or fetch. Do not pass doctype/html/head/body; the host supplies the document shell and its light/dark base styles. Keep the fragment under 200000 characters. The card grows to fit whatever the fragment renders, so height only sets the size before the content reports itself. Never wrap the content in your own scroll container (a fixed height with overflow:auto/scroll): the card already sizes itself to the content and a nested scroller would cut the widget off. Lay everything out at its natural height and let the page scroll.`;

function installTool(agent) {
  return agent.ctx.tools.register(defineTool({
    name: 'render_widget',
    description: DESCRIPTION,
    parameters: {
      html: {
        type: 'string',
        required: true,
        description: 'The HTML fragment to render. Complete and self-contained: no external scripts, stylesheets, fonts or images.',
      },
      title: {
        type: 'string',
        description: 'Short card title shown above the frame, e.g. "延迟分布". Defaults to 可视化.',
      },
      height: {
        type: 'number',
        description: `Starting frame height in pixels, clamped to ${MIN_HEIGHT}-${MAX_HEIGHT}, default ${DEFAULT_HEIGHT}. The card then resizes to fit the rendered content; no need to guess the final height.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {type: 'string', required: true},
          height: {type: 'integer', required: true},
          bytes: {type: 'integer', required: true},
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered "${value.title}" inline (${value.bytes} characters, ${value.height}px tall). The user already sees the widget in this conversation; there is no file to present or describe further.`,
      }],
    },
    execute: async (args) => normalizeWidget(args),
  }));
}

export function apply(ctx) {
  const installed = new Map();
  const install = (agent) => {
    if (installed.has(agent)) return;
    installed.set(agent, installTool(agent));
  };
  for (const agent of ctx.agents.list()) install(agent);
  ctx.on('agent/created', ({agent}) => install(agent));
  ctx.on('agent/disposed', ({agent}) => {
    installed.get(agent)?.();
    installed.delete(agent);
  });
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose();
    installed.clear();
  });
}
