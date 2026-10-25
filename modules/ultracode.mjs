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
  "Ultracode is on: substantive tasks MUST enter workflow before implementation, browser execution or delegation.",
  "Simple questions and clarifications may be answered directly. Read-only scoping has no arbitrary call-count cap.",
  "Express actual dependencies and acceptance criteria using the existing workflow hooks; do not mechanically add roles, phases or schemas.",
  "You may first outline goals, dependencies and acceptance in concise prose. Then start the smallest runnable workflow and refine it from observed results; do not expand every possible branch in advance. Keep independent work parallel. There is no character-count target or cap.",
  "The coordinator writes orchestration, not a full specification: domain answers, detailed design decisions and concrete verification steps belong to workers. Give workers the necessary user goal and constraints, without solving their assignment in advance.",
  "Do not precompute the workers' entire solution, invent fallback implementations, or retry an implementation because its result is null. Dispatch independent discovery first, then use its actual results for the next necessary call. Concrete fixes after successful execution and failed acceptance are legitimate new work.",
  "One user task may span successive small workflow runs. When later work depends on unknown findings, return those findings first and compose the next run from them instead of packing a speculative full lifecycle into the first script. When the next stage is already determined and only consumes an earlier worker's result, await it inside the same script; start another run only when a finding, failure or failed acceptance changes the direction. Skill-specific design or domain preparation belongs to the assigned workers.",
  "Default to concise text results. If code must branch, use only the few scalar fields needed for that branch and a brief explanation, not nested evidence or reporting schemas. Use mounted tools directly; do not invent environment inventories or extra proof obligations without a concrete failure. A schema property that uses enum or const must also declare type; an enum alone is rejected before the run can finish.",
  "Use parallel() for independent work within the existing concurrency budget. agent(prompt,{read_only:true}) creates a sandboxed read-only worker.",
  "Choose each worker's native reasoning_effort for its actual uncertainty: medium is a useful starting point for bounded design, implementation from established findings and routine verification; reserve high for unresolved reasoning-intensive questions. Select medium explicitly for those workers instead of inheriting a high coordinator default; the task's overall size is not a reason to choose high. Omit it to inherit. This changes neither the parent's model preference nor acceptance requirements.",
  "Share a concise task contract and pass workers' actual findings forward without rewriting them into a larger specification. Preparation workers return only the requested sections, not a full document. Require each worker to end with the requested text deliverable; reasoning alone is a missing result. A read-only worker that returns nothing may be retried once with a narrower brief and that requirement, while a writable failure is never retried automatically. Suggestions are not new requirements. Assign one independent acceptance owner per concern, and give that owner every browser, screenshot, responsive and console check named in the user task even when the user asked for them together with the implementation. Set browser:true only on that acceptance owner, never on the implementer. An implementer checks only its own change: syntax, static references and at most one quick render or console sanity check. It must not run the acceptance sweep, and it must not launch a browser from shell when mounted browser tools exist. Use two or three coherent native writes or edits for a large artifact rather than one unbounded message; a single write that reaches the output limit leaves no result and fails the stage. If browser access is refused for lack of workflow ownership, stop and hand the sweep to the owner instead of substituting another browser path. Ask the acceptance owner to batch independent page observations into one synchronous evaluate that returns JSON per area, with bounded waits for animation, and to read console and network output once; never leave a promise that can stay pending; an unraced promise from browser_evaluate is refused at the tool boundary because Playwright awaits it without a timeout. If a run stops with a script error before any agent started, treat it as an authoring error in that call (usually a missing args key), fix the script or args, and do not inspect engine source. When one worker must do both, say so explicitly.",
  "Preparing isolated checkouts is coordinator work, not implementation: for independent implementations call create_worktree({enter:false}) yourself and pass the returned path as the worker's cwd. Workers must not create worktrees with git, and dispatching a worker to run git worktree add is a refused bypass. A native worktree keeps its git metadata outside that checkout, so a worker rooted there can edit but its commit is refused; commit each branch from the coordinator or a worker rooted at the repository, never by loosening the sandbox;",
  "pass its path as agent() cwd. On this host isolated cwd uses a fresh linked session because native subagent cwd does not change its sandbox boundary. Uncommitted changes are not copied.",
  "Same or overlapping writable directories and shared browser use cannot overlap. Await the owner before handing off; unrelated isolated work may continue.",
  "Browser workers use normal browser tools with default export paths; unsafe server code and custom filename exports are denied. Use browser:true only for the worker that needs the shared browser. Integrate isolated outputs into the delivery checkout and verify that exact version.",
  "Workflow owns scheduling, results and acceptance; agent() already dispatches execution. Do not duplicate assignments outside it or nest workflows.",
  "Select session:'linked' only for independently followable persistent work; session:'subagent' is sufficient for temporary work.",
  "/collaborate on prefers linked workers but does not require every stage to persist; off disallows linked workers. Linked workers return text, not schema output.",
  "Clarifications and progress may use existing family communication. Return completion through Workflow once rather than sending duplicate completion messages.",
  "Normal orchestration computation, loops and parallel batches belong in the workflow script. A read-only coordinator may use ordinary PTC computation and batched allowed tools.",
  "PTC workflows default to native background jobs, even with budget_ms. Omit run_in_background or set true for real investigation, implementation and browser tasks; collect their result with job_output using short bounded waits. budget_ms checks further dispatch and does not interrupt a running child, so it cannot bound a foreground call. Reserve explicit foreground for very short synthetic calls.",
  "Start each workflow or background job once and collect it once. Do not start an identical run while one is active, do not repeat polling steps that return no new state, and diagnose only after a concrete failure, cancellation or missing result. Batch independent starts and collections into one run_code call instead of one round trip per job. If a PTC foreground call returns a jobId because its wait deadline passed, the run continues in that job: collect it with job_output instead of re-dispatching the same script.",
  "Do not change tool spellings or loosen permissions to evade these boundaries. Preserve stop, failure, resume, logs and inherited permissions.",
  "Await completed results (job_output for background work), verify the integrated deliverable, and report failures honestly. Never start empty probe workflows.",
].join(' ');

