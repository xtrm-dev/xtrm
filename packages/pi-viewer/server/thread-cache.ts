import type { ThreadPayload, ViewerAgent, ViewerEvent } from "../src/shared/types.ts"
import { channelEvent, channelTurns } from "../src/lib/thread.ts"
import { applyIntercomResults } from "./intercom.ts"
import { normalizeClaudeEvent, parseClaudeFile } from "./claude.ts"
import { normalizeEvent, parseSessionFile, type NormalizeOptions } from "./session.ts"

/**
 * Poll costs stay proportional to what actually changed:
 *
 * - an agent transcript is normalized once and then updated entry-by-entry
 *   (Claude's in-place entry mutation is tracked by entry revision);
 * - the session keeps one sorted event list and a monotonic cursor per event,
 *   so a poll returns `cursor > since` and nothing else;
 * - the first response is a window of the newest turns, not the whole file.
 *
 * `revision` identifies this cached session generation. A client that sees a
 * different revision (server restart, file shrink, agent set change) reloads
 * the window instead of merging across a broken cursor space.
 */

const DEFAULT_TURNS = 150
const MAX_TURNS = 300
const OPTIONS: NormalizeOptions = { raw: false }

interface AgentEntry {
  key: string
  events: ViewerEvent[]
  versions: number[]
  branchIds: Set<string>
}

interface CachedEvent {
  event: ViewerEvent
  cursor: number
}

interface SessionCache {
  revision: string
  events: Map<string, CachedEvent>
  sorted: ViewerEvent[]
  counter: number
  dirty: boolean
  agents: Map<string, AgentEntry>
  /** Scope views, rebuilt only when the cache counter moves. */
  views: Map<string, ScopeView>
}

/**
 * The events one (scope, agent set) pair shows, plus the windows already cut from them.
 * A view is valid for one cache counter: any change to the session list moves the counter.
 */
interface ScopeView {
  counter: number
  /** The session revision the view was cut from. */
  base: string
  /** The revision a client sees: the base, extended by the scope's agent-set tag. */
  revision: string
  sorted: ViewerEvent[]
  filtered: ViewerEvent[]
  pages: Map<string, ThreadPayload>
}

const VIEWS_MAX = 12
const PAGES_MAX = 8

const agentCache = new Map<string, AgentEntry>()
const sessionCache = new Map<string, SessionCache>()
let revisionSeq = 0

/**
 * Read one agent's transcript, or say so and carry nothing (XTRM-1109, PR #512 review). A file that was
 * deleted, rotated or locked between discovery and this read used to throw out of the route and turn
 * every viewer request into a 500; now that agent's turn contributes no new events and the rest of the
 * thread still renders. The next poll picks the file up again if it comes back.
 */
function readTranscript<T extends { events: unknown[] }>(
  file: string,
  parse: (path: string) => T,
  agent: ViewerAgent,
): T {
  try {
    return parse(file)
  } catch (error) {
    console.warn(
      `[pi-viewer] transcript unreadable, thread left as it was: ${agent.name} ${file}`,
      error instanceof Error ? error.message : error,
    )
    // An empty transcript is the honest degrade: no new events, no throw, no 500 for the reader.
    return { events: [] } as unknown as T
  }
}

function agentKey(agent: ViewerAgent): string {
  return [
    agent.id,
    agent.name,
    agent.provider ?? "",
    agent.sessionFile ?? "",
    agent.modifiedAt,
    agent.eventCount,
  ].join("|")
}

