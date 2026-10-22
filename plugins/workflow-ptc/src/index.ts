/**
 * Workflow orchestration through the shared sandboxed Node PTC executor.
 * The VM supplies script helpers; the process applies the calling Session's file policy.
 * @module @deepseek-ai/dsh-workflow-ptc
 */

import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import * as vm from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-ptc-runtime'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import WorkflowEngine, { WorkflowError, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowRunInfo, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { PtcWorkflowRun } from './host.ts'
import { isWorkflowRunId, WorkflowJournal } from './journal.ts'
import { validateMeta } from './meta.ts'
import type { WorkerInit, WorkerLimits } from './types.ts'

export { validateMeta } from './meta.ts'
export { materializeFromRealm, MaterializeError } from './realm.ts'
export type {
  ChildHandle,
  ChildPort,
  ChildResult,
  ChildStartRequest,
  WorkerInit,
  WorkerLimits,
} from './types.ts'

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves to `min(16, max(1, cores - 2))`. */
  maxConcurrentAgents?: number
  /** Total `agent()` calls one run may start — the runaway-loop backstop (default 1000). */
  maxTotalAgents?: number
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  /** VM timeout for the script's initial synchronous slice (default 5000 ms). */
  syncTimeoutMs?: number
  /** Cumulative child-token ceiling per run; `null` (default) = unlimited. A start request may lower it, never raise it. */
  budgetTokens?: number | null
  /** Elapsed-time ceiling per run in milliseconds; `null` (default) = unlimited. A start request may lower it, never raise it. */
  budgetMs?: number | null
  /** Default size-guideline warning threshold; `0` (default) = no warning. A start request may override it. */
  warnAboveAgents?: number
  /** Write a per-run agent journal so a later run can resume (default true). */
  journal?: boolean
  /** Journal directory; empty (default) resolves `dshHomePath('workflows','runs')`, and is off when the host provides no home path. */
  journalRoot?: string
}

/** Per-call governance fields the model-facing tool passes beside the seam request. */
interface PtcStartExtras {
  readonly resumeFromRunId?: string
  readonly maxTokens?: number
  readonly maxDurationMs?: number
  readonly warnAboveAgents?: number
}

/** The subset of the host session-query service this engine reads (live-or-cold child usage). */
interface SessionQueryLike {
  observeSession(id: SessionId, options: { projectionMode: 'all' }): Promise<{
    readonly projections?: { readonly values: Record<string, unknown> }
    [Symbol.dispose](): void
  }>
}

/** The `tokenUsage` projection's client view. */
interface TokenUsageValue {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

type ResolvedConfig = Required<Config>

/** A body that still carries the Claude Code-style meta header (meta rides the seam as data here). */
const META_STATEMENT = /^\s*export\s+const\s+meta\b/

/**
 * Reject invalid JavaScript synchronously before publishing a workflow run.
 * The guest compiles the same async wrapper in its own process.
 */
function assertBodyParses(body: string, name: string): void {
  if (META_STATEMENT.test(body)) {
    throw new WorkflowError('workflow meta rides the `meta` request field, not the script: remove the `export const meta = {...}` statement from the body', 'SCRIPT_PARSE')
  }
  try {
    // Parse only — the script object is discarded, nothing executes.
    void new vm.Script(`(async () => {\n${body}\n})()`, { filename: `workflow:${name}`, lineOffset: -1 })
  } catch (error: unknown) {
    throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error })
  }
}

/** Resolve one run's provider route before publishing work. */
function resolveSubagentProvider(ctx: Context, configured: string, override: string | undefined): string {
  const provider = override ?? configured
  if (provider.length === 0 || provider !== provider.trim()) {
    throw new WorkflowError(
      'workflow subagentProvider must be a non-empty normalized string',
      'INVALID_ARGUMENT',
    )
  }
  if (ctx.subagents.getProvider(provider) === undefined) {
    throw new WorkflowError(`no subagent provider registered for "${provider}"`, 'AGENT_START')
  }
  return provider
}

/** Resolve one run's total-child cap against the engine deployment ceiling. */
function resolveMaxTotalAgents(requested: number | undefined, ceiling: number): number {
  if (requested === undefined) return ceiling
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new WorkflowError('workflow maxTotalAgents must be a positive safe integer', 'INVALID_ARGUMENT')
  }
  if (requested > ceiling) {
    throw new WorkflowError(
      `workflow maxTotalAgents ${requested} exceeds the engine ceiling ${ceiling}`,
      'INVALID_ARGUMENT',
    )
  }
  return requested
}

