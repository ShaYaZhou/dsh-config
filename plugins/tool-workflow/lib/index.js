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
var inject = ["tools", "workflowEngine", "systemPrompt"];
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
var DESCRIPTION = `Run a JavaScript workflow script that orchestrates subagents at scale. Use this for work that fans out across many independent pieces \u2014 an audit over many files, a migration, multi-angle research, adversarial verification of findings \u2014 where you write the orchestration as a script instead of delegating turn by turn.

Script-body hooks:
- \`agent(prompt, opts?): Promise<any>\` \u2014 run one subagent to completion. Without \`opts.schema\` it resolves to the child's final text; with \`opts.schema\` (an object-rooted JSON Schema using ONLY type/properties/required/additionalProperties/items/enum/const/oneOf) it resolves to the validated object. Resolves \`null\` when the child fails (filter with \`.filter(Boolean)\`). Other opts: \`label\` (display), \`phase\` (progress group), and independent \`provider\`/\`model\` LLM target overrides.
- \`pipeline(items, ...stages): Promise<any[]>\` \u2014 run each item through the stages independently with NO barrier between stages (prefer this for multi-stage work). Each stage receives \`(prev, item, index)\`. A stage throw drops that ITEM to \`null\` and skips its remaining stages.
- \`parallel(thunks): Promise<any[]>\` \u2014 run zero-argument functions concurrently and await ALL of them (a barrier; use only when a stage genuinely needs every prior result together). A throwing thunk resolves to \`null\`.
- \`phase(title)\` \u2014 start a progress phase; \`log(message)\` \u2014 narrate progress; \`args\` \u2014 the tool call's \`args\` input, verbatim.
- \`budget\` \u2014 read-only allowance view: \`total\`/\`timeLimitMs\` (null when unlimited), \`spent()\`, \`remaining()\`, \`elapsedMs()\`, \`timeRemainingMs()\`. Use it for dynamic loops: \`while (budget.total && budget.remaining() > 50_000) { ... }\`.

Misused hooks (bad arguments, unknown options, unsupported schemas, tripped caps) end the whole script instead of producing \`null\`. The script has no filesystem, network, timer, or Node.js APIs; the agents do the work. A workflow cannot nest another workflow: a child of a workflow run may not call this tool (one level only).

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
function startBackgroundRun(ctx, args, parent, toolCall, recordsRun, deps) {
  const jobs = ctx.get("jobs");
  if (jobs === void 0) {
    throw new Error("background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs");
  }
  let run;
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
  return { kind: "background", jobId, runId: run.id };
}
function apply(ctx, config) {
  const { toolName, maxResultChars, enableRunInBackground, sizeGuideline } = config;
  const recorder = createWorkflowRecorder(ctx);
  const mirror = createWorkflowRecordMirror(ctx);
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: ctx.systemPrompt.getSectionOrder("TOOL_WORKFLOW"),
    text: `When Ultracode is enabled, substantive tasks MUST use ${toolName}. Otherwise use it for explicit workflows or substantial orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. With Ultracode off, one or two delegations may use plain subagent calls. With Ultracode on, use agent() inside this workflow. /collaborate on selects linked workers within this workflow, never a competing dispatch path.`
  });
  ctx.tools.register(defineTool({
    name: toolName,
    description: `${DESCRIPTION}

${sizeGuidelineText(sizeGuideline)}`,
    parameters: {
      worker_mode: {
        type: "string",
        enum: ["subagent", "linked"],
        description: "Worker lifecycle: subagent by default, linked for persistent followable conversations. With Ultracode on, /collaborate on requires linked and off refuses linked. Linked agent() calls return text and must omit schema. All Ultracode workers run serially in the existing engine."
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
          description: "Run as a background job: return a job id immediately instead of waiting; the return value arrives with the completion notice."
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
      if (args.run_in_background === true) {
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
