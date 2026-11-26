// Stop one agent's pane by sending a single Escape (XTRM-1088, operator ruling 2026-11-26).
//
// The mapping lives here, away from the HTTP handler, so a unit test can hold it without a server or a
// tmux: what the route may send, and to which pane, is a pure decision. Both runtimes abort the running
// turn on Escape, so one key is enough and no prompt text is involved.
const PANE_ID = /^%\d+$/

/** Escape is the only key a stop may send: a literal payload would type, Enter would submit. */
export const STOP_KEY = "Escape"

export interface StopCandidate {
  paneId: string
}

export type StopPlan =
  | { ok: true; paneId: string; argv: string[] }
  | { ok: false; code: 400 | 404; reason: string }

/**
 * Plan a stop for one pane: the id must be a tmux pane id, and the pane must belong to an agent the
 * viewer discovered right now. An unknown pane is refused rather than sent to whatever tmux resolves.
 */
export function stopPlan(agents: readonly StopCandidate[], paneId: string): StopPlan {
  const id = paneId.trim()
  if (!PANE_ID.test(id)) return { ok: false, code: 400, reason: "invalid pane id" }
  if (!agents.some((agent) => agent.paneId === id)) {
    return { ok: false, code: 404, reason: "pane is not a pi or claude agent in an open tmux session" }
  }
  return { ok: true, paneId: id, argv: ["send-keys", "-t", id, STOP_KEY] }
}