// 只随协调者只读开关出现的额外约束：关闭白名单后主会话可以直接执行，
// 再声称“run_code 只接受单条 JSON”就是错误提示。
const LOCK_POLICY = "PTC coordinator limitation: with workspace-write and the coordinator lock on, run_code accepts only a literal JSON tool-call envelope; arbitrary root code is not safely confined to read-only.";

const COORDINATOR_TOOLS = new Set([
  'workflow', 'render_widget', 'create_worktree',
  'read', 'read_image', 'glob', 'grep', 'skill',
  'ask_user', 'ask_user_question', 'todo_write', 'job_output', 'job_kill', 'stop_session', 'interrupt_agent',
  'wait_agent', 'wait_for_sessions', 'list_agents', 'list_linked_sessions', 'read_session',
  'send_message', 'send_session_message',
  'list_recent_sessions', 'read_local_session', 'list_session_models', 'usage_report',
]);
const WORKER_READ_TOOLS = new Set([...COORDINATOR_TOOLS].filter(name => !['workflow','create_worktree','render_widget'].includes(name)));
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
    return `Ultracode PTC syntax error; nothing executed: ${error.message}. Both console.log( and tools.name( need closing parentheses. Every JSON string value must be quoted, so a bare word such as medium is invalid; inner script strings must keep their quotes escaped. Use a single literal JSON call: console.log(await tools.workflow(JSON_OBJECT)); Fix the syntax, not the length; do not start probe workflows.`;
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

/** 协调者只读边界是独立开关；关闭后协调者可以自己写文件，策略提示仍在。 */
function coordinatorLock(ctx) {
  return ctx.get("enhancementSettings")?.ultracodeCoordinatorLock?.() === true;
}

/** 会话内是否开启：显式记录优先，否则跟随设置页的新会话默认值。 */
function active(ctx, session) {
  const state = ctx.sessionProjections.stateOf(session, "ultracode");
  if (typeof state?.active === "boolean") return state.active;
  return defaultActive(ctx);
}

