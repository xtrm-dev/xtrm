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
  /** `windowId` is the stable tmux id (@N); `window` is the current index, for display. */
  | { kind: "window"; session: string; window: number | null; windowId?: string | null }
  /** `window` is where the pane was last seen; it is the fallback when the pane vanishes. */
  | { kind: "pane"; session: string; window: number | null; windowId?: string | null; paneId: string }

// ---------------------------------------------------------------------------
// URL: ?s=<session>[&w=<windowId>[&p=<paneId>]]
//   ?s=xx                    session scope
//   ?s=xx&w=%403             window scope (tmux window id @3, percent-encoded)
//   ?s=xx&w=%403&p=%2512     pane scope (pane id %12)
// Old URLs with an index (?s=xx&w=2) still parse; the first poll resolves and rewrites them.
// A pane scope without a window (?s=xx&p=%2512) is accepted; its fallback is the session.
// ---------------------------------------------------------------------------

const PANE_ID = /^%\d+$/

export function parseScope(search: string): Scope | null {
  const params = new URLSearchParams(search)
  const session = params.get("s")
  if (!session) return null
  const rawWindow = params.get("w")
  const windowId = rawWindow !== null && /^@\d+$/.test(rawWindow) ? rawWindow : null
  const window = rawWindow !== null && /^\d+$/.test(rawWindow) ? Number(rawWindow) : null
  const paneId = params.get("p")
  if (paneId !== null && PANE_ID.test(paneId)) {
    return windowId
      ? { kind: "pane", session, window, windowId, paneId }
      : { kind: "pane", session, window, paneId }
  }
  if (window !== null || windowId !== null) {
    return windowId ? { kind: "window", session, window, windowId } : { kind: "window", session, window }
  }
  return { kind: "session", session }
}

export function serialiseScope(scope: Scope): string {
  const params = new URLSearchParams()
  params.set("s", scope.session)
  if (scope.kind === "window") {
    if (scope.windowId) params.set("w", scope.windowId)
    else if (scope.window !== null) params.set("w", String(scope.window))
  }
  if (scope.kind === "pane") {
    if (scope.windowId) params.set("w", scope.windowId)
    else if (scope.window !== null) params.set("w", String(scope.window))
    params.set("p", scope.paneId)
  }
  return `?${params.toString()}`
}

/**
 * Same target. A pane is identified by its id alone: `window` is only where it was last seen
 * (the fallback), so opening ?s=xx&p=%12 and then clicking pane %12 is not a new selection.
 */
export function sameScope(a: Scope | null, b: Scope | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind || a.session !== b.session) return false
  if (a.kind === "window" && b.kind === "window") return (a.windowId ?? a.window) === (b.windowId ?? b.window)
  if (a.kind === "pane" && b.kind === "pane") return a.paneId === b.paneId
  return true
}

/** Same target and same URL: when false, the state (and the address bar) should take the new object. */
export function identicalScope(a: Scope | null, b: Scope | null): boolean {
  if (a === b) return true
  return !!a && !!b && serialiseScope(a) === serialiseScope(b)
}

/** Same target and same current placement: the object a poll should keep. */
export function sameScopeState(a: Scope | null, b: Scope | null): boolean {
  if (a === b) return true
  if (!sameScope(a, b) || !a || !b) return false
  if (a.kind === "session") return true
  return a.window === (b as typeof a).window
}

/** The sidebar row key of a scope; matches the keys `buildTree` assigns. */
export function scopeRowKey(scope: Scope): string {
  if (scope.kind === "session") return `s:${scope.session}`
  if (scope.kind === "window") return `w:${scope.session}:${scope.windowId ?? scope.window}`
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
  if (scope.kind === "window") {
    if (scope.windowId) return inOrder(live.filter((agent) => agent.windowId === scope.windowId))
    return inOrder(live.filter((agent) => agent.windowIndex === scope.window))
  }
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
    const found = agentsInScope(sessions, scope)
    if (found.length) {
      // The pane's own window is the truth; a URL may carry a stale index, and tmux may renumber.
      if (scope.kind === "session") return scope
      const agent = found[0]
      if (scope.window === agent.windowIndex && scope.windowId === agent.windowId) return scope
      return { ...scope, window: agent.windowIndex, windowId: agent.windowId }
    }
    if (scope.kind === "pane") {
      scope =
        scope.windowId !== null && scope.windowId !== undefined
          ? { kind: "window", session: scope.session, window: null, windowId: scope.windowId }
          : scope.window !== null
            ? { kind: "window", session: scope.session, window: scope.window, windowId: null }
            : { kind: "session", session: scope.session }
    } else if (scope.kind === "window") {
      scope = { kind: "session", session: scope.session }
    } else {
      scope = null
    }
  }
  return defaultScope(sessions, preferred)
}

/** True when discovery found at least one agent: an empty or failed poll proves nothing about a scope. */
export function hasAgents(sessions: ViewerSession[]): boolean {
  return sessions.some((session) => session.agents.length > 0)
}

/** Polls a scope's target may be absent before the scope degrades along the fallback chain. */
export const SCOPE_GRACE = 3

export interface ScopeTrack {
  scope: Scope | null
  /** Consecutive polls in which the scope's target was absent. */
  absent: number
}

/**
 * Advance the scope by one poll.
 * - A poll with no agents at all (an empty or failed discovery) changes nothing, and does not
 *   count as absence: the last good scope is kept.
 * - A scope whose target is present is kept (a stale window in a pane scope is corrected).
 * - A scope whose target is absent is kept for SCOPE_GRACE - 1 polls, so one poll that drops a
 *   pane or window cannot downgrade it; if the target is back by then, nothing happened.
 *   On the third consecutive absent poll it degrades along the fallback chain.
 * - `requested` (the scope in the URL the page opened with) is read only while there is no scope.
 *   With no last good scope to hold, an unresolvable request falls back at once.
 */
export function trackScope(
  track: ScopeTrack,
  sessions: ViewerSession[],
  requested: Scope | null,
  preferred = "xx",
  grace = SCOPE_GRACE,
): ScopeTrack {
  if (!hasAgents(sessions)) return track
  const want = track.scope ?? requested
  if (!want) return { scope: defaultScope(sessions, preferred), absent: 0 }
  if (agentsInScope(sessions, want).length) {
    const resolved = resolveScope(want, sessions, preferred)
    return { scope: track.scope && sameScopeState(resolved, track.scope) ? track.scope : resolved, absent: 0 }
  }
  const absent = track.absent + 1
  if (track.scope && absent < grace) return { scope: track.scope, absent }
  return { scope: resolveScope(want, sessions, preferred), absent: 0 }
}

/**
 * The scope for an address bar that changed under us (Back, Forward, a pasted URL): the URL's
 * scope resolved against what exists now, else the current one. Empty discovery keeps the current scope.
 */
export function scopeFromUrl(search: string, current: Scope | null, sessions: ViewerSession[], preferred = "xx"): Scope | null {
  if (!hasAgents(sessions)) return current
  return resolveScope(parseScope(search) ?? current, sessions, preferred)
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
    const index = scope.window ?? agents[0]?.windowIndex ?? null
    const name = agents[0]?.windowName || `window ${index ?? "?"}`
    return { kind: "window", title: name, detail: `${scope.session} · window ${index ?? "?"} · ${count}`, role: null }
  }
  const agent = agents[0]
  const place = agent ? `${scope.session} · ${agent.windowName || `window ${agent.windowIndex}`}` : scope.session
  return { kind: "pane", title: agent?.name ?? scope.paneId, detail: place, role: agent?.role ?? null }
}
