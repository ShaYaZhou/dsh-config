/**
 * Per-run journal of `agent()` calls, written by the harness host process so a
 * later run can replay an unchanged prefix instead of spawning those children
 * again. The guest never sees files: replay is invisible to the script.
 *
 * One `<runId>.jsonl` file holds a `run` header, then a `call` line when a
 * child is published and a `result` line when it settles. Matching is by the
 * guest's 1-based `seq`, prompt, effective provider, model and schema; replay
 * stops permanently at the first difference (a changed earlier call may be an
 * upstream input to every later one, so later calls must run live too).
 * Label and phase are display-only and deliberately excluded.
 *
 * @module @deepseek-ai/dsh-workflow-ptc/journal
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { WorkflowError } from '@deepseek-ai/dsh-workflow'
import type { ChildResult, ChildStartRequest } from './types.ts'

/** A journaled `agent()` call identity (what a later run must match to replay). */
interface JournalCall {
  readonly t: 'call'
  readonly seq: number
  readonly prompt: string
  /** Effective provider: the per-call override or the run's provider. */
  readonly provider: string
  readonly model: string | null
  readonly schema: unknown | null
  readonly childId: string
}

/** A settled child, exactly as the guest consumed it. */
interface JournalResult {
  readonly t: 'result'
  readonly seq: number
  readonly output: ContentBlock[]
  readonly stopReason: string
  readonly structured?: unknown
}

interface JournalHeader {
  readonly t: 'run'
  readonly v: 1
  readonly runId: string
  readonly name: string
  readonly provider: string
}

/** What startChild replays: the old child id and its recorded result. */
export interface JournalReplay {
  readonly childId: string
  readonly result: ChildResult
}

/** A UUID-shaped run id is the only spelling allowed to reach the journal path. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a string is a valid workflow run id (and therefore a safe journal file name).
 * @param value - candidate id from a start request.
 * @returns true for the canonical UUID spelling.
 */
export function isWorkflowRunId(value: string): boolean {
  return RUN_ID.test(value)
}

/** The replay identity of one child request. */
function callOf(request: ChildStartRequest, provider: string, childId: string): JournalCall {
  return {
    t: 'call',
    seq: request.seq,
    prompt: request.prompt,
    provider,
    model: request.model ?? null,
    schema: request.schema ?? null,
    childId,
  }
}

/** Whether a recorded call matches the current request's replay key. */
function sameCall(recorded: JournalCall, request: ChildStartRequest, provider: string): boolean {
  return recorded.seq === request.seq
    && recorded.prompt === request.prompt
    && recorded.provider === provider
    && recorded.model === (request.model ?? null)
    && deepEqualJson(recorded.schema, request.schema ?? null)
}

/** One journal file writer plus the (optional) replay map read from a prior run. */
export class WorkflowJournal {
  private writes: boolean
  private readonly file: string
  private readonly log: (message: string) => void
  private readonly replay: Map<number, { call: JournalCall; result?: JournalResult }> | undefined
  private replayOff = false
  private replayed = 0

  /**
   * Open the journal for one run and load the resume source, if any.
   * @param root - journal directory; `undefined` disables journaling entirely.
   * @param runId - this run's id (the new file name).
   * @param header - identity written as the file's first line.
   * @param log - warning sink; journal failures never fail the run.
   * @param resumeFrom - prior run id whose journal should be replayed.
   * @throws WorkflowError when `resumeFrom` cannot be honored; the caller maps it to a tool error.
   */
  constructor(
    root: string | undefined,
    runId: string,
    header: { name: string; provider: string },
    log: (message: string) => void,
    resumeFrom?: string,
  ) {
    this.log = log
    this.writes = root !== undefined
    this.file = join(root ?? '', `${runId}.jsonl`)
    if (root !== undefined) {
      try {
        mkdirSync(root, { recursive: true })
        appendFileSync(this.file, `${JSON.stringify({ t: 'run', v: 1, runId, ...header })}\n`)
      } catch (error: unknown) {
        this.disable(`cannot write the workflow journal under the configured journalRoot: ${String(error)}`)
      }
    }
    this.replay = resumeFrom === undefined ? undefined : this.load(root, resumeFrom)
  }

