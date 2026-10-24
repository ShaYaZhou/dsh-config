import { z } from "zod";
import { Script } from "node:vm";
import { appendPluginRecord } from "@deepseek-ai/dsh-session";
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { runInitializers } from '@local/dsh-shared/remote';
import { sessionId } from '@local/dsh-shared/session-id';

export const name = "ultracode";
export const inject = ["systemPrompt", "sessionProjections", "commands", "tools", "typert", "remoteAccess", "sessionController"];

const RECORD = "plugin:ultracode/mode";

// Coordinator policy and monotonic tool guard share the existing Ultracode service.
const POLICY = [
  "Ultracode is on: substantive tasks MUST enter workflow before implementation, browser execution, or",
  "delegation. Simple questions and clarifications may be answered directly; render_widget may present an answer or completed workflow result. A few",
  "read/glob/grep/skill calls may establish scope; they are not an alternative implementation loop. A webpage",
  "with research, writing, interaction and acceptance is substantive even if it is one HTML file. Use one SMALL",
  "workflow with research, implementation and independent acceptance (usually 2-3 stages). Return concise text by",
  "default. Do not invent large nested output schemas, separate planner/reviewer layers, or repeat the whole",
  "brief in every stage; use a small schema only when later code must branch on a few fields. A mandatory",
  "workflow is not a mandate for more agents or paperwork. Do not dispatch the same assignment through multiple",
  "tools. Workflow agent() already creates its workers: do not also launch those assignments outside the",
  "workflow. Workers run serially through the existing engine limit so they cannot concurrently modify the shared",
  "workspace. Keep one implementation owner; additional subagents inside a worker must use",
  "explore/planner/reviewer and remain read-only. Stop after acceptance passes; repeat verification only for a",
  "specific change or failure. Preserve failure/stop/resume protections and never evade a refusal by another",
  "tool. /collaborate on selects worker_mode=\"linked\" within workflow; auto lets you choose linked only for",
  "persistent independently followable conversations; off disallows linked workers. Linked workers return text,",
  "so omit agent() schema options for linked mode. Ordinary workers use worker_mode=\"subagent\" (the default in",
  "auto). Do not nest workflows. PTC coordinators must use the auditable single-call envelope console.log(await",
  "tools.workflow(JSON_ARGUMENTS)); with a literal JSON object, including the script as a JSON string. The same",
  "envelope can call an allowed read/status tool. No other code, imports, variables, filesystem access or",
  "multiple calls are allowed in coordinator run_code; complex computation belongs inside workflow agents. Await",
  "completed results (job_output for background work), verify the deliverable, and report failures honestly.",
  "Do not use workflow as a scratch REPL or start empty probe runs. Correct reported syntax/JSON errors before task execution.",
].join(' ');

const COORDINATOR_TOOLS = new Set([
  'workflow', 'render_widget',
  'read', 'read_image', 'glob', 'grep', 'skill',
  'ask_user', 'todo_write', 'job_output', 'job_kill', 'stop_session', 'interrupt_agent',
  'wait_agent', 'wait_for_sessions', 'list_agents', 'list_linked_sessions', 'read_session',
  'list_recent_sessions', 'read_local_session', 'list_session_models', 'usage_report',
]);
const PREPARATION_TOOLS = new Set(['read','read_image','glob','grep','skill','list_recent_sessions','read_local_session']);
const READ_ONLY_ROLES = new Set(['explore','planner','reviewer']);

// A transport envelope, not a JavaScript evaluator. JSON cannot execute code.
const COORDINATOR_ENVELOPE = /^\s*console\s*\.\s*log\s*\(\s*await\s+tools\s*\.\s*([a-zA-Z_][a-zA-Z_0-9]*)\s*\(\s*([\s\S]*?)\s*\)\s*\)\s*;?\s*$/;
export function coordinatorCall(code) {
  if (typeof code !== 'string') return undefined;
  const match = COORDINATOR_ENVELOPE.exec(code);
  if (!match) return undefined;
  try {
    const args = JSON.parse(match[2]);
    if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
    return {name:match[1], args};
  } catch { return undefined; }
}

function coordinatorFailure(code) {
  if (typeof code !== 'string') return 'Ultracode requires code text containing a single literal JSON call.';
  try {
    // Compile for diagnostics only. Never evaluate model code in the host process.
    new Script('(async () => {\n' + code + '\n})()');
  } catch (error) {
    return `Ultracode PTC syntax error; nothing executed: ${error.message}. Both console.log( and tools.name( need closing parentheses. Use a single literal JSON call: console.log(await tools.workflow(JSON_OBJECT)); Fix the syntax, not the length; do not start probe workflows.`;
  }
  if (COORDINATOR_ENVELOPE.test(code))
    return 'Ultracode requires a single literal JSON call. Argument keys and strings must use double quotes; no expressions or trailing commas. No workflow ran. Fix the JSON instead of probing transport with empty workflows.';
  return 'Ultracode requires a single literal JSON call: console.log(await tools.workflow(JSON_OBJECT)); No variables, imports, extra statements or multiple calls. Put computation inside workflow workers; do not start probe workflows.';
}

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
  if (agent.session.header?.origin === 'subagent' || mode === 'worker') return 'worker';
  return mode === 'linked' ? 'linked' : 'workflow';
}
function statusText(ctx, agent) {
  const mode = effectiveMode(ctx, agent);
  if (mode === 'off') return 'ultracode 当前已关闭。';
  if (mode === 'unavailable') return 'ultracode 已开启，但当前模式没有 workflow 工具，自动编排策略未生效。';
  if (mode === 'linked') return 'ultracode 已开启且生效：实质性任务必须经 Workflow；当前使用持久关联会话执行各阶段。';
  if (mode === 'worker') return 'ultracode 已开启；当前是关联工作会话，按主会话分工执行，不自动启动第二套编排。';
  return 'ultracode 已开启且生效：实质性任务必须经 Workflow；简单问答直接处理。';
}

