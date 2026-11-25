import type { OptimisticMessage } from "@/lib/optimistic"
import type { ViewerEvent, ViewerPart } from "@/shared/types"

export type ActivityKind = "thinking" | "tool" | "bash" | "notice" | "compaction" | "meta" | "event"

export interface ActivityItem {
  key: string
  kind: ActivityKind
  label: string
  summary: string
  at: number
  isError: boolean
  call?: ViewerEvent
  result?: ViewerEvent
  event: ViewerEvent
  thought?: string
  partIndex?: number
  toolCallId?: string
}

export interface Turn {
  id: string
  agentId: string
  agentName: string
  /** Sequence of the event that opened the turn; a stable tie-breaker. */
  seq: number
  start: number
  end: number
  final?: ViewerEvent
  /** Operator prompts that opened or joined the turn; rendered as timeline rows. */
  users: ViewerEvent[]
  /** Peer messages that opened or were consumed during the turn. */
  inbound: ViewerEvent[]
  /** Peer messages sent after the turn's final reply (or while it ran). */
  sent: ViewerEvent[]
  /** A row that only carries outgoing peer messages, with no agent turn. */
  sentOnly?: boolean
  activity: ActivityItem[]
  pending: boolean
}

const VERBS: Record<string, string> = {
  read: "Read",
  write: "Wrote",
  edit: "Edited",
  bash: "Ran",
  grep: "Searched",
  glob: "Listed",
  find: "Listed",
  ls: "Listed",
  task: "Delegated",
  web_search: "Searched the web",
  web_fetch: "Fetched",
  fetch: "Fetched",
  todo_write: "Planned",
  todo_read: "Checked plan",
}

