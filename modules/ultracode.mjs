import { z } from "zod";
import { appendPluginRecord } from "@deepseek-ai/dsh-session";
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { runInitializers } from '@local/dsh-shared/remote';
import { sessionId } from '@local/dsh-shared/session-id';

export const name = "ultracode";
export const inject = ["systemPrompt", "sessionProjections", "commands", "tools", "typert", "remoteAccess", "sessionController"];

const RECORD = "plugin:ultracode/mode";

// ultracode 是会话内模式：开启后模型对实质性任务默认用原生 workflow
// 展开，关闭时这段策略不进入请求。它只是提示，不改变工具集、权限或沙箱。
const POLICY = `ultracode is on for this session. For substantive tasks, default to dynamic orchestration with the native workflow tool when independent work, dependencies, or cross-checking benefit from it. First establish the real scope and acceptance criteria. Keep conversational, trivial, or tightly coupled tasks local; a small isolated task can use subagent. Do not manufacture agents or duplicate the same assignment across workflow and start_session. An explicit user choice of delegation method for this task overrides this default. For independent multi-stage audits or cross-checking, use workflow rather than creating a Team merely to run parallel readers. Team is appropriate when the task requires persistent shared task ownership and peer coordination or the user explicitly requests it. Under PTC presentation, invoke the same workflow capability through tools.workflow inside run_code; do not replace it with Team because the model-facing tool list is collapsed. A workflow script owns branching and intermediate results; workers receive self-contained briefs and return evidence. Collect actual terminal results (job_output for background runs), independently verify consequential findings and changed files, and report coverage, failures, and truncation. Recover a failed run deliberately using its saved run ID only when the script and task still match; never turn failed or missing results into success. Stop requests remain binding. Respect existing depth, concurrency, permissions and sandbox limits; do not switch to another delegation tool to evade a refusal. Parallel writers require verified independent workspaces or non-overlapping files; otherwise serialize. Choose the smallest sufficient orchestration and finish with a verified deliverable.`;

const stateSchema = z.object({ active: z.boolean().nullable() }).strict();

export const ultracodeProjection = {
  key: "ultracode",
  stateVersion: 1,
  stateSchema,
  init: () => ({ active: null }),
  apply: (state, event) =>
    event.type === RECORD && typeof event.data?.active === "boolean"
      ? { active: event.data.active }
      : state,
  wire: { viewSchema: stateSchema, view: (state) => state },
};

function defaultActive(ctx) {
  return ctx.get("enhancementSettings")?.ultracodeDefault() === true;
}

/** 会话内是否开启：显式记录优先，否则跟随设置页的新会话默认值。 */
function active(ctx, session) {
  const state = ctx.sessionProjections.stateOf(session, "ultracode");
  if (typeof state?.active === "boolean") return state.active;
  return defaultActive(ctx);
}

// Public read-only contract supplied by nestedSessions; no private store access.
function effectiveMode(ctx, agent) {
  if (!active(ctx, agent.session)) return 'off';
  if (ctx.tools.get('workflow', agent) === undefined) return 'unavailable';
  const mode = ctx.get('nestedSessions')?.delegationMode(agent.id ?? agent.session.id);
  return mode === 'linked' || mode === 'worker' ? mode : 'workflow';
}
function statusText(ctx, agent) {
  const mode = effectiveMode(ctx, agent);
  if (mode === 'off') return 'ultracode 当前已关闭。';
  if (mode === 'unavailable') return 'ultracode 已开启，但当前模式没有 workflow 工具，自动编排策略未生效。';
  if (mode === 'linked') return 'ultracode 已开启；当前显式关联会话优先，/collaborate auto 后恢复自动编排。';
  if (mode === 'worker') return 'ultracode 已开启；当前是关联工作会话，按主会话分工执行，不自动启动第二套编排。';
  return 'ultracode 已开启且生效：按任务需要使用工作流、普通子代理或直接处理。';
}

const statusInitializers = [];
export class UltracodeState extends TypertRemoteService {
  static inject = inject;
  constructor(ctx) {
    super(ctx, 'ultracodeState', {namespace: 'ultracodeState'});
    runInitializers(this, statusInitializers);
  }
  async read(request, signal) {
    const parsed = sessionId.safeParse(request?.sessionId);
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Invalid session ID', {});
    const id = parsed.data;
    const check = () => {
      signal?.throwIfAborted();
      if (!this.ctx.remoteAccess.allows({kind:'session', id}))
        throw new RemoteError('gateway/forbidden', 'Session is not accessible', {});
    };
    check();
    const resolved = await this.ctx.sessionController.resolveAgent(id);
    check();
    if (!resolved.agent) throw new RemoteError('gateway/not-found', 'Session unavailable', {});
    const agent = resolved.agent;
    return {
      sessionId: id,
      supported: this.ctx.tools.get('workflow', agent) !== undefined,
      requested: active(this.ctx, agent.session),
      mode: effectiveMode(this.ctx, agent),
      text: statusText(this.ctx, agent),
    };
  }
}
Remote({resources:{session: request => request?.sessionId}})(UltracodeState.prototype.read, {
  kind:'method', name:'read', private:false, static:false,
  addInitializer: fn => statusInitializers.push(fn),
});

export function apply(ctx) {
  ctx.sessionProjections.register(ultracodeProjection);
  new UltracodeState(ctx);
  ctx.systemPrompt.section({
    name: "ultracode:policy",
    order: 860,
    text: (context) => {
      const agent = context?.agent;
      if (agent === undefined) return "";
      return effectiveMode(ctx, agent) === 'workflow' ? POLICY : '';
    },
  });
  ctx.effect(() => ctx.commands.register({
    name: "ultracode",
    description: "会话内 ultracode 模式：开启后实质性任务默认用原生 workflow 动态编排。/ultracode on|off|status",
    input: { hint: "on|off|status" },
    handler: (invocation) => {
      const session = invocation.agent.session;
      const current = active(ctx, session);
      const verb = invocation.rawInput.trim().toLowerCase() || "status";
      if (verb === "status") {
        return { kind: "success", text: statusText(ctx, invocation.agent) };
      }
      if (verb !== "on" && verb !== "off") {
        return { kind: "error", text: "用法：/ultracode on | off | status" };
      }
      const wanted = verb === "on";
      if (wanted && ctx.tools.get('workflow', invocation.agent) === undefined)
        return {kind:'error', text:'当前模式不支持 Workflow，无法开启 Ultracode。已有偏好会保留，切换到支持的模式后再应用。'};
      if (wanted === current) {
        return { kind: "success", text: `ultracode 已经是${wanted ? "开启" : "关闭"}状态。${statusText(ctx, invocation.agent)}` };
      }
      appendPluginRecord(session, RECORD, { active: wanted });
      return {
        kind: "success",
        text: `ultracode 已${wanted ? "开启" : "关闭"}，从下一步请求起按工具可用性与协作优先级应用。用 /ultracode status 查看实际状态。`,
      };
    },
  }));
}
