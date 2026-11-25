import type { TurnEffect } from "../shared/types.ts"

/**
 * The agent turn state model (XTRM-1043, docs/design/working-presence.md §8).
 *
 * One small state machine decides whether an agent's turn is open. The server status
 * (`statusOf`, Pi and Claude) and the browser's turn grouping (`groupAgent`, then
 * `splitPresence`) both fold the same per-record effects through `nextTurnState`, so the
 * status line and the thread cannot disagree about a turn.
 *
 * Each record has exactly one effect, decided once by the server when the record is parsed
 * (`entryEffect` in server/session.ts) and carried on the event as `effect`:
 *
 * | effect  | records                                                                  |
 * |---------|--------------------------------------------------------------------------|
 * | open    | operator prompt, prompt-type slash command, peer message received, a     |
 * |         | wake-up notice (Pi task/monitor/intercom/specialist message, Claude      |
 * |         | `<task-notification>`/`<monitor-event>`), a Pi skill prompt               |
 * | step    | assistant message with a tool call (or stop reason tool use), tool result |
 * | reply   | assistant message with no tool call (stop, end_turn, length)              |
 * | abort   | assistant aborted, Claude "[Request interrupted by user…]"                |
 * | fail    | assistant error                                                           |
 * | compact | compaction                                                                |
 * | none    | everything else: local commands the operator runs in the pane (`!ls`,     |
 * |         | `/model` with its output), bookkeeping, injected context, notices that do |
 * |         | not wake the agent, sidechain (subagent) records                          |
 *
 * Transitions (`none` never changes the state):
 *
 * - `open`: opens a turn, or joins the turn already open.
 * - `step`: the turn is open and has run a step (the agent loop is running). A step with no
 *   open turn opens one: the agent resumed by itself.
 * - `reply`: settled. `abort`: aborted. `fail`: failed.
 * - `compact`: inside a running loop (open with a step, or failed on a context overflow) the
 *   turn stays open ("compacting context"); anywhere else the conversation restarts and no
 *   turn is open (settled).
 *
 * Only record contents and record order drive the machine. No timer and no file time enters
 * it, so a fresh parse and an incremental parse of the same records give the same state.
 */

export type TurnPhase = "none" | "open" | "settled" | "aborted" | "failed"

export interface TurnState {
  phase: TurnPhase
  /** The open turn has run a step since it opened. */
  loop: boolean
  /** The newest decisive record is a compaction inside a running loop. */
  compacting: boolean
  /** The turn failed on a context overflow, which a compaction resumes. */
  overflow: boolean
}

export const INITIAL_TURN_STATE: TurnState = { phase: "none", loop: false, compacting: false, overflow: false }

const SETTLED: TurnState = { phase: "settled", loop: false, compacting: false, overflow: false }

/** Error text of a context overflow. Rate limits and quotas ("exceeded") are not overflows. */
const OVERFLOW =
  /prompt is too long|input is too long|context[ _-]?(?:length|window)|maximum context|too many tokens|context overflow/i

export function isContextOverflow(errorMessage: string | undefined): boolean {
  return typeof errorMessage === "string" && OVERFLOW.test(errorMessage)
}

export function nextTurnState(state: TurnState, effect: TurnEffect, overflow = false): TurnState {
  switch (effect) {
    case "none":
      return state
    case "open":
      return state.phase === "open"
        ? { ...state, compacting: false }
        : { phase: "open", loop: false, compacting: false, overflow: false }
    case "step":
      return { phase: "open", loop: true, compacting: false, overflow: false }
    case "reply":
      return SETTLED
    case "abort":
      return { phase: "aborted", loop: false, compacting: false, overflow: false }
    case "fail":
      return { phase: "failed", loop: false, compacting: false, overflow }
    case "compact":
      if ((state.phase === "open" && state.loop) || (state.phase === "failed" && state.overflow)) {
        return { phase: "open", loop: true, compacting: true, overflow: false }
      }
      return SETTLED
  }
}

/** Effects whose result depends on the state before them. */
function needsPrior(effect: TurnEffect): boolean {
  return effect === "open" || effect === "compact"
}

/**
 * The state after `records[0..end)`, read from the end: the newest decisive records back to
 * the first one whose result does not depend on what came before, then folded forward. It
 * equals folding every record from the start, and costs only the trailing records.
 */
export function resolveTurnState<T>(
  records: readonly T[],
  effectOf: (record: T) => TurnEffect,
  overflowOf: (record: T) => boolean,
  end = records.length,
): { state: TurnState; last: T | null } {
  const chain: T[] = []
  for (let index = end - 1; index >= 0; index -= 1) {
    const record = records[index]
    const effect = effectOf(record)
    if (effect === "none") continue
    chain.push(record)
    if (!needsPrior(effect)) break
  }
  let state = INITIAL_TURN_STATE
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const record = chain[index]
    state = nextTurnState(state, effectOf(record), overflowOf(record))
  }
  return { state, last: chain[0] ?? null }
}