const statusInitializers = [];
export class UltracodeState extends TypertRemoteService {
  static inject = inject;
  constructor(ctx) {
    super(ctx, 'ultracodeState', {namespace: 'ultracodeState'});
    runInitializers(this, statusInitializers);
  }
  requiresWorkflow(agent) {
    return active(this.ctx, agent.session) && this.ctx.tools.get('workflow', agent) !== undefined &&
      agent.session.header?.origin !== 'subagent' &&
      this.ctx.get('nestedSessions')?.delegationMode(agent.id ?? agent.session.id) !== 'worker';
  }
  restrictWorker(agent, seen = new Set()) {
    if (seen.has(agent.id)) return true;
    seen.add(agent.id);
    const parentId = agent.session.header?.parentSession ?? this.ctx.get('nestedSessions')?.parentOf?.(agent.id);
    const parent = parentId && this.ctx.get('agents')?.get(parentId);
    if (!parent) return true;
    return this.requiresWorkflow(parent) ||
      ((parent.session.header?.origin === 'subagent' || this.ctx.get('nestedSessions')?.delegationMode(parent.id) === 'worker') && this.restrictWorker(parent,seen));
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
  const service = new UltracodeState(ctx);
  const preparation = new WeakMap();
  ctx.effect(() => ctx.tools.guard(exec => {
    const agent = exec.agent;
    if (!agent) return;
    if (agent.session.header?.origin === 'subagent' || ctx.get('nestedSessions')?.delegationMode(agent.id) === 'worker') {
      if (!service.restrictWorker(agent)) return;
      if (READ_ONLY_ROLES.has(agent.session.header?.agentPreset) && exec.name === 'write')
        return 'Ultracode read-only helpers cannot write project files or shared role memory.';
      if (exec.name === 'subagent' && !READ_ONLY_ROLES.has(exec.arguments?.agent_preset))
        return 'Ultracode workers may delegate only read-only explore/planner/reviewer subagents; keep one writer.';
      if (['workflow','subagent_fork','start_session','team_create','team_spawn','spawn_teammate','send_session_message','send_message'].includes(exec.name))
        return 'Ultracode worker: execute the assigned stage; no nested workflow, linked family or additional writers.';
      return;
    }
    if (!service.requiresWorkflow(agent)) return;
    if (exec.name === 'run_code') {
      const call = coordinatorCall(exec.arguments?.code);
      if (!call) return coordinatorFailure(exec.arguments?.code);
      if (!COORDINATOR_TOOLS.has(call.name))
        return `Ultracode single literal JSON envelope is valid, but direct ${call.name} is disabled. Execute this operation through a workflow worker.`;
      return;
    }
    if (!COORDINATOR_TOOLS.has(exec.name))
      return 'Ultracode requires workflow for implementation, browser actions and delegation. Call workflow; do not retry this operation directly or change tools to bypass it.';
    if (PREPARATION_TOOLS.has(exec.name)) {
      const turn = agent.session.snapshotEvents().findLast(event => event.type === 'turn/start')?.seq ?? -1;
      let state = preparation.get(agent);
      if (!state || state.turn !== turn) { state = {turn,count:0}; preparation.set(agent,state); }
      if (state.count >= 6) return 'Ultracode preparation limit reached. Continue research and acceptance inside workflow workers.';
      state.count++;
    }
  }));
  ctx.systemPrompt.section({
    name: "ultracode:policy",
    order: 860,
    text: (context) => {
      const agent = context?.agent;
      if (agent === undefined) return "";
      if (agent.session.header?.origin === 'subagent' && READ_ONLY_ROLES.has(agent.session.header?.agentPreset) && service.restrictWorker(agent))
        return 'This workflow helper is strictly read-only, including role MEMORY.md. Return findings as text; do not update memory or start other workers.';
      return ['workflow','linked'].includes(effectiveMode(ctx, agent)) ? POLICY : '';
    },
  });
  ctx.effect(() => ctx.commands.register({
    name: "ultracode",
    description: "会话内 ultracode 模式：开启后实质性任务必须经原生 workflow 编排。/ultracode on|off|status",
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
        text: `ultracode 已${wanted ? "开启" : "关闭"}，从下一步请求起按工具可用性与执行者类型应用。用 /ultracode status 查看实际状态。`,
      };
    },
  }));
}