function updateAgent(agent: ViewerAgent): { entry: AgentEntry; changed: Set<string>; reset: boolean } {
  const key = agentKey(agent)
  const previous = agentCache.get(agent.id)
  if (previous && previous.key === key) {
    return { entry: previous, changed: new Set(), reset: false }
  }

  const reset = Boolean(previous && previous.events.length > (agent.eventCount || 0))
  const changed = new Set<string>()
  const versions: number[] = []
  const events: ViewerEvent[] = []
  const previousById = new Map(previous?.events.map((event) => [event.id, event]) ?? [])
  const base = { id: agent.id, name: agent.name }

  if (agent.sessionFile) {
    if (agent.provider === "claude") {
      const parsed = readTranscript(agent.sessionFile, parseClaudeFile, agent)
      const entryVersions = parsed.entryVersions ?? []
      parsed.events.forEach((raw, index) => {
        const version = entryVersions[index] ?? 0
        versions.push(version)
        const id = rawId(raw)
        const onBranch = id ? parsed.branchIds.has(id) : true
        const old = previousById.get(`${agent.id}:${index}`)
        const changedEntry =
          !old || onBranch !== old.onBranch || (previous?.versions[index] ?? -1) !== version
        if (changedEntry) {
          events.push(normalizeClaudeEvent(raw, base, index, onBranch, OPTIONS))
          changed.add(events[events.length - 1].id)
        } else {
          events.push(old)
        }
      })
    } else {
      const parsed = readTranscript(agent.sessionFile, parseSessionFile, agent)
      parsed.events.forEach((raw, index) => {
        versions.push(0)
        const id = rawId(raw)
        const onBranch = id ? parsed.branchIds.has(id) : true
        const old = previousById.get(`${agent.id}:${index}`)
        if (!old || onBranch !== old.onBranch) {
          events.push(normalizeEvent(raw, base, index, onBranch, OPTIONS))
          changed.add(events[events.length - 1].id)
        } else {
          events.push(old)
        }
      })
    }
  }

  let applied = events
  if (changed.size) {
    applied = applyIntercomResults(events)
    for (const event of applied) {
      if (!event.intercom) continue
      const old = previousById.get(event.id)
      if (!old || JSON.stringify(old.intercom) !== JSON.stringify(event.intercom)) changed.add(event.id)
    }
  }

  const entry: AgentEntry = {
    key,
    events: applied,
    versions,
    branchIds: new Set(),
  }
  agentCache.set(agent.id, entry)
  return { entry, changed, reset }
}

function rawId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null
  const id = (raw as { id?: unknown }).id
  return typeof id === "string" ? id : null
}

function sessionOf(name: string): SessionCache {
  let cache = sessionCache.get(name)
  if (!cache) {
    cache = {
      revision: `${name}:${Date.now().toString(36)}:${++revisionSeq}`,
      events: new Map(),
      sorted: [],
      counter: 0,
      dirty: false,
      agents: new Map(),
      views: new Map(),
    }
    sessionCache.set(name, cache)
  }
  return cache
}

function rebuild(cache: SessionCache, agents: ViewerAgent[]) {
  const reset = agents.some((agent) => {
    const cached = agentCache.get(agent.id)
    return cached && cached.events.length > 0 && !cache.agents.has(agent.id)
  })
  if (reset || cache.agents.size && [...cache.agents.keys()].some((id) => !agents.some((a) => a.id === id))) {
    cache.events.clear()
    cache.counter = 0
    cache.dirty = true
    cache.agents.clear()
    cache.revision = `${cache.revision.split(":")[0]}:${Date.now().toString(36)}:${++revisionSeq}`
  }

  for (const agent of agents) {
    const { entry, changed, reset: agentReset } = updateAgent(agent)
    cache.agents.set(agent.id, entry)
    if (agentReset) {
      for (const id of [...cache.events.keys()]) {
        if (id.startsWith(`${agent.id}:`)) cache.events.delete(id)
      }
      cache.revision = `${cache.revision.split(":")[0]}:${Date.now().toString(36)}:${++revisionSeq}`
    }
    for (const event of entry.events) {
      const known = cache.events.get(event.id)
      if (known && !changed.has(event.id)) {
        known.event = event
        continue
      }
      cache.events.set(event.id, { event, cursor: ++cache.counter })
      cache.dirty = true
    }
  }
}

function sortedEvents(cache: SessionCache): ViewerEvent[] {
  if (!cache.dirty) return cache.sorted
  cache.sorted = [...cache.events.values()]
    .map((item) => item.event)
    .sort((a, b) => a.at - b.at || a.agentId.localeCompare(b.agentId) || a.seq - b.seq)
  cache.dirty = false
  return cache.sorted
}

function cursorOf(cache: SessionCache, event: ViewerEvent): number {
  return cache.events.get(event.id)?.cursor ?? 0
}