function verb(name: string | undefined): string {
  if (!name) return "Tool"
  return VERBS[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

function firstLine(value: string | undefined, limit = 180): string {
  const line = (value ?? "").replace(/\s+/g, " ").trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function newTurn(event: ViewerEvent): Turn {
  return {
    id: `${event.agentId}:${event.seq}`,
    agentId: event.agentId,
    agentName: event.agentName,
    seq: event.seq,
    start: event.at,
    end: event.at,
    users: [],
    inbound: [],
    sent: [],
    activity: [],
    pending: true,
  }
}

function addPart(turn: Turn, event: ViewerEvent, part: ViewerPart, index: number): void {
  if (part.type === "thinking") {
    turn.activity.push({
      key: `${event.id}:think:${index}`,
      kind: "thinking",
      label: "Thought",
      summary: firstLine(part.text, 120),
      at: event.at,
      isError: false,
      event,
      thought: part.text,
      partIndex: index,
    })
    return
  }
  if (part.type !== "tool-call") return
  turn.activity.push({
    key: `${event.id}:call:${part.toolCallId ?? index}`,
    kind: "tool",
    label: verb(part.toolName),
    summary: firstLine(part.summary, 140),
    at: event.at,
    isError: false,
    call: event,
    event,
    partIndex: index,
    toolCallId: part.toolCallId,
  })
}

function attachResult(turn: Turn, event: ViewerEvent): void {
  for (let index = turn.activity.length - 1; index >= 0; index -= 1) {
    const item = turn.activity[index]
    if (item.kind !== "tool" || item.result) continue
    // The item's own call id: an event can carry several parallel tool calls, and matching
    // against the event's first tool-call part paired a result with the wrong call.
    const callId = item.toolCallId
    if (callId && event.toolCallId && callId === event.toolCallId) {
      item.result = event
      item.isError = event.isError === true
      if (!item.summary && event.summary) {
        item.summary = firstLine(stripPrefix(event.summary, `${event.toolName ?? "tool"} · `), 140)
      }
      return
    }
  }
  turn.activity.push({
    key: `${event.id}:result`,
    kind: "tool",
    label: verb(event.toolName),
    summary: firstLine(stripPrefix(event.summary, `${event.toolName ?? "tool"} · `), 140),
    at: event.at,
    isError: event.isError === true,
    result: event,
    event,
  })
}

function groupAgent(events: ViewerEvent[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const event of events) {
    if (event.kind === "meta") continue

    if (event.kind === "intercom" && event.intercom) {
      const sent = event.intercom.direction === "sent"
      if (sent) {
        if (!current || current.final) {
          if (current) turns.push(current)
          current = newTurn(event)
          current.sentOnly = true
        }
        current.sent.push(event)
        current.pending = false
      } else {
        if (!current || current.final || current.sentOnly) {
          if (current) turns.push(current)
          current = newTurn(event)
        }
        current.inbound.push(event)
      }
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (event.kind === "user") {
      if (!current || current.final || current.sentOnly) {
        if (current) turns.push(current)
        current = newTurn(event)
      }
      current.users.push(event)
      current.sentOnly = false
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (!current) {
      if (event.kind === "assistant" && !event.parts?.some((part) => part.type === "tool-call")) {
        continue
      }
      current = newTurn(event)
    }

    current.sentOnly = false

    if (event.kind === "assistant") {
      const parts = event.parts ?? []
      const hasCall = parts.some((part) => part.type === "tool-call")
      if (!hasCall) {
        current.final = event
        current.end = Math.max(current.end, event.at)
        current.pending = false
        turns.push(current)
        current = null
        continue
      }
      parts.forEach((part, index) => addPart(current!, event, part, index))
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (event.kind === "tool-result") {
      attachResult(current, event)
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (event.kind === "bash") {
      current.activity.push({
        key: `${event.id}:bash`,
        kind: "bash",
        label: "Ran",
        summary: firstLine(stripPrefix(event.summary, "! "), 140),
        at: event.at,
        isError: event.isError === true,
        event,
      })
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (event.kind === "notice") {
      current.activity.push({
        key: `${event.id}:notice`,
        kind: "notice",
        label: "Notice",
        summary: firstLine(stripPrefix(event.summary, "notice · "), 140),
        at: event.at,
        isError: false,
        event,
      })
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (event.kind === "compaction") {
      current.activity.push({
        key: `${event.id}:compaction`,
        kind: "compaction",
        label: "Compacted",
        summary: firstLine(stripPrefix(event.summary, "context compacted · "), 140),
        at: event.at,
        isError: false,
        event,
      })
      current.end = Math.max(current.end, event.at)
    }
  }

  if (current) turns.push(current)
  return turns
}

function intercomBodyKey(event: ViewerEvent): string {
  const meta = event.intercom
  if (!meta) return ""
  const pair = [meta.from, meta.to].sort().join("|")
  return `${pair}|${meta.body.replace(/\s+/g, " ").trim()}`
}

/**
 * A message between two viewers is written twice, once on each side. Keep the send
 * position and time, but borrow the receiver's message id and delivery proof.
 */
export function dedupeIntercoms(events: ViewerEvent[]): ViewerEvent[] {
  const out: ViewerEvent[] = []
  const byBody = new Map<string, number>()
  const byId = new Map<string, number>()

  for (const event of events) {
    if (event.kind !== "intercom" || !event.intercom) {
      out.push(event)
      continue
    }
    const idKey = event.intercom.messageId ? `id:${event.intercom.messageId}` : null
    const bodyKey = intercomBodyKey(event)
    let index = idKey ? byId.get(idKey) : undefined
    if (index === undefined) {
      const candidate = byBody.get(bodyKey)
      // The receiver can hold a message for minutes while it finishes a turn.
      if (candidate !== undefined && Math.abs(out[candidate].at - event.at) <= 30 * 60_000) {
        index = candidate
      }
    }
    if (index === undefined) {
      out.push(event)
      const next = out.length - 1
      byBody.set(bodyKey, next)
      if (idKey) byId.set(idKey, next)
      continue
    }
    const existing = out[index]
    if (existing.intercom?.direction === "sent" && event.intercom.direction === "received") {
      const failed = Boolean(existing.intercom.failed || event.intercom.failed)
      out[index] = {
        ...existing,
        intercom: {
          ...existing.intercom,
          messageId: existing.intercom.messageId ?? event.intercom.messageId,
          expectsReply: existing.intercom.expectsReply || event.intercom.expectsReply,
          failed: failed || undefined,
          error: existing.intercom.error ?? event.intercom.error,
          delivery: failed ? "failed" : "delivered",
        },
      }
      byBody.set(bodyKey, index)
      if (idKey) byId.set(idKey, index)
    }
  }
  return out
}

/**
 * A Channel row. The Channel renders one row per timeline item, never one block per turn,
 * so an operator message keeps its own place in the conversation regardless of which turn
 * happens to be running around it.
 */
export type ChannelItem =
  | {
      kind: "user"
      id: string
      at: number
      agentId: string
      agentName: string
      seq: number
      event: ViewerEvent
    }
  | {
      kind: "intercom"
      id: string
      at: number
      agentId: string
      agentName: string
      seq: number
      event: ViewerEvent
    }
  | {
      kind: "optimistic"
      id: string
      at: number
      agentId: string
      agentName: string
      seq: number
      message: OptimisticMessage
    }
  | {
      kind: "turn"
      id: string
      at: number
      agentId: string
      agentName: string
      seq: number
      turn: Turn
    }

/**
 * Ordering invariant for the Channel timeline.
 *
 * Every row is anchored at the moment it becomes true for the reader:
 * - an operator message is anchored at its send time;
 * - a settled turn is anchored at its settling event (the final assistant reply), not at
 *   its start, so a turn that overlaps a newer prompt cannot jump above it;
 * - a pending turn is always last, whatever its timestamps; it anchors at its start, so a
 *   live turn never reorders among its peers as activity streams in;
 * - an optimistic composer message is anchored at its send time, like a user message.
 *
 * Rows with the same anchor keep a deterministic order: pending rank, anchor, row kind
 * (operator message, optimistic message, turn), agent id, event sequence, row id. The
 * comparison uses code-unit string order, never `localeCompare`, so the order does not
 * depend on the browser locale. The result is a total order, so repeated polls over the
 * same events produce the same rows: nothing reorders until an event actually arrives.
 */
export function turnAnchor(turn: Turn): number {
  if (!turn.pending) {
    const settling = turn.final?.at ?? turn.end
    if (settling > 0) return settling
  }
  // A pending turn has no settling event yet, and a turn with no timestamp at all has
  // nothing better than its start. Zero means "unknown": such rows sort first,
  // deterministically, instead of jumping between polls.
  return turn.start > 0 ? turn.start : 0
}

const RANK_USER = 0
const RANK_INBOUND = 1
const RANK_OPTIMISTIC = 2
const RANK_TURN = 3
const RANK_SENT = 4

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function pendingRank(item: ChannelItem): number {
  return item.kind === "turn" && item.turn.pending ? 1 : 0
}

function kindRank(item: ChannelItem): number {
  if (item.kind === "user") return RANK_USER
  if (item.kind === "intercom") {
    return item.event.intercom?.direction === "sent" ? RANK_SENT : RANK_INBOUND
  }
  if (item.kind === "optimistic") return RANK_OPTIMISTIC
  return RANK_TURN
}

function compareChannelItems(a: ChannelItem, b: ChannelItem): number {
  return (
    pendingRank(a) - pendingRank(b) ||
    a.at - b.at ||
    kindRank(a) - kindRank(b) ||
    compareText(a.agentId, b.agentId) ||
    a.seq - b.seq ||
    compareText(a.id, b.id)
  )
}

function compareTurns(a: Turn, b: Turn): number {
  if (a.pending !== b.pending) return a.pending ? 1 : -1
  return (
    turnAnchor(a) - turnAnchor(b) || compareText(a.agentId, b.agentId) || a.seq - b.seq
  )
}

function groupTurns(events: ViewerEvent[]): Turn[] {
  const byAgent = new Map<string, ViewerEvent[]>()
  for (const event of dedupeIntercoms(events)) {
    const list = byAgent.get(event.agentId) ?? []
    list.push(event)
    byAgent.set(event.agentId, list)
  }
  const turns: Turn[] = []
  for (const agentEvents of byAgent.values()) {
    agentEvents.sort((a, b) => a.seq - b.seq)
    turns.push(...groupAgent(agentEvents))
  }
  return turns
}

/** Turns in Channel order: settled turns by settling event, pending turns last. */
export function channelTurns(events: ViewerEvent[]): Turn[] {
  return groupTurns(events).sort(compareTurns)
}

/**
 * The Channel timeline: operator messages as their own rows plus one row per turn and per
 * optimistic composer message, ordered by the invariant documented on `turnAnchor`.
 */
export function channelTimeline(
  events: ViewerEvent[],
  optimistic: OptimisticMessage[] = [],
): ChannelItem[] {
  const items: ChannelItem[] = []
  for (const turn of groupTurns(events)) {
    const anchor = turnAnchor(turn)
    for (const user of turn.users) {
      items.push({
        kind: "user",
        id: `user:${user.id}`,
        // A prompt without a timestamp keeps its position inside its own turn.
        at: user.at > 0 ? user.at : anchor,
        agentId: user.agentId,
        agentName: user.agentName,
        seq: user.seq,
        event: user,
      })
    }
    for (const event of turn.inbound) {
      items.push({
        kind: "intercom",
        id: `intercom:${event.id}`,
        at: event.at > 0 ? event.at : anchor,
        agentId: event.agentId,
        agentName: event.agentName,
        seq: event.seq,
        event,
      })
    }
    if (!turn.sentOnly) {
      items.push({
        kind: "turn",
        id: `turn:${turn.id}`,
        at: anchor,
        agentId: turn.agentId,
        agentName: turn.agentName,
        seq: turn.seq,
        turn,
      })
    }
    for (const event of turn.sent) {
      items.push({
        kind: "intercom",
        id: `intercom:${event.id}`,
        at: event.at > 0 ? event.at : anchor,
        agentId: event.agentId,
        agentName: event.agentName,
        seq: event.seq,
        event,
      })
    }
  }
  for (const message of optimistic) {
    items.push({
      kind: "optimistic",
      id: `optimistic:${message.id}`,
      at: message.at,
      agentId: message.paneId,
      agentName: message.agentName,
      seq: 0,
      message,
    })
  }
  return items.sort(compareChannelItems)
}

export function toolCount(turn: Turn): number {
  return turn.activity.filter((item) => item.kind === "tool" || item.kind === "bash").length
}

export function stepCount(turn: Turn): number {
  return turn.activity.length
}

export function turnDuration(turn: Turn): number {
  const end = turn.final?.at ?? turn.end
  return Math.max(0, end - turn.start)
}

export function activitySignature(turn: Turn): string {
  return turn.activity.map((item) => `${item.kind}:${item.key}:${item.isError ? 1 : 0}`).join("|")
}