  /**
   * Read one prior run's journal into a replay map.
   * @param root - journal directory (absent means resume was requested without journaling).
   * @param resumeFrom - validated prior run id.
   * @returns call/result entries keyed by `seq`.
   * @throws WorkflowError when the file is missing, unreadable, or not a v1 journal for that run.
   */
  private load(root: string | undefined, resumeFrom: string): Map<number, { call: JournalCall; result?: JournalResult }> {
    if (root === undefined) {
      throw new WorkflowError(
        'resume_from_run_id requires a workflow journal directory; this engine has journaling disabled',
        'INVALID_ARGUMENT',
      )
    }
    let text: string
    try {
      text = readFileSync(join(root, `${resumeFrom}.jsonl`), 'utf8')
    } catch (error: unknown) {
      throw new WorkflowError(`cannot resume workflow run ${resumeFrom}: its journal is not readable: ${String(error)}`, 'INVALID_ARGUMENT')
    }
    const lines = text.split('\n')
    const header = parseLine(lines[0])
    if (header === undefined || header.t !== 'run' || header.v !== 1 || header.runId !== resumeFrom) {
      throw new WorkflowError(`cannot resume workflow run ${resumeFrom}: the journal header is missing, corrupted, or from another run`, 'INVALID_ARGUMENT')
    }
    const entries = new Map<number, { call: JournalCall; result?: JournalResult }>()
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.length === 0) continue
      const entry = parseLine(line)
      if (entry === undefined) {
        // A torn final line is a crash mid-append: everything before it is valid.
        if (index === lines.length - 1) break
        this.log(`workflow resume: ignoring the remainder of ${resumeFrom} after a corrupted line; later agents run live`)
        break
      }
      if (entry.t === 'call') {
        if (!entries.has(entry.seq)) entries.set(entry.seq, { call: entry })
      } else if (entry.t === 'result') {
        const existing = entries.get(entry.seq)
        if (existing !== undefined && existing.result === undefined) existing.result = entry
      }
    }
    return entries
  }

  /**
   * Try to replay one call from the prior run.
   * @param request - the current child start request.
   * @param provider - effective provider for this run.
   * @returns the recorded child id + result, or `undefined` once replay is off.
   */
  takeReplay(request: ChildStartRequest, provider: string): JournalReplay | undefined {
    if (this.replay === undefined || this.replayOff) return undefined
    const entry = this.replay.get(request.seq)
    if (entry === undefined || entry.result === undefined || !sameCall(entry.call, request, provider)) {
      this.replayOff = true
      this.log(`workflow resume: replayed ${this.replayed} agent call(s); running live from agent #${request.seq}`)
      return undefined
    }
    this.replayed += 1
    return {
      childId: entry.call.childId,
      result: {
        output: entry.result.output,
        stopReason: entry.result.stopReason,
        ...entry.result.structured === undefined ? {} : { structured: entry.result.structured },
        // A replayed child consumed nothing in this run.
        tokens: 0,
      },
    }
  }

  /** Append the published-call line (a later resume needs it to replay that child). */
  recordCall(request: ChildStartRequest, provider: string, childId: string): void {
    this.append(callOf(request, provider, childId))
  }

  /** Append the settled-result line; a call without one is metadata-only and not replayable. */
  recordResult(seq: number, result: ChildResult): void {
    this.append({
      t: 'result',
      seq,
      output: result.output,
      stopReason: result.stopReason,
      ...result.structured === undefined ? {} : { structured: result.structured },
    })
  }

  private append(line: JournalCall | JournalResult): void {
    if (!this.writes) return
    try {
      appendFileSync(this.file, `${JSON.stringify(line)}\n`)
    } catch (error: unknown) {
      this.disable(`cannot append to the workflow journal; resume is unavailable for this run: ${String(error)}`)
    }
  }

  private disable(message: string): void {
    this.writes = false
    this.log(message)
  }
}

/** Parse one JSONL line, returning undefined for anything that is not a journal record. */
function parseLine(line: string | undefined): JournalHeader | JournalCall | JournalResult | undefined {
  if (line === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.t === 'run') {
    return record.v === 1 && typeof record.runId === 'string' && typeof record.name === 'string' && typeof record.provider === 'string'
      ? record as unknown as JournalHeader
      : undefined
  }
  if (record.t === 'call') {
    return Number.isSafeInteger(record.seq) && typeof record.prompt === 'string' && typeof record.childId === 'string'
      ? record as unknown as JournalCall
      : undefined
  }
  if (record.t === 'result') {
    return Number.isSafeInteger(record.seq) && Array.isArray(record.output) && typeof record.stopReason === 'string'
      ? record as unknown as JournalResult
      : undefined
  }
  return undefined
}
