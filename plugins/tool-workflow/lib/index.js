// packages/workflow/tool-workflow/src/index.ts
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

// packages/workflow/tool-workflow/src/record.ts
function createWorkflowRecordMirror(ctx) {
  const active = /* @__PURE__ */ new Map();
  ctx.on("workflow/phase", (info, title) => {
    const job = active.get(info.id);
    if (job === void 0) return;
    job.updateProgress(title);
    job.append(`\u25B8 ${title}
`, { channel: "log" });
  });
  ctx.on("workflow/log", (info, message) => {
    active.get(info.id)?.append(`${message}
`, { channel: "log" });
  });
  ctx.on("workflow/agent-start", (info, agent) => {
    active.get(info.id)?.append(`agent #${agent.seq} ${agent.label} started
`, { channel: "log" });
  });
  ctx.on("workflow/agent-end", (info, agent) => {
    active.get(info.id)?.append(`agent #${agent.seq} ${agent.outcome}
`, { channel: "log" });
  });
  return {
    start(runId, job) {
      active.set(runId, job);
    },
    stop(runId) {
      active.delete(runId);
    }
  };
}

// packages/workflow/tool-workflow/src/index.ts
var name = "tool-workflow";
var inject = ["tools", "systemPrompt"];
var Config = z.object({
  toolName: z.string().default("workflow"),
  maxResultChars: z.natural().min(1).default(5e4),
  enableRunInBackground: z.boolean().default(true),
  sizeGuideline: z.union([
    z.const("small"),
    z.const("medium"),
    z.const("large"),
    z.const("unlimited")
  ]).default("medium")
});
function renderRecordingError(error) {
  try {
    return String(error);
  } catch {
    return "[unrenderable thrown value]";
  }
}
function createWorkflowRecorder(ctx) {
  const active = /* @__PURE__ */ new Map();
  const append = (session, type, data) => {
    const appendRecord = session.append.bind(session);
    try {
      appendRecord(type, data);
      return true;
    } catch (error) {
      ctx.logger.warn(`tool-workflow: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`);
      return false;
    }
  };
  ctx.on("workflow/agent-start", (info, agent) => {
    const session = active.get(info.id);
    if (session === void 0) return;
    const data = {
      runId: info.id,
      seq: agent.seq,
      label: agent.label,
      ...agent.phase === void 0 ? {} : { phase: agent.phase },
      childId: agent.childId
    };
    if (!append(session, "tool-workflow/agent-start", data)) active.delete(info.id);
  });
  ctx.on("workflow/agent-end", (info, agent) => {
    const session = active.get(info.id);
    if (session === void 0) return;
    const data = {
      runId: info.id,
      seq: agent.seq,
      outcome: agent.outcome
    };
    if (!append(session, "tool-workflow/agent-end", data)) active.delete(info.id);
  });
  return {
    start(session, run) {
      if (append(session, "tool-workflow/run-start", { runId: run.id, name: run.meta.name })) {
        active.set(run.id, session);
      }
    },
    finish(runId, stopReason) {
      const session = active.get(runId);
      if (session !== void 0) append(session, "tool-workflow/run-end", { runId, stopReason });
      active.delete(runId);
    },
    abandon: (runId) => {
      active.delete(runId);
    }
  };
}
var DESCRIPTION = `Run a small JavaScript orchestration script for a substantive task. A concise prose plan may come first. Dispatch goals and constraints to workers; do not implement the deliverable inside the coordinator or construct large reporting schemas. Express actual dependencies with await and independent work with parallel. Derive domain answers, detailed design decisions and concrete verification steps inside workers, not in a prewritten coordinator specification. Refine from observed results instead of expanding all possible branches in advance; there is no character-count target or cap. One worker is valid when sufficient. Use concise text results by default; a schema is only for a few scalar fields needed by a later branch, and every property that uses enum or const must also declare type. Use the tools already mounted; do not add environment inventories or extra proof obligations unless a concrete failure requires them.

A user task may span successive small workflow runs. Return necessary discovery first when downstream decisions are unknown; then compose the next run from the observed results instead of prewriting the entire lifecycle. Await an already-determined next stage inside the same script; start another run only when a finding, failure or failed acceptance changes the direction. Pass existing findings forward without expanding optional suggestions into requirements. Preparation workers return only the requested sections, not a full document. Require each worker to end with the requested text deliverable; reasoning alone is a missing result. A read-only worker that returns nothing may be retried once with a narrower brief, while a writable failure is never retried automatically. Per-worker reasoning_effort reuses the native model option: medium suits bounded work after the uncertainties are resolved and should be passed explicitly rather than inheriting a high coordinator default, high suits difficult unresolved questions, and omission inherits. Preserve acceptance coverage. Give every browser, screenshot, responsive and console check to the independent acceptance owner, even when the user asked for them alongside the implementation. Set browser:true only on that owner, never on the implementer. An implementer checks only its own change (syntax, static references, at most one quick render or console sanity check) and must not run that sweep; if browser access is refused for lack of workflow ownership, hand it off instead of launching a browser from shell. Ask it to write a large artifact in two or three coherent native writes or edits rather than one unbounded message; a single write that reaches the output limit leaves no result. Ask the acceptance owner to batch independent page observations into one synchronous evaluate that returns JSON per area, with bounded waits for animation, and read console and network output once; never leave a promise that can stay pending. Start each job once and collect it once with a single bounded wait; do not re-dispatch an active run or repeat polls that return no new state, and diagnose only after a concrete failure, cancellation or missing result. Batch independent observations and independent job starts, and sequence state changes.

Script-body hooks:
- \`agent(prompt, opts?): Promise<any>\` \u2014 run one subagent to completion. Without \`opts.schema\` it resolves to the child's final text; with \`opts.schema\` (an object-rooted JSON Schema using ONLY type/properties/required/additionalProperties/items/enum/const/oneOf) it resolves to the validated object. Resolves \`null\` when the child fails (filter with \`.filter(Boolean)\`). Execution opts: \`read_only\` (native read-only sandbox), \`cwd\` (an isolated worktree the coordinator prepared with create_worktree({enter:false}); workers must not create worktrees with git), \`browser\` (exclusive shared browser owner), \`session\` (subagent or linked). Await conflicting writers or browser users before handoff; use parallel for independent readers or isolated writers. Other opts: \`label\` (display), \`phase\` (progress group), and independent \`provider\`/\`model\` LLM target overrides.
- \`pipeline(items, ...stages): Promise<any[]>\` \u2014 run each item through the stages independently with NO barrier between stages (prefer this for multi-stage work). Each stage receives \`(prev, item, index)\`. A stage throw drops that ITEM to \`null\` and skips its remaining stages.
- \`parallel(thunks): Promise<any[]>\` \u2014 run zero-argument functions concurrently and await ALL of them (a barrier; use only when a stage genuinely needs every prior result together). A throwing thunk resolves to \`null\`.
- \`phase(title)\` \u2014 start a progress phase; \`log(message)\` \u2014 narrate progress; \`args\` \u2014 the tool call's \`args\` input, verbatim.
- \`budget\` \u2014 read-only allowance view: \`total\`/\`timeLimitMs\` (null when unlimited), \`spent()\`, \`remaining()\`, \`elapsedMs()\`, \`timeRemainingMs()\`. Use it for dynamic loops: \`while (budget.total && budget.remaining() > 50_000) { ... }\`.
- \`agent(prompt,{reasoning_effort:"medium"})\` forwards the native per-session reasoning setting for either subagent or linked execution. Supported values must be supported by the selected model; the parent selection and permissions remain unchanged. Omit to inherit.

Misused hooks (bad arguments, unknown options, unsupported schemas, tripped caps) end the whole script instead of producing \`null\`. A script that throws before its first agent started is an authoring error in this call — most often a missing \`args\` key or a template reading a property of undefined. Fix the script or pass \`args\` and rerun; do not inspect engine source. A browser_evaluate that returns an unraced promise is refused, because Playwright awaits it with no tool timeout. Do not prewrite a worker's solution or fallback implementations; obtain independent discovery results before composing dependent work. A failed or null writable result may already have changed files: its directory stays occupied for the rest of this script, so automatic replacement writers are refused. Specific repairs after successful execution and failed acceptance are legitimate new work. Only the documented hooks are supported; use agents for I/O. The orchestration process uses a native read-only sandbox because the JavaScript VM is not a filesystem security boundary. A workflow cannot nest another workflow: a child of a workflow run may not call this tool (one level only).

Recovery: use resume_from_run_id only for the identical original script, inputs, owning session, directory, sandbox and model. Confirmed completed calls replay without new child activations. Changed, corrupt, legacy, unfinished or failed-child checkpoints are refused rather than re-executed. A source run has exactly one successor; use the newest run ID for further recovery. Stopped or failed owners require a human /workflow resume <runId> or /workflow <new task> before further workflow execution. Do not switch tools to evade this refusal. Writable child calls missing structured output are not automatically retried.`;
function sizeGuidelineText(guideline) {
  switch (guideline) {
    case "small":
      return "Size guideline: this deployment expects small workflows (roughly 1\u20135 agents). If the task genuinely needs more, scale up deliberately rather than silently capping coverage, and say why in the script.";
    case "medium":
      return "Size guideline: this deployment expects medium workflows (around 10 agents). If the task genuinely needs more, scale up deliberately rather than silently capping coverage, and say why in the script.";
    case "large":
      return "Size guideline: this deployment expects large workflows (25 or more agents), with a 25-agent warning threshold beyond which the run must justify its scale.";
    case "unlimited":
      return "Scale the number of agents to the task; this deployment sets no fixed size guideline.";
  }
}
var SIZE_THRESHOLDS = {
  small: 5,
  medium: 10,
  large: 25,
  unlimited: 0
};
function startExtras(args, guideline) {
  return {
    ...args.worker_mode === void 0 ? {} : { workerMode: args.worker_mode },
    ...args.resume_from_run_id === void 0 ? {} : { resumeFromRunId: args.resume_from_run_id },
    ...args.budget_tokens === void 0 ? {} : { maxTokens: args.budget_tokens },
    ...args.budget_ms === void 0 ? {} : { maxDurationMs: args.budget_ms },
    warnAboveAgents: SIZE_THRESHOLDS[guideline]
  };
}
function presentWorkflowCall(args) {
  return {
    card: "generic",
    title: `workflow: ${args.meta.name}`,
    rawInput: args.script
  };
}
function presentWorkflowResult(args, result) {
  void args;
  void result;
  return { card: "generic" };
}
function stopReasonError(result) {
  switch (result.stopReason) {
    case "completed":
      return void 0;
    case "cancelled":
      return `workflow run was cancelled${result.error !== void 0 ? ` (${result.error})` : ""}`;
    case "error":
      return `workflow run failed: ${result.error ?? "unknown error"}`;
    /* v8 ignore start -- defensive: WorkflowStopReason is a closed union, exhaustive by construction; a future variant fails here loudly */
    default:
      return `workflow run ended abnormally (${String(result.stopReason)})`;
  }
}
function jobOutcomeOf(result, name2, maxChars) {
  switch (result.stopReason) {
    case "completed":
      return {
        status: "completed",
        detail: `${result.agentsStarted} agent${result.agentsStarted === 1 ? "" : "s"}`,
        result: renderResult(name2, result.agentsStarted, result.value, maxChars)
      };
    case "cancelled":
      return { status: "killed" };
    case "error":
      return { status: "failed", detail: result.error ?? "unknown error" };
    /* v8 ignore start -- defensive: WorkflowStopReason is a closed union, exhaustive by construction; a future variant fails here loudly */
    default:
      return { status: "failed", detail: `workflow run ended abnormally (${String(result.stopReason)})` };
  }
}
function renderResult(name2, agentsStarted, value, maxChars) {
  const rendered = JSON.stringify(value, null, 2);
  const clipped = rendered.length > maxChars ? `${rendered.slice(0, maxChars)}
\u2026 [truncated: ${rendered.length - maxChars} more characters]` : rendered;
  return `workflow "${name2}" completed (${agentsStarted} agent call${agentsStarted === 1 ? "" : "s"}, including any checkpoint replays).
Return value:
${clipped}`;
}
function wantsBackground(args, mode, enabled) {
  if (args.run_in_background !== undefined) return args.run_in_background;
  return enabled && mode === "ptc";
}
function startBackgroundRun(ctx, args, parent, toolCall, recordsRun, deps, capture) {
  const jobs = ctx.get("jobs");
  if (jobs === void 0) {
    throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs");
  }
  let run;
  let raw;
  const jobId = jobs.start({
    kind: "workflow",
    label: args.meta.name,
    owner: parent.id,
    toolCall,
    run: (job) => {
      run = ctx.workflowEngine.start({
        script: args.script,
        meta: args.meta,
        ...args.args !== void 0 ? { args: args.args } : {},
        parent,
        ...startExtras(args, deps.sizeGuideline)
      });
      raw = run.result;
      deps.mirror.start(run.id, job);
      if (recordsRun) deps.recorder.start(parent.session, run);
      const done = run.result.then(async (result) => {
        try {
          await run.dispose();
        } catch (error) {
          ctx.logger.warn(`background workflow run ${run.id} dispose failed: ${String(error)}`);
        }
        deps.mirror.stop(run.id);
        if (recordsRun) {
          deps.recorder.finish(run.id, result.stopReason);
          deps.recorder.abandon(run.id);
        }
        const outcome=jobOutcomeOf(result, args.meta.name, deps.maxResultChars);
        if(outcome.status!=="completed")outcome.detail=`Run ${run.id}: ${outcome.detail ?? outcome.status}. Automatic restart is blocked; inspect the checkpoint before /workflow resume ${run.id}.`;
        return outcome;
      });
      return {
        cancel: (reason) => {
          run.cancel(reason ?? "background workflow job killed");
        },
        done
      };
    }
  });
  if (capture) capture.raw = raw;
  return { kind: "background", jobId, runId: run.id };
}
function apply(ctx, config) {
  // Optional tool adapter: keep the preset usable when engine admission fails.
  // Cordis owns registration cleanup if the engine disappears; never substitute an executor.
  ctx.inject(["workflowEngine"], (scope) => applyWithEngine(scope, config));
}
function applyWithEngine(ctx, config) {
  const { toolName, maxResultChars, enableRunInBackground, sizeGuideline } = config;
  const recorder = createWorkflowRecorder(ctx);
  const mirror = createWorkflowRecordMirror(ctx);
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: ctx.systemPrompt.getSectionOrder("TOOL_WORKFLOW"),
    text: `When Ultracode is enabled, substantive tasks MUST use ${toolName}. Otherwise use it for explicit workflows or substantial orchestration: you write a JavaScript script (the tool description documents the exact format) that expresses only the dependencies and acceptance the task needs. Phases and schemas are optional; prefer brief text results. With Ultracode off, one or two delegations may use plain subagent calls. With Ultracode on, use agent() inside this workflow. /collaborate on prefers linked workers within this workflow; temporary stages may select session:subagent. Never create a competing dispatch path.`
  });
  ctx.tools.register(defineTool({
    name: toolName,
    description: `${DESCRIPTION}

${sizeGuidelineText(sizeGuideline)}`,
    parameters: {
      worker_mode: {
        type: "string",
        enum: ["subagent", "linked"],
        description: "Worker lifecycle: subagent by default, linked for persistent followable conversations. With Ultracode on, /collaborate on prefers linked and off refuses linked. Per-agent session may choose temporary subagent execution. Linked agent() calls return text and must omit schema. Existing concurrency limits apply; only overlapping writable roots or shared browser ownership conflict."
      },
      script: {
        type: "string",
        required: true,
        description: "The plain JavaScript body, not TypeScript and without an `export const meta` statement; top-level await is allowed. End with `return <value>`; the JSON-serializable value is this tool's result."
      },
      meta: {
        type: "object",
        additionalProperties: true,
        required: true,
        description: "The workflow identity as plain JSON, not code.",
        properties: {
          name: { type: "string", required: true, description: "Short kebab-case workflow name." },
          description: { type: "string", required: true, description: "One-line description of what the workflow does." },
          whenToUse: { type: "string", description: "Optional guidance on when this workflow applies." },
          phases: {
            type: "array",
            description: "Optional phase declarations matched by phase() calls.",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                title: { type: "string", required: true, description: "The phase title phase() calls match by exact string." },
                detail: { type: "string", description: "Optional one-line description of the phase." },
                provider: { type: "string", description: "Optional provider override this phase is expected to use." },
                model: { type: "string", description: "Optional model override this phase is expected to use." }
              }
            }
          }
        }
      },
      args: {
        type: "object",
        additionalProperties: true,
        description: 'Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {"files": [...]}).'
      },
      ...enableRunInBackground ? {
        run_in_background: {
          type: "boolean",
          description: "Run as a native background job and collect completion with job_output. PTC defaults to background, including calls with budget_ms. For real investigation, implementation or browser tasks in PTC, omit this flag or set true. A PTC foreground call keeps its run in a native job: if it finishes in time you get the result, and if run_code's deadline interrupts the wait you get the jobId instead of a cancelled run, so collect it with job_output and do not re-dispatch. Explicit false is still only for short calls. Other modes default to foreground."
        }
      } : {},
      resume_from_run_id: {
        type: "string",
        description: "Resume an identical verified v2 checkpoint owned by this session. Completed calls replay; new calls start only after all checkpoints are consumed. Changed inputs, ambiguous writes, corrupt logs and duplicate successors are refused. Stopped or failed sessions need explicit human /workflow resume authorization."
      },
      budget_tokens: {
        type: "integer",
        description: "Token allowance for this run, summed over all child agents. Once spent, further agent() calls fail and the script should return what it already gathered. Omit for the deployment default."
      },
      budget_ms: {
        type: "integer",
        description: "Elapsed-time allowance for this run in milliseconds. Once exhausted, further agent() calls fail and the script should return what it already gathered. Omit for the deployment default."
      }
    },
    output: {
      schema: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", required: true, const: "background" },
              jobId: { type: "string", required: true },
              runId: { type: "string", required: true }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", required: true, const: "foreground" },
              runId: { type: "string", required: true },
              agentsStarted: { type: "integer", required: true },
              result: { type: "json", required: true }
            }
          }
        ]
      },
      render: (args, value) => [{
        type: "text",
        text: value.kind === "background" ? `workflow "${args.meta.name}" started in the background as job ${value.jobId}. Its return value arrives with the completion notice; check on it with job_output, stop it with job_kill.` : renderResult(args.meta.name, value.agentsStarted, value.result, maxResultChars)
      }]
    },
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent) {
        throw new Error("workflow tool requires a calling agent (exec.agent was undefined)");
      }
      if (wantsBackground(args, ctx.tools.modeFor(parent), enableRunInBackground)) {
        if (!enableRunInBackground) {
          throw new Error("run_in_background is disabled for this tool");
        }
        return startBackgroundRun(ctx, args, parent, { callId: exec.callId, rootCallId: exec.rootCallId }, (exec.parent === void 0 || ctx.tools.modeFor(parent) === "ptc"), {
          recorder,
          mirror,
          maxResultChars,
          sizeGuideline
        });
      }
      if (enableRunInBackground && ctx.tools.modeFor(parent) === "ptc" && ctx.get("jobs") !== void 0) {
        const capture = {};
        const job = startBackgroundRun(ctx, args, parent, { callId: exec.callId, rootCallId: exec.rootCallId }, true, {
          recorder,
          mirror,
          maxResultChars,
          sizeGuideline
        }, capture);
        const aborted = new Promise((resolve) => {
          if (exec.signal.aborted) return resolve(true);
          exec.signal.addEventListener("abort", () => resolve(true), { once: true });
        });
        const winner = await Promise.race([capture.raw.then((result) => ({ result })), aborted]);
        if (winner === true) return { kind: "background", jobId: job.jobId, runId: job.runId };
        const error = stopReasonError(winner.result);
        if (error !== void 0) {
          throw new Error(`workflow run ${job.runId}: ${error}. Completed checkpoints remain in the journal; use /workflow resume ${job.runId} only after reviewing the failure.`);
        }
        return { kind: "foreground", runId: job.runId, agentsStarted: winner.result.agentsStarted, result: winner.result.value };
      }
      const run = ctx.workflowEngine.start({
        script: args.script,
        meta: args.meta,
        ...args.args !== void 0 ? { args: args.args } : {},
        parent,
        signal: exec.signal,
        ...startExtras(args, sizeGuideline)
      });
      const recordsRun = (exec.parent === void 0 || ctx.tools.modeFor(parent) === "ptc");
      if (recordsRun) recorder.start(parent.session, run);
      const onAbort = () => {
        run.cancel("parent step aborted");
      };
      exec.signal.addEventListener("abort", onAbort, { once: true });
      let result;
      try {
        result = await run.result;
        const error = stopReasonError(result);
        if (error !== void 0) {
          throw new Error(`workflow run ${run.id}: ${error}. Completed checkpoints remain in the journal; use /workflow resume ${run.id} only after reviewing the failure.`);
        }
        return {
          kind: "foreground",
          runId: run.id,
          agentsStarted: result.agentsStarted,
          result: result.value
        };
      } finally {
        exec.signal.removeEventListener("abort", onAbort);
        try {
          await run.dispose();
          if (recordsRun) {
            if (result === void 0) throw new Error("workflow run settled without a result");
            recorder.finish(run.id, result.stopReason);
          }
        } finally {
          if (recordsRun) recorder.abandon(run.id);
        }
      }
    },
    presentCall: (args) => presentWorkflowCall(args),
    presentResult: (args, result) => presentWorkflowResult(args, result)
  }));
}
export {
  Config,
  apply,
  inject,
  name
};