// Public read-only contract supplied by nestedSessions; no private store access.
function unavailableReason(ctx, agent) {
  if (ctx.tools.get('workflow', agent) === undefined) return '当前模式没有 workflow 工具';
  const policy = ctx.get('sandboxPolicy')?.resolve({session:agent.session});
  if (policy && !['read-only','workspace-write'].includes(policy.mode))
    return '当前沙箱不能提供 Workflow 所需的受限写入边界';
  return '';
}
function effectiveMode(ctx, agent) {
  if (!active(ctx, agent.session)) return 'off';
  if (unavailableReason(ctx, agent)) return 'unavailable';
  const mode = ctx.get('nestedSessions')?.delegationMode(agent.id ?? agent.session.id);
  if (agent.session.header?.origin === 'subagent' || mode === 'worker') return 'worker';
  return mode === 'linked' ? 'linked' : 'workflow';
}
function statusText(ctx, agent) {
  const mode = effectiveMode(ctx, agent);
  if (mode === 'off') return 'ultracode 当前已关闭。';
  if (mode === 'unavailable') return `ultracode 偏好已保留，但${unavailableReason(ctx, agent)}，自动编排策略未生效。`;
  const lock = coordinatorLock(ctx);
  const limited = lock && ctx.tools.modeFor?.(agent) === 'ptc' && ctx.get('sandboxPolicy')?.resolve({session:agent.session}).mode !== 'read-only';
  const suffix = limited ? ' PTC 主会话传输仍受限；计算与批量并行可在 Workflow 脚本中执行。' : '';
  // 协调者只读是独立开关；关闭时只能要求编排，不能声称已经在拦截直连执行。
  const enforcement = lock ? '已开启且生效：实质性任务必须经 Workflow' : '已开启：实质性任务应经 Workflow，但协调者只读边界未开启，主会话仍可直接执行';
  if (mode === 'linked') return `ultracode ${enforcement}；优先使用持久关联会话，临时任务仍可用子代理。` + suffix;
  if (mode === 'worker') return 'ultracode 已开启；当前是关联工作会话，按主会话分工执行，不自动启动第二套编排。';
  return `ultracode ${enforcement}；简单问答直接处理。` + suffix;
}