function includeTurn(set: Set<string>, turn: ReturnType<typeof channelTurns>[number]) {
  for (const event of turn.users) set.add(event.id)
  for (const event of turn.inbound) set.add(event.id)
  for (const event of turn.sent) set.add(event.id)
  if (turn.final) set.add(turn.final.id)
  for (const item of turn.activity) {
    if (item.event) set.add(item.event.id)
    if (item.call) set.add(item.call.id)
    if (item.result) set.add(item.result.id)
  }
}

function page(
  cache: SessionCache,
  view: ScopeView,
  serverId: string,
  scope: "branch" | "all",
  limit: number,
  before: number | null,
): ThreadPayload {
  const memoKey = `${limit}|${before ?? ""}`
  const memo = view.pages.get(memoKey)
  if (memo) return memo

  const filtered = view.filtered
  const boundary = before == null ? filtered.length : indexOfCursor(cache, filtered, before)
  const universe = before == null ? filtered : filtered.slice(0, boundary)
  const turns = channelTurns(universe)
  const start = Math.max(0, turns.length - limit)
  const chosen = turns.slice(start)
  const ids = new Set<string>()
  for (const turn of chosen) includeTurn(ids, turn)

  let events = filtered.filter((event) => ids.has(event.id))
  if (scope === "all" && events.length) {
    const cursors = events.map((event) => cursorOf(cache, event))
    const low = Math.min(...cursors)
    const high = Math.max(...cursors)
    const meta = filtered.filter((event) => {
      if (event.kind !== "meta") return false
      const cursor = cursorOf(cache, event)
      return cursor >= low && cursor <= high
    })
    const byId = new Map(events.map((event) => [event.id, event]))
    for (const event of meta) byId.set(event.id, event)
    events = [...byId.values()]
  }
  if (!events.length) {
    events = filtered.slice(-Math.max(1, limit))
  }
  events.sort((a, b) => a.at - b.at || a.agentId.localeCompare(b.agentId) || a.seq - b.seq)

  const first = events[0]
  const earlier = first ? cursorOf(cache, first) : null
  const earlierTurns = Math.max(0, start)
  const result: ThreadPayload = {
    session: cache.revision.split(":")[0],
    serverId,
    version: "",
    agents: [],
    capturedAt: Date.now(),
    events,
    cursor: cache.counter,
    revision: view.revision,
    hasEarlier: earlierTurns > 0 || (before != null && boundary > 0 && start > 0),
    earlier,
    earlierTurns,
  }
  if (view.pages.size >= PAGES_MAX) {
    const oldest = view.pages.keys().next().value
    if (oldest !== undefined) view.pages.delete(oldest)
  }
  view.pages.set(memoKey, result)
  return result
}

function indexOfCursor(cache: SessionCache, events: ViewerEvent[], cursor: number): number {
  const index = events.findIndex((event) => cursorOf(cache, event) === cursor)
  return index >= 0 ? index : events.length
}

export interface ThreadQuery {
  scope: "branch" | "all"
  limit?: number
  before?: number | null
  since?: number | null
  revision?: string | null
  /**
   * The agents the pane or window scope shows. Omitted (or null) means the whole session.
   * An empty list is a scope that currently matches no agent: an empty thread, not the session's.
   */
  agentIds?: readonly string[] | null
}