/** Resolve one run's budget against the engine deployment ceiling. */
function resolveBudget(requested: number | undefined, ceiling: number | null, name: string): number | null {
  if (requested === undefined) return ceiling
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new WorkflowError(`workflow ${name} must be a positive safe integer`, 'INVALID_ARGUMENT')
  }
  if (ceiling !== null && requested > ceiling) {
    throw new WorkflowError(`workflow ${name} ${requested} exceeds the engine ceiling ${ceiling}`, 'INVALID_ARGUMENT')
  }
  return requested
}

/** Resolve the size-guideline warning threshold (0 disables it). */
function resolveWarnAboveAgents(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new WorkflowError('workflow warnAboveAgents must be a non-negative safe integer', 'INVALID_ARGUMENT')
  }
  return requested
}

/**
 * The PTC-backed workflow engine. `start()` validates the script up front
 * (meta + a host-side body parse) and returns a {@link WorkflowRun} whose
 * `result` never rejects; the `workflow/*` events fire around the run per
 * the seam contract.
 */
class PtcWorkflowEngine extends WorkflowEngine {
  static inject = ['subagents', 'ptcRuntime', 'sandboxPolicy', 'workingDirectory']

  static Config: z<Config> = z.object({
    provider: z.string().default('spawn'),
    maxConcurrentAgents: z.natural().default(0),
    maxTotalAgents: z.natural().min(1).default(1000),
    maxItemsPerCall: z.natural().min(1).default(4096),
    syncTimeoutMs: z.natural().min(1).default(5000),
    budgetTokens: z.union([z.const(null), z.natural().min(1)]).default(null),
    budgetMs: z.union([z.const(null), z.natural().min(1)]).default(null),
    warnAboveAgents: z.natural().default(0),
    journal: z.boolean().default(true),
    journalRoot: z.string().default(''),
  })