const statusInitializers = [];
export class UltracodeState extends TypertRemoteService {
  static inject = inject;
  constructor(ctx) {
    super(ctx, 'ultracodeState', {namespace: 'ultracodeState'});
    runInitializers(this, statusInitializers);
  }
  requiresWorkflow(agent) {
    return active(this.ctx, agent.session) && !unavailableReason(this.ctx, agent) &&
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
  workerAccess = new Map();
  registerWorker(id, access) { this.workerAccess.set(id, {...access, active:true}); }
  releaseWorker(id) { this.workerAccess.delete(id); }
  workerPolicy(agent) { return this.workerAccess.get(agent.id); }
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
  ctx.effect(() => ctx.tools.guard(exec => {
    const agent = exec.agent;
    if (!agent) return;
    if (agent.session.header?.origin === 'subagent' || ctx.get('nestedSessions')?.delegationMode(agent.id) === 'worker') {
      const access = service.workerPolicy(agent) ?? {active:false,readOnly:true,browser:false};
      // 执行边界与 Ultracode 开关无关：已准入执行者的沙箱、浏览器服务端代码和
      // 无界 evaluate 属于安全边界，关掉 Ultracode 也必须保留。
      if (access?.active) {
        const policy = ctx.get('sandboxPolicy')?.resolve({session:agent.session});
        if (!policy || policy.mode !== (access.readOnly ? 'read-only' : 'workspace-write')) return 'Worker sandbox changed after admission; stop and reconcile before continuing.';
      }
      if (exec.arguments?.sandbox_permissions !== undefined)
        return 'Workflow workers cannot widen their inherited sandbox.';
      const browserCall = /playwright|browser/i.test(exec.name);
      if (browserCall && (/_unsafe$/.test(exec.name) || exec.arguments?.filename !== undefined))
        return 'Workflow browser calls cannot run server-side code or choose export paths; use normal browser tools and their default output directory.';
      if (/_browser_evaluate$/.test(exec.name) && typeof exec.arguments?.function === 'string' &&
          /\bnew\s+Promise\b/.test(exec.arguments.function) && !/Promise\.race\b/.test(exec.arguments.function))
        return 'browser_evaluate must bound every wait, because Playwright awaits the returned promise with no tool timeout: return Promise.race([wait, new Promise(done => setTimeout(done, ms))]), or inspect the page synchronously and return JSON.';
      if (!service.restrictWorker(agent)) return;
      if (READ_ONLY_ROLES.has(agent.session.header?.agentPreset) && exec.name === 'write')
        return 'Ultracode read-only helpers cannot write project files or shared role memory.';
      if (!access.active && exec.name === 'run_code') {
        if (ctx.get('sandboxPolicy')?.resolve({session:agent.session}).mode === 'read-only') return;
        const call = coordinatorCall(exec.arguments?.code);
        if (call && WORKER_READ_TOOLS.has(call.name)) return;
        return 'Inactive workflow workers are read-only. ' + coordinatorFailure(exec.arguments?.code);
      }
      // Creating checkouts is coordinator preparation; a worker running git worktree add bypasses native adoption.
      if (exec.name === 'bash' && /\bgit\s+worktree\s+add\b/.test(exec.arguments?.command ?? ''))
        return 'Create isolated checkouts with the native create_worktree tool from the coordinator (enter:false), then pass the path to the worker as cwd; a worker must not create worktrees with git.';
      const readOnlyExecution = access.active && access.readOnly &&
        ['run_code','bash','structured_output'].includes(exec.name);
      const communication = ['send_message','send_session_message'].includes(exec.name);
      if ((access.readOnly || !access.active) &&
          !(access.active && access.browser && browserCall) &&
          !WORKER_READ_TOOLS.has(exec.name) && !readOnlyExecution && !communication)
        return 'This workflow worker is read-only; assign mutations to an isolated writer.';
      if (access && browserCall && !access.browser)
        return 'Shared browser access requires the workflow browser owner.';
      if (exec.name === 'subagent' && !READ_ONLY_ROLES.has(exec.arguments?.agent_preset))
        return 'Ultracode workers may delegate only read-only explore/planner/reviewer subagents; keep one writer.';
      if (['workflow','subagent_fork','start_session','team_create','team_spawn','spawn_teammate'].includes(exec.name))
        return 'Ultracode worker: execute the assigned stage; no nested workflow, linked family or additional writers.';
      return;
    }
    if (!service.requiresWorkflow(agent)) return;
    // 强制编排可以单独开启：协调者只读与工具白名单由独立开关控制。
    if (!coordinatorLock(ctx)) return;
    if (exec.name === 'create_worktree' && exec.arguments?.enter !== false)
      return 'Prepare worker worktrees with enter:false; create their sessions with the returned cwd.';
    if (exec.name === 'run_code') {
      if (exec.arguments?.sandbox_permissions !== undefined) return 'Ultracode cannot widen the coordinator sandbox.';
      if (ctx.get('sandboxPolicy')?.resolve({session:agent.session}).mode === 'read-only') return;
      const call = coordinatorCall(exec.arguments?.code);
      if (!call) return coordinatorFailure(exec.arguments?.code);
      if (!COORDINATOR_TOOLS.has(call.name))
        return `Ultracode single literal JSON envelope is valid, but direct ${call.name} is disabled. Execute this operation through a workflow worker.`;
      return;
    }
    if (!COORDINATOR_TOOLS.has(exec.name))
      return 'Ultracode requires workflow for implementation, browser actions and delegation. Call workflow; do not retry this operation directly or change tools to bypass it.';

  }));
  ctx.systemPrompt.section({
    name: "ultracode:policy",
    order: 860,
    text: (context) => {
      const agent = context?.agent;
      if (agent === undefined) return "";
      if (agent.session.header?.origin === 'subagent' && READ_ONLY_ROLES.has(agent.session.header?.agentPreset) && service.restrictWorker(agent))
        return 'This workflow helper is strictly read-only, including role MEMORY.md. Return findings as text; do not update memory or start other workers.';
      const access = service.workerPolicy(agent);
      if (access?.active && service.restrictWorker(agent)) {
        if (access.readOnly)
          return 'Execute the assigned investigation only. Return the facts and decisions needed by the next worker concisely; do not expand into unrelated inventories, proof obligations or speculative enhancements. Use the mounted tools directly unless a concrete failure requires investigation. Group independent observations in one safe tool call where possible, keep state-changing actions ordered, and retain every requested acceptance check. Repeat a passed check only after a relevant change or concrete failure.';
        return 'You are an admitted Workflow executor. Keep implementation proportional to the requested outcome. For a new artifact, use the normal tools to save a minimal runnable baseline early, then extend it in coherent verified edits. For an existing artifact, preserve user drafts and make the smallest coherent change first. Do not draft the entire deliverable repeatedly in prose or alternate encodings before saving it. Do not add speculative controls, APIs or design systems. Group coherent edits, run relevant code-level checks, and hand off once they pass; do not repeatedly polish already passing work. Leave the full independent acceptance sweep to its assigned owner; use your browser grant only for concrete implementation debugging, without inventing a substitute browser harness or test server. A failed or truncated result must be reported for reconciliation, never silently retried. Return concise results through Workflow; no duplicate completion or new dispatch path.';
      }
      if (!['workflow','linked'].includes(effectiveMode(ctx, agent))) return '';
      return coordinatorLock(ctx) ? POLICY + ' ' + LOCK_POLICY : POLICY;
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
      const unavailable = wanted && unavailableReason(ctx, invocation.agent);
      if (unavailable)
        return {kind:'error', text:`${unavailable}，无法开启 Ultracode。已有偏好会保留，切换到支持的模式后再应用。`};
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