/** Short stable tag of an agent set; part of the revision so a changed set reloads the window. */
function agentSetTag(ids: readonly string[]): string {
  let hash = 0x811c9dc5
  for (const char of ids.join(",")) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * The view of one (display scope, agent set): the session's sorted events filtered once per
 * counter. Both the channel filter and the agent filter run here and nowhere else.
 */
function viewOf(cache: SessionCache, scope: "branch" | "all", agentIds: readonly string[] | null): ScopeView {
  const sorted = sortedEvents(cache)
  const ids = agentIds ? [...agentIds].sort() : null
  const tag = ids ? agentSetTag(ids) : ""
  const key = `${scope}|${tag}`
  const known = cache.views.get(key)
  if (known && known.counter === cache.counter && known.base === cache.revision && known.sorted === sorted) {
    cache.views.delete(key)
    cache.views.set(key, known)
    return known
  }
  const inScope = ids ? new Set(ids) : null
  const filtered = sorted.filter(
    (event) => (scope === "all" || channelEvent(event)) && (!inScope || inScope.has(event.agentId)),
  )
  const view: ScopeView = {
    counter: cache.counter,
    base: cache.revision,
    revision: tag ? `${cache.revision}~${tag}` : cache.revision,
    sorted,
    filtered,
    pages: new Map(),
  }
  cache.views.delete(key)
  cache.views.set(key, view)
  if (cache.views.size > VIEWS_MAX) {
    const oldest = cache.views.keys().next().value
    if (oldest !== undefined) cache.views.delete(oldest)
  }
  return view
}

export function cachedThread(
  session: { name: string; serverId: string; agents: ViewerAgent[]; version: string; capturedAt: number },
  query: ThreadQuery,
): ThreadPayload & { reset?: boolean; unchanged?: boolean } {
  const cache = sessionOf(session.name)
  rebuild(cache, session.agents)
  const limit = Math.min(MAX_TURNS, Math.max(1, query.limit ?? DEFAULT_TURNS))
  const view = viewOf(cache, query.scope, query.agentIds ?? null)
  const reset = query.revision != null && query.revision !== view.revision

  let result: ThreadPayload & { reset?: boolean; unchanged?: boolean }
  if (query.before != null || query.since == null || reset) {
    // The memoized page is shared between requests: copy before stamping per-request fields.
    result = { ...page(cache, view, session.serverId, query.scope, limit, query.before ?? null) }
    if (reset) result.reset = true
  } else {
    const since = query.since
    const fresh =
      since === cache.counter ? [] : view.filtered.filter((event) => cursorOf(cache, event) > since)
    result = {
      session: session.name,
      serverId: session.serverId,
      version: session.version,
      agents: session.agents,
      capturedAt: Date.now(),
      events: fresh,
      cursor: cache.counter,
      revision: view.revision,
      hasEarlier: false,
      earlier: null,
      earlierTurns: 0,
      unchanged: fresh.length === 0,
    }
    if (since > cache.counter) {
      result = { ...page(cache, view, session.serverId, query.scope, limit, null) }
      result.reset = true
    }
  }

  result.session = session.name
  result.version = session.version
  result.agents = session.agents
  result.capturedAt = Date.now()
  return result
}

/**
 * Drop everything the current discovery no longer contains (XTRM-1109, PR #512 review, Low).
 *
 * Both caches are keyed by a live thing: an agent id that exists while its pane exists, a session name
 * that exists while its tmux session does. Without this they only grew: every pane that ever appeared
 * kept its parsed events for the life of the process, which on a long-running server is every agent the
 * operator has opened and closed all day. Pruning on each discovery keeps the cache proportional to what
 * is actually on screen.
 */
/** Consecutive discoveries a key has been absent from, so one transient empty listing cannot drop it. */
const misses = new Map<string, number>()

function absent(key: string, drop: () => void): boolean {
  const seen = (misses.get(key) ?? 0) + 1
  if (seen < 2) {
    misses.set(key, seen)
    return false
  }
  misses.delete(key)
  drop()
  return true
}

export function pruneCaches(agentIds: Set<string>, sessionNames: Set<string>): number {
  let dropped = 0
  for (const id of agentCache.keys()) {
    if (agentIds.has(id)) {
      misses.delete(`a:${id}`)
      continue
    }
    if (absent(`a:${id}`, () => agentCache.delete(id))) dropped += 1
  }
  for (const name of sessionCache.keys()) {
    if (sessionNames.has(name)) {
      misses.delete(`s:${name}`)
      continue
    }
    // Two strikes: a pane that is momentarily missing from a listing must not reset the session's
    // revision, which would make the client re-page a thread and lose its scroll position.
    if (absent(`s:${name}`, () => sessionCache.delete(name))) dropped += 1
  }
  return dropped
}

/** Test hook: what the caches currently hold, so a prune test can assert membership, not a count. */
export function cachedKeys(): { agents: string[]; sessions: string[] } {
  return { agents: [...agentCache.keys()], sessions: [...sessionCache.keys()] }
}

/** Test/ops hook: forget a cached session so the next request rebuilds. */
export function invalidateThread(name: string) {
  sessionCache.delete(name)
}
