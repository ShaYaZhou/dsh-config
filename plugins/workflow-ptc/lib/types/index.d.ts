import type { Context } from '@deepseek-ai/cordis'
import WorkflowEngine from '@deepseek-ai/dsh-workflow'

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves from the core count. */
  maxConcurrentAgents?: number
  /** Total `agent()` calls one run may start (default 1000). */
  maxTotalAgents?: number
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  /** VM timeout for the script's initial synchronous slice (default 5000 ms). */
  syncTimeoutMs?: number
  /** Cumulative child-token ceiling per run; `null` (default) = unlimited; a start request may lower it. */
  budgetTokens?: number | null
  /** Elapsed-time ceiling per run in milliseconds; `null` (default) = unlimited; a start request may lower it. */
  budgetMs?: number | null
  /** Size-guideline warning threshold; `0` (default) disables it; a start request may override it. */
  warnAboveAgents?: number
  /** Write a per-run agent journal so a later run can resume (default true). */
  journal?: boolean
  /** Journal directory; empty (default) resolves `dshHomePath('workflows','runs')`. */
  journalRoot?: string
}

/** PTC-backed workflow engine (upstream seam implementation, locally patched). */
export default class PtcWorkflowEngine extends WorkflowEngine {
  static inject: readonly string[]
  static Config: unknown
  constructor(ctx: Context, config: Config)
}
