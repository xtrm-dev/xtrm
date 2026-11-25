import type { AgentStatus, ViewerAgent } from "@/shared/types"

// Relative with the extension: the node test runner loads this module without the @ alias.
import { compareChannelItems, type ChannelItem, type Turn } from "./thread.ts"

/**
 * Working presence (XTRM-1035, design: docs/design/working-presence.md §3–§4).
 *
 * The thread shows settled work only. A running turn leaves the timeline and is shown by the
 * presence line above the composer, so a turn that starts moves nothing and a turn that settles
 * is appended at its settling time. `channelTimeline` and its ordering are unchanged; this
 * module splits its output.
 */

/** A pending turn whose agent stopped without a reply: a settled-looking row at `Turn.end`. */
export interface StoppedItem {
  kind: "stopped"
  id: string
  at: number
  agentId: string
  agentName: string
  seq: number
  turn: Turn
  /** Why the turn stopped, from the agent status note (`turn interrupted`, `agent gone`). */
  note: string
  /** The turn holds only work the operator ran in the pane (`!ls`), not an agent turn. */
  local: boolean
}

export type TimelineItem = ChannelItem | StoppedItem

export type PresenceStatus = "working" | "attention" | "quiet"

export interface PresenceEntry {
  agentId: string
  agent: ViewerAgent
  /** Short display name (§3.8); the full name stays on `agent.name`. */
  name: string
  status: PresenceStatus
  note: string | null
  /** The pending request behind `attention`, read-only text. */
  detail: string | null
  /** The open turn in the loaded events, if any. */
  turn: Turn | null
  /** Start of the open turn (ms), or null when it is not in the loaded events. */
  start: number | null
}

/** Agent states that put an agent in presence. */
const PRESENT: ReadonlySet<AgentStatus> = new Set<AgentStatus>(["working", "attention", "quiet"])

/** States in which a pending turn is live. */
const LIVE: ReadonlySet<AgentStatus> = new Set<AgentStatus>(["working", "attention", "quiet"])

/**
 * A `waiting` agent with a pending turn is one of two things:
 * - its reply is written but the thread payload does not carry it yet (the status poll ran
 *   first): the agent wrote after the turn's last event, so the turn stays in presence for that
 *   poll instead of flashing a stopped row;
 * - the operator ran a local command (`!ls`, `/model`) after the last reply: the agent's last
 *   write is the turn's own last event, and no agent turn runs.
 */
const REPLY_IN_FLIGHT_MS = 2_000

/**
 * A turn opened only by local slash commands (`/model`, `/compact`), not a prompt starting
 * with `/help me`. The parser marks real commands; a prompt is never guessed from its text.
 */
function isSlashOnly(turn: Turn): boolean {
  return turn.users.length > 0 && turn.users.every((user) => user.slash === true)
}

function replyInFlight(agent: ViewerAgent, turn: Turn): boolean {
  // Meta writes (model, thinking level) move the file but do not write the turn. The status
  // poll compares the last turn write, so a `!cmd` followed by a model change stays local.
  return agent.status === "waiting" && agent.lastWriteAt - turn.end > REPLY_IN_FLIGHT_MS
}

const LAUNCHER_PREFIX = /^[a-z0-9.]+-xt-(?:pi|claude|codex)-/

/** `xtrm-xt-claude-working-design` → `working-design`; other names unchanged (§3.8). */
export function shortName(name: string): string {
  const short = name.replace(LAUNCHER_PREFIX, "")
  return short || name
}

function presenceStatus(status: AgentStatus): PresenceStatus {
  return status === "attention" || status === "quiet" ? status : "working"
}

function asChannelItem(item: TimelineItem): ChannelItem {
  if (item.kind !== "stopped") return item
  // A stopped row sorts as a settled turn anchored at its own `at`.
  return { ...item, kind: "turn", turn: { ...item.turn, pending: false } }
}

export function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  return compareChannelItems(asChannelItem(a), asChannelItem(b))
}

function treeOrder(a: PresenceEntry, b: PresenceEntry): number {
  const attention = Number(b.status === "attention") - Number(a.status === "attention")
  return (
    attention ||
    a.agent.windowIndex - b.agent.windowIndex ||
    a.agent.paneIndex - b.agent.paneIndex ||
    (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0)
  )
}

/**
 * Splits a Channel timeline into the settled thread and the presence set.
 *
 * - A pending turn of a live agent (working, attention, quiet, or waiting while its reply is in
 *   flight) leaves the timeline and becomes that agent's presence entry.
 * - A pending turn of a waiting agent that holds only a local command (`!ls`, `/model`) is not
 *   an agent turn: a `!ls` stays as a `local` stopped row with its step, a `/model` adds no row.
 * - A pending turn of an agent that is idle, failed, unknown or gone stays in the timeline as a
 *   `stopped` row anchored at `Turn.end`, re-sorted with the timeline comparator.
 * - A present agent (working, attention, quiet) with no pending turn in the loaded events gets
 *   an entry with no turn ("Working…").
 * - Entries: attention first, then tree order (window, pane).
 *
 * `agents` is the scope's agent list, so presence follows the scope (session, window, pane).
 */
