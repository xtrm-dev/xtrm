import type { ViewerAgent, ViewerEvent, ViewerSession } from "@/shared/types"

/**
 * What the thread shows. The sidebar levels are real entities:
 * - session: the combined thread of every agent in a tmux session (the Channel)
 * - window:  only the agents of one window, on the same settle-time timeline
 * - pane:    one agent
 *
 * The scope is client state over the already-fetched session payload: it filters events and
 * agents, and never reaches the server. It lives in the URL, so a reload keeps it.
 */
export type Scope =
  | { kind: "session"; session: string }
  | { kind: "window"; session: string; window: number }
  /** `window` is where the pane was last seen; it is the fallback when the pane vanishes. */
  | { kind: "pane"; session: string; window: number | null; paneId: string }

// ---------------------------------------------------------------------------
// URL: ?s=<session>[&w=<windowIndex>[&p=<paneId>]]
//   ?s=xx                 session scope
//   ?s=xx&w=2             window scope
//   ?s=xx&w=2&p=%2512     pane scope (the pane id %12, percent-encoded)
// A pane scope without a window (?s=xx&p=%2512) is accepted; its fallback is the session.
// ---------------------------------------------------------------------------

const PANE_ID = /^%\d+$/

export function parseScope(search: string): Scope | null {
  const params = new URLSearchParams(search)
  const session = params.get("s")
  if (!session) return null
  const rawWindow = params.get("w")
  const window = rawWindow !== null && /^\d+$/.test(rawWindow) ? Number(rawWindow) : null
  const paneId = params.get("p")
  if (paneId !== null && PANE_ID.test(paneId)) return { kind: "pane", session, window, paneId }
  if (window !== null) return { kind: "window", session, window }
  return { kind: "session", session }
}

export function serialiseScope(scope: Scope): string {
  const params = new URLSearchParams()
  params.set("s", scope.session)
  if (scope.kind === "window") params.set("w", String(scope.window))
  if (scope.kind === "pane") {
    if (scope.window !== null) params.set("w", String(scope.window))
    params.set("p", scope.paneId)
  }
  return `?${params.toString()}`
}

export function sameScope(a: Scope | null, b: Scope | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind || a.session !== b.session) return false
  if (a.kind === "window" && b.kind === "window") return a.window === b.window
  if (a.kind === "pane" && b.kind === "pane") return a.paneId === b.paneId && a.window === b.window
  return true
}

/** The sidebar row key of a scope; matches the keys `buildTree` assigns. */
export function scopeRowKey(scope: Scope): string {
  if (scope.kind === "session") return `s:${scope.session}`
  if (scope.kind === "window") return `w:${scope.session}:${scope.window}`
  return `p:${scope.paneId}`
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function recency(a: ViewerAgent, b: ViewerAgent): number {
  return (
    b.modifiedAt - a.modifiedAt ||
    a.windowIndex - b.windowIndex ||
    a.paneIndex - b.paneIndex ||
    a.paneId.localeCompare(b.paneId)
  )
}

function inOrder(agents: ViewerAgent[]): ViewerAgent[] {
  return [...agents].sort(
    (a, b) => a.windowIndex - b.windowIndex || a.paneIndex - b.paneIndex || a.paneId.localeCompare(b.paneId),
  )
}

/** The agents a scope shows, in tree order (window index, then pane index). */
export function agentsInScope(sessions: ViewerSession[], scope: Scope | null): ViewerAgent[] {
  if (!scope) return []
  const session = sessions.find((entry) => entry.name === scope.session)
  if (!session) return []
  const live = session.agents.filter((agent) => agent.paneId)
  if (scope.kind === "session") return inOrder(live)
  if (scope.kind === "window") return inOrder(live.filter((agent) => agent.windowIndex === scope.window))
  return live.filter((agent) => agent.paneId === scope.paneId)
}

export function eventsInScope(events: ViewerEvent[], agents: ViewerAgent[]): ViewerEvent[] {
  const ids = new Set(agents.map((agent) => agent.id))
  return events.filter((event) => ids.has(event.agentId))
}

/** The scope a fresh page opens on: the preferred session if it has agents, else the first that has. */
export function defaultScope(sessions: ViewerSession[], preferred = "xx"): Scope | null {
  const pick =
    sessions.find((session) => session.name === preferred && session.agents.length) ??
    sessions.find((session) => session.agents.length)
  return pick ? { kind: "session", session: pick.name } : null
}

/**
 * Keep a scope across polls, and fall back when its target is gone: a vanished pane falls
 * back to its window, a vanished window to its session, a vanished session to the default.
 * A scope that still resolves comes back as the same object, so nothing reloads.
 */
export function resolveScope(current: Scope | null, sessions: ViewerSession[], preferred = "xx"): Scope | null {
  let scope: Scope | null = current
  while (scope) {
    if (agentsInScope(sessions, scope).length) return scope
    if (scope.kind === "pane") {
      scope = scope.window !== null ? { kind: "window", session: scope.session, window: scope.window } : { kind: "session", session: scope.session }
    } else if (scope.kind === "window") {
      scope = { kind: "session", session: scope.session }
    } else {
      scope = null
    }
  }
  return defaultScope(sessions, preferred)
}

/** The agent a composer addresses by default: the pane itself, else the most recently active in scope. */
export function defaultTarget(agents: ViewerAgent[], scope: Scope | null): ViewerAgent | null {
  if (!agents.length) return null
  if (scope?.kind === "pane") return agents[0]
  return [...agents].sort(recency)[0]
}

export interface ScopeLabel {
  kind: Scope["kind"]
  title: string
  /** Where the scope sits, plus how many agents it shows. */
  detail: string
  role: string | null
}

export function describeScope(scope: Scope | null, agents: ViewerAgent[]): ScopeLabel | null {
  if (!scope) return null
  const count = `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`
  if (scope.kind === "session") return { kind: "session", title: scope.session, detail: `session · ${count}`, role: null }
  if (scope.kind === "window") {
    const name = agents[0]?.windowName || `window ${scope.window}`
    return { kind: "window", title: name, detail: `${scope.session} · window ${scope.window} · ${count}`, role: null }
  }
  const agent = agents[0]
  const place = agent ? `${scope.session} · ${agent.windowName || `window ${agent.windowIndex}`}` : scope.session
  return { kind: "pane", title: agent?.name ?? scope.paneId, detail: place, role: agent?.role ?? null }
}
