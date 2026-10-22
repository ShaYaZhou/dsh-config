import type { Context } from '@deepseek-ai/cordis'

export declare const name: 'tool-workflow'
export declare const inject: readonly string[]

/** Config: the model-facing tool name, result rendering caps, and the size guideline. */
export interface Config {
  /** The model-facing tool name to register (default `workflow`). */
  toolName?: string
  /** Rendered-result ceiling in characters (default 50000). */
  maxResultChars?: number
  /** Expose `run_in_background` (default true). */
  enableRunInBackground?: boolean
  /** Expected workflow size; states the scale and sets the engine's agent-count warning. */
  sizeGuideline?: 'small' | 'medium' | 'large' | 'unlimited'
}

export declare const Config: unknown
export declare function apply(ctx: Context, config: Config): void