export function splitPresence(
  items: ChannelItem[],
  agents: ViewerAgent[],
): { timeline: TimelineItem[]; presence: PresenceEntry[] } {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const open = new Map<string, Turn>()
  const timeline: TimelineItem[] = []
  let resort = false

  for (const item of items) {
    if (item.kind !== "turn" || !item.turn.pending) {
      timeline.push(item)
      continue
    }
    const agent = byId.get(item.agentId)
    if (agent && (LIVE.has(agent.status) || replyInFlight(agent, item.turn))) {
      const known = open.get(agent.id)
      if (!known || known.start <= item.turn.start) open.set(agent.id, item.turn)
      continue
    }
    const turn = item.turn
    const local = agent?.status === "waiting"
    // A local command with no step (`/model`, `/compact`) is already shown by its operator row.
    if (!turn.activity.length && (local || isSlashOnly(turn))) continue
    timeline.push({
      kind: "stopped",
      id: `stopped:${turn.id}`,
      at: turn.end > 0 ? turn.end : turn.start,
      agentId: item.agentId,
      agentName: item.agentName,
      seq: item.seq,
      turn,
      note: local ? "ran in the pane" : agent ? (agent.statusNote ?? agent.status) : "agent gone",
      local,
    })
    resort = true
  }
  if (resort) timeline.sort(compareTimelineItems)

  const presence: PresenceEntry[] = []
  for (const agent of agents) {
    const turn = open.get(agent.id) ?? null
    if (!turn && !PRESENT.has(agent.status)) continue
    presence.push({
      agentId: agent.id,
      agent,
      name: shortName(agent.name),
      status: presenceStatus(agent.status),
      note: agent.statusNote,
      detail: agent.statusDetail ?? null,
      turn,
      start: turn && turn.start > 0 ? turn.start : null,
    })
  }
  presence.sort(treeOrder)
  return { timeline, presence }
}

/** The newest step of a running turn, `Read src/lib/thread.ts`, or null. */
export function currentStep(turn: Turn | null): string | null {
  const item = turn?.activity.at(-1)
  if (!item) return null
  return item.summary ? `${item.label} ${item.summary}` : item.label
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

export interface PresenceLineText {
  /** Desktop words after the marks (§3.2). Empty at N=0. */
  text: string
  /** Mobile words (§3.2, 390). */
  short: string
  /** The current step, N=1 only. */
  step: string | null
  /** The start whose elapsed time the line shows (N=1, and the longest at N=2), or null. */
  since: number | null
}

/** The collapsed line's words by count (§3.2). Pure; the elapsed time ticks in the view. */
export function presenceLine(entries: PresenceEntry[]): PresenceLineText {
  const n = entries.length
  if (!n) return { text: "", short: "", step: null, since: null }
  const asking = entries.filter((entry) => entry.status === "attention")
  if (asking.length) {
    const rest = n - asking.length
    const who = asking.length === 1 ? `${asking[0].name} needs you` : `${asking[0].name} and ${asking.length - 1} more need you`
    const others = rest ? ` · ${rest} ${rest === 1 ? "other" : "others"} working` : ""
    return {
      text: `${who}${others}`,
      short: `${asking[0].name} needs you${n > 1 ? ` · +${n - 1}` : ""}`,
      step: null,
      since: null,
    }
  }
  if (n === 1) {
    const [only] = entries
    const state = only.status === "quiet" ? "is quiet" : "is working"
    const step = only.status === "quiet" ? only.note : currentStep(only.turn)
    return {
      text: `${only.name} ${state}`,
      short: only.name,
      step,
      since: only.status === "quiet" ? null : only.start,
    }
  }
  const starts = entries.map((entry) => entry.start).filter((start): start is number => start !== null)
  return {
    text: n <= 3 ? `${list(entries.map((entry) => entry.name))} are working` : `${n} agents are working`,
    short: `${n} working`,
    step: null,
    since: n === 2 && starts.length ? Math.min(...starts) : null,
  }
}

/**
 * Words for the polite live region: only membership changes are announced (§3.9), never the
 * ticking time. Returns null when nothing should be announced.
 */
export function presenceAnnouncement(previous: PresenceEntry[], next: PresenceEntry[]): string | null {
  const before = new Map(previous.map((entry) => [entry.agentId, entry]))
  const after = new Map(next.map((entry) => [entry.agentId, entry]))
  const words: string[] = []
  for (const entry of next) {
    const old = before.get(entry.agentId)
    if (!old) words.push(entry.status === "attention" ? `${entry.name} needs you` : `${entry.name} started`)
    else if (entry.status === "attention" && old.status !== "attention") words.push(`${entry.name} needs you`)
  }
  for (const entry of previous) if (!after.has(entry.agentId)) words.push(`${entry.name} finished`)
  return words.length ? words.join(", ") : null
}
