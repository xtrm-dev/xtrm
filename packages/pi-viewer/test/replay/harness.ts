/**
 * Replay harness for the turn state model (XTRM-1043).
 *
 * A transcript is written to disk one record at a time, the way an agent writes it. After
 * each record the harness reads it the two ways the viewer can: incrementally (the same
 * file, appended, cached between reads) and fresh (a new parse of the same bytes, as after a
 * viewer restart). For each prefix it builds the agent status and the Channel split
 * (timeline and presence) the browser would show, and checks:
 *
 * - fresh == incremental: status, last write time, presence and stopped rows are identical;
 * - no flicker: a stopped row never disappears unless the new record is an operator prompt;
 * - sync: a pending (open) turn exists only while the status is live (working, attention, quiet).
 */
import { appendFileSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { claudeStatusOf, dropClaudeCache, normalizeClaudeEvent, parseClaudeFile } from "../../server/claude.ts"
import {
  dropFileCache,
  entryEffect,
  lastWriteAt,
  normalizeEvent,
  parseSessionFile,
  statusOf,
  type AgentState,
  type ParsedFile,
} from "../../server/session.ts"
import { splitPresence } from "../../src/lib/presence.ts"
import { channelEvent, channelTimeline, channelTurns } from "../../src/lib/thread.ts"
import type { ViewerAgent, ViewerEvent } from "../../src/shared/types.ts"

export type Provider = "pi" | "claude"

type Raw = Record<string, unknown>

export interface View {
  status: AgentState
  lastWriteAt: number
  /** `agent:status:turn id` per presence entry. */
  presence: string[]
  /** `id|note|local` per stopped row. */
  stopped: string[]
  /** Ids of open turns in the grouped events. */
  pending: string[]
}

export interface Snapshot extends View {
  /** 1-based record number in the fixture. */
  index: number
  /** Line of the record in the source transcript (`_src`), when the fixture carries it. */
  src: number | null
  /** One line describing the record, for failure messages. */
  record: string
}

export interface ReplayResult {
  snapshots: Snapshot[]
  violations: string[]
}

const reader = {
  pi: { parse: parseSessionFile, status: statusOf, normalize: normalizeEvent, drop: dropFileCache },
  claude: { parse: parseClaudeFile, status: claudeStatusOf, normalize: normalizeClaudeEvent, drop: dropClaudeCache },
}

function timeOf(record: Raw): number {
  const raw = record.timestamp
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function describe(record: Raw): string {
  const message = (record.message ?? {}) as Raw
  const content = message.content
  const head =
    typeof content === "string"
      ? content.slice(0, 40)
      : Array.isArray(content)
        ? content.map((block) => (block as Raw)?.type).join(",")
        : ""
  const reason = message.stopReason ?? message.stop_reason
  return [record.type, record.subtype, record.customType, message.role, reason, head && JSON.stringify(head)].filter(Boolean).join(" ")
}

function agentOf(provider: Provider, parsed: ParsedFile, status: AgentState): ViewerAgent {
  return {
    id: "%1",
    paneId: "%1",
    panePid: 1,
    provider,
    piPid: 1,
    tmuxSession: "replay",
    windowIndex: 0,
    windowId: "@1",
    windowName: "replay",
    paneIndex: 0,
    name: "replay",
    role: null,
    title: "replay",
    cwd: "/replay",
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt: parsed.modifiedAt,
    lastWriteAt: lastWriteAt(parsed),
    eventCount: parsed.events.length,
    status: status.status,
    statusNote: status.note,
    statusDetail: status.detail ?? null,
  }
}

/** Normalized events by entry object and revision; an entry Claude mutates in place gets a new revision. */
class EventCache {
  private byEntry = new WeakMap<Raw, { version: number; onBranch: boolean; seq: number; event: ViewerEvent }>()

  events(provider: Provider, parsed: ParsedFile, agent: ViewerAgent): ViewerEvent[] {
    const normalize = reader[provider].normalize
    return parsed.events.map((entry, seq) => {
      const id = typeof entry.id === "string" ? entry.id : null
      const onBranch = id === null || parsed.branchIds.has(id)
      const version = parsed.entryVersions?.[seq] ?? 0
      const cached = this.byEntry.get(entry)
      if (cached && cached.version === version && cached.onBranch === onBranch && cached.seq === seq) return cached.event
      const event = normalize(entry, { id: agent.id, name: agent.name }, seq, onBranch, { raw: false })
      this.byEntry.set(entry, { version, onBranch, seq, event })
      return event
    })
  }
}

function viewOf(provider: Provider, parsed: ParsedFile, now: number, cache: EventCache): View {
  const status = reader[provider].status(parsed, now)
  const agent = agentOf(provider, parsed, status)
  const events = cache.events(provider, parsed, agent).filter(channelEvent)
  const { timeline, presence } = splitPresence(channelTimeline(events), [agent])
  return {
    status,
    lastWriteAt: agent.lastWriteAt,
    presence: presence.map((entry) => `${entry.agentId}:${entry.status}:${entry.turn?.id ?? "-"}`),
    stopped: timeline.flatMap((item) => (item.kind === "stopped" ? [`${item.id}|${item.note}|${item.local}`] : [])),
    pending: channelTurns(events)
      .filter((turn) => turn.pending)
      .map((turn) => turn.id),
  }
}

const LIVE = new Set(["working", "attention", "quiet"])

/** True when one of the new entries is an operator prompt (a user message that opens a turn). */
function hasPrompt(entries: Raw[]): boolean {
  return entries.some(
    (entry) => entryEffect(entry) === "open" && entry.type === "message" && (entry.message as Raw | undefined)?.role === "user",
  )
}

/**
 * Replays `fixture` record by record. `scratch` holds the two working copies. The clock of
 * each prefix is its newest record time plus one second, and the file time is set to the
 * newest record time, as if the agent had just written it.
 */
export function replay(
  fixture: string,
  provider: Provider,
  scratch: string,
  tag = "replay",
  /** Compare with a fresh parse every N records (and at the last); 1 checks every prefix. */
  freshEvery = 1,
): ReplayResult {
  const lines = readFileSync(fixture, "utf8").split("\n").filter((line) => line.trim())
  const incremental = join(scratch, `${tag}-incremental.jsonl`)
  const fresh = join(scratch, `${tag}-fresh.jsonl`)
  const { parse, drop } = reader[provider]
  drop(incremental)
  writeFileSync(incremental, "")
  const incCache = new EventCache()

  const snapshots: Snapshot[] = []
  const violations: string[] = []
  let newest = 0
  let previous: Snapshot | null = null
  let seen = 0

  for (let index = 0; index < lines.length; index += 1) {
    const record = JSON.parse(lines[index]) as Raw
    newest = Math.max(newest, timeOf(record))
    const seconds = newest / 1000
    appendFileSync(incremental, `${lines[index]}\n`)
    utimesSync(incremental, seconds, seconds)
    const checkFresh = (index + 1) % freshEvery === 0 || index === lines.length - 1

    const now = newest + 1_000
    const incParsed = parse(incremental)
    const view = viewOf(provider, incParsed, now, incCache)
    const snapshot: Snapshot = {
      ...view,
      index: index + 1,
      src: typeof record._src === "number" ? record._src : null,
      record: describe(record),
    }
    snapshots.push(snapshot)
    const where = `record ${snapshot.index}${snapshot.src ? ` (source line ${snapshot.src})` : ""} [${snapshot.record}]`

    if (checkFresh) {
      drop(fresh)
      writeFileSync(fresh, `${lines.slice(0, index + 1).join("\n")}\n`)
      utimesSync(fresh, seconds, seconds)
      const freshView = viewOf(provider, parse(fresh), now, new EventCache())
      if (JSON.stringify(freshView) !== JSON.stringify(view)) {
        violations.push(`fresh != incremental at ${where}: ${JSON.stringify(freshView)} vs ${JSON.stringify(view)}`)
      }
    }
    if (view.pending.length && !LIVE.has(view.status.status)) {
      violations.push(`open turn ${view.pending.join(",")} while ${view.status.status} (${view.status.note}) at ${where}`)
    }
    const added = incParsed.events.slice(seen)
    seen = incParsed.events.length
    if (previous && !hasPrompt(added)) {
      const ids = new Set(view.stopped.map((row) => row.split("|")[0]))
      for (const row of previous.stopped) {
        if (!ids.has(row.split("|")[0])) violations.push(`stopped row ${row} vanished at ${where}`)
      }
    }
    previous = snapshot
  }
  return { snapshots, violations }
}

/** Status transitions only, one line each: `index src status note presence stopped <- record`. */
export function transitions(result: ReplayResult): string[] {
  const out: string[] = []
  let last = ""
  for (const snapshot of result.snapshots) {
    const key = `${snapshot.status.status}|${snapshot.status.note}|P${snapshot.presence.length}|S${snapshot.stopped.length}`
    if (key === last) continue
    last = key
    out.push(`${snapshot.index}\t${snapshot.src ?? "-"}\t${key}\t<- ${snapshot.record}`)
  }
  return out
}