  private readonly config: ResolvedConfig
  /**
   * Child sessions this process started on behalf of a workflow run. Used to
   * enforce one nesting level: a workflow child may not start a workflow.
   */
  private readonly workflowChildren = new Set<SessionId>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    if (ctx.ptcRuntime.language !== 'typescript') throw new Error('workflow-ptc requires the Node TypeScript PTC runtime')
    // schemastery (static Config) fills the non-null defaults; it drops a
    // `default(null)`, so the two nullable budgets resolve here.
    this.config = {
      ...config,
      budgetTokens: config.budgetTokens ?? null,
      budgetMs: config.budgetMs ?? null,
    } as ResolvedConfig
  }

  /** The host's harness-home path resolver, when mounted. */
  private homePath(): ((...segments: string[]) => string) | undefined {
    const lookup = this.ctx.get.bind(this.ctx) as (name: string) => unknown
    return lookup('dshHomePath') as ((...segments: string[]) => string) | undefined
  }

  /** The engine's journal directory, or undefined to disable journaling. */
  private journalRoot(): string | undefined {
    if (!this.config.journal) return undefined
    return this.config.journalRoot !== '' ? this.config.journalRoot : this.homePath()?.('workflows', 'runs')
  }

  /** Read a settled child's token usage over the live-or-cold session observation service. */
  private tokenReader(): ((childId: SessionId) => Promise<number>) | undefined {
    const lookup = this.ctx.get.bind(this.ctx) as (name: string) => unknown
    const query = lookup('sessionQuery') as SessionQueryLike | undefined
    if (query === undefined) return undefined
    return async (childId) => {
      const observation = await query.observeSession(childId, { projectionMode: 'all' })
      try {
        const usage = observation.projections?.values.tokenUsage as TokenUsageValue | undefined
        if (usage === undefined) return 0
        return usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      } finally {
        observation[Symbol.dispose]()
      }
    }
  }

  /**
   * Validate and execute a workflow script in a sandboxed Node process. Throws
   * {@link WorkflowError} synchronously (`META_INVALID` for a malformed meta
   * block, `SCRIPT_PARSE` for a body that does not compile) for a request
   * that cannot begin; once a run is returned, every failure resolves through
   * `result.stopReason` instead.
   * @param request - the script body, its meta data and `args`, the parent
   *   agent, and an optional cancel signal.
   * @returns the live run (its `result` resolves when the script settles).
   */
  start(request: WorkflowStartRequest): WorkflowRun {
    const meta = validateMeta(request.meta)
    assertBodyParses(request.script, meta.name)
    if (this.workflowChildren.has(request.parent.session.id)) {
      throw new WorkflowError(
        'a workflow child cannot start another workflow (one nesting level) — run this stage inline, or start it after the parent workflow settles',
        'AGENT_CAP',
      )
    }
    const extras = request as WorkflowStartRequest & PtcStartExtras
    const budgetTokens = resolveBudget(extras.maxTokens, this.config.budgetTokens, 'budget_tokens')
    const budgetMs = resolveBudget(extras.maxDurationMs, this.config.budgetMs, 'budget_ms')
    const warnAboveAgents = resolveWarnAboveAgents(extras.warnAboveAgents, this.config.warnAboveAgents)
    const resumeFrom = extras.resumeFromRunId
    if (resumeFrom !== undefined && !isWorkflowRunId(resumeFrom)) {
      throw new WorkflowError('workflow resume_from_run_id must be the run id returned by a prior workflow call', 'INVALID_ARGUMENT')
    }
    const subagentProvider = resolveSubagentProvider(this.ctx, this.config.provider, request.subagentProvider)
    const maxTotalAgents = resolveMaxTotalAgents(request.maxTotalAgents, this.config.maxTotalAgents)
    // Tokens are only read when a budget needs them; a budget without the
    // observation service would silently never trip, so refuse it up front.
    const readTokens = this.tokenReader()
    if (budgetTokens !== null && readTokens === undefined) {
      throw new WorkflowError(
        'a token budget requires the host session-query service (dsh-session-query); omit budget_tokens or mount it',
        'INVALID_ARGUMENT',
      )
    }
    const id = WorkflowRunId(randomUUID())
    const info: WorkflowRunInfo = { id, meta }
    const limits: WorkerLimits = {
      maxConcurrentAgents: this.config.maxConcurrentAgents === 0
        ? Math.min(16, Math.max(1, availableParallelism() - 2))
        : this.config.maxConcurrentAgents,
      maxTotalAgents,
      maxItemsPerCall: this.config.maxItemsPerCall,
      syncTimeoutMs: this.config.syncTimeoutMs,
      budgetTokens,
      budgetMs,
      warnAboveAgents,
    }
    const init: WorkerInit = {
      meta,
      body: request.script,
      ...request.args !== undefined ? { args: structuredClone(request.args) } : {},
      limits,
    }
    // A resume source must be readable before anything is published, so the
    // journal is opened (and can reject synchronously) ahead of the run.
    const journal = this.config.journal || resumeFrom !== undefined
      ? new WorkflowJournal(
          this.journalRoot(),
          id,
          { name: meta.name, provider: subagentProvider },
          (message) => { this.ctx.logger.warn(message) },
          resumeFrom,
        )
      : undefined
    // Captured service handles keep a holder-owned run usable after engine unload.
    const runCtx = this.ctx
    const subagents = runCtx.subagents
    const run = new PtcWorkflowRun(
      runCtx,
      subagents,
      runCtx.ptcRuntime,
      id,
      meta,
      request.parent,
      init,
      subagentProvider,
      runCtx.sandboxPolicy.resolve({ session: request.parent.session }),
      {
        phase: (title) => { this.emitWorkflowEvent('workflow/phase', info, title) },
        log: (message) => { this.emitWorkflowEvent('workflow/log', info, message) },
        agentStart: (agent) => { this.emitWorkflowEvent('workflow/agent-start', info, agent) },
        agentEnd: (agent) => { this.emitWorkflowEvent('workflow/agent-end', info, agent) },
      },
      {
        ...journal === undefined ? {} : { journal },
        ...budgetTokens === null || readTokens === undefined ? {} : { readTokens },
        onChildActive: (childId, active) => {
          if (active) this.workflowChildren.add(childId)
          else this.workflowChildren.delete(childId)
        },
        ...request.signal === undefined ? {} : { signal: request.signal },
      },
    )

    this.emitWorkflowEvent('workflow/start', info)
    // `workflow/end` fires as the (never-rejecting) result settles, with the
    // outcome DATA only — the value stays with the run's holder.
    void run.result.then((settled) => {
      this.emitWorkflowEvent('workflow/end', info, {
        stopReason: settled.stopReason,
        ...settled.error !== undefined ? { error: settled.error } : {},
        agentsStarted: settled.agentsStarted,
      })
    })

    return run
  }
}

export default PtcWorkflowEngine
