import type { OptimisticMessage } from "@/lib/optimistic"
import type { TurnEffect, ViewerEvent, ViewerPart } from "@/shared/types"

// Relative with the extension: the server and the node tests load this module without the @ alias.
import { INITIAL_TURN_STATE, nextTurnState } from "./turn-state.ts"

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
  /** The agent's turn is open (turn state model, src/lib/turn-state.ts). */
  pending: boolean
  /** Pane-only work between agent turns (`!ls`, `/compact`, a notice that wakes nobody). Never pending. */
  local?: boolean
  /** Closed without a reply (an interrupt, an abort during a tool call): why. */
  stopped?: string
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

/**
 * The effect of an event on its agent's turn. The server sets it on every event; an event
 * built without one (tests, older payloads) falls back to its kind.
 */
export function eventEffect(event: ViewerEvent): TurnEffect {
  if (event.effect) return event.effect
  switch (event.kind) {
    case "user":
      return "open"
    case "intercom":
      return event.intercom?.direction === "received" ? "open" : "none"
    case "assistant":
      if (event.stopReason === "error") return "fail"
      if (event.stopReason === "aborted") return "abort"
      return event.parts?.some((part) => part.type === "tool-call") ? "step" : "reply"
    case "tool-result":
      return "step"
    case "compaction":
      return "compact"
    default:
      return "none"
  }
}

/** Events the Channel groups: on the branch, and visible or carrying a turn effect. */
export function channelEvent(event: ViewerEvent): boolean {
  return event.onBranch && (event.kind !== "meta" || eventEffect(event) !== "none")
}

function activityOf(event: ViewerEvent): ActivityItem | null {
  if (event.kind === "bash") {
    return {
      key: `${event.id}:bash`,
      kind: "bash",
      label: "Ran",
      summary: firstLine(stripPrefix(event.summary, "! "), 140),
      at: event.at,
      isError: event.isError === true,
      event,
    }
  }
  if (event.kind === "notice") {
    return {
      key: `${event.id}:notice`,
      kind: "notice",
      label: "Notice",
      summary: firstLine(stripPrefix(event.summary, "notice · "), 140),
      at: event.at,
      isError: false,
      event,
    }
  }
  if (event.kind === "compaction") {
    return {
      key: `${event.id}:compaction`,
      kind: "compaction",
      label: "Compacted",
      summary: firstLine(stripPrefix(event.summary, "context compacted · "), 140),
      at: event.at,
      isError: false,
      event,
    }
  }
  return null
}

/**
 * One agent's events as turns, by the turn state model: `current` is the open turn exactly
 * while the model's phase is open. Work the operator runs in the pane with no turn open
 * (`!ls`, `/model`, `/compact`, a notice that wakes nobody) collects in one closed `local`
 * row, so it never becomes a pending turn and never joins the next prompt's turn.
 */
function groupAgent(events: ViewerEvent[]): Turn[] {
  const turns: Turn[] = []
  let state = INITIAL_TURN_STATE
  // Held in an object: the helpers below reassign both.
  // `failed`: the turn closed by a context overflow, which a compaction reopens.
  const at: { current: Turn | null; local: Turn | null; failed: Turn | null } = { current: null, local: null, failed: null }

  const open = (event: ViewerEvent): Turn => {
    const turn = newTurn(event)
    turns.push(turn)
    at.local = null
    at.current = turn
    return turn
  }
  const localRow = (event: ViewerEvent): Turn => {
    if (!at.local) {
      at.local = newTurn(event)
      at.local.pending = false
      at.local.local = true
      turns.push(at.local)
    }
    return at.local
  }
  const close = (turn: Turn): void => {
    turn.pending = false
    at.current = null
  }

  for (const event of events) {
    const effect = eventEffect(event)
    const before = state
    state = nextTurnState(state, effect, event.overflow === true)
    const failed = at.failed
    if (effect !== "none") at.failed = null
    const hasCall = event.kind === "assistant" && (event.parts ?? []).some((part) => part.type === "tool-call")
    let turn: Turn | null = at.current

    if (event.kind === "intercom" && event.intercom) {
      if (event.intercom.direction === "sent") {
        // A sent card is a step of the turn that issued it.
        if (!turn) {
          turn = effect === "step" ? open(event) : newTurn(event)
          if (effect !== "step") {
            turn.pending = false
            turns.push(turn)
          }
          turn.sentOnly = true
        }
        turn.sent.push(event)
      } else {
        turn ??= open(event)
        turn.inbound.push(event)
      }
      turn.end = Math.max(turn.end, event.at)
      // A card cut from a message that ended the turn (aborted during a SendMessage) closes it too.
      if (turn === at.current && (effect === "abort" || effect === "fail" || effect === "reply")) {
        if (effect !== "reply") turn.stopped = effect === "abort" ? "turn aborted" : "last turn failed"
        close(turn)
      }
      continue
    }

    switch (effect) {
      case "open":
        turn ??= open(event)
        turn.sentOnly = false
        if (event.kind === "user") turn.users.push(event)
        else {
          const item = activityOf(event)
          if (item) turn.activity.push(item)
        }
        break
      case "step":
        turn ??= open(event)
        turn.sentOnly = false
        if (event.kind === "assistant") (event.parts ?? []).forEach((part, index) => addPart(turn!, event, part, index))
        else if (event.kind === "tool-result") attachResult(turn, event)
        break
      case "reply":
      case "fail":
        // A reply with no open turn answers nothing shown in the thread. A second overflow error
        // with no turn open (no prompt between them) keeps the failed turn for the compaction.
        if (!turn || event.kind !== "assistant") {
          if (state.phase === "failed" && state.overflow) at.failed = failed
          continue
        }
        turn.sentOnly = false
        turn.final = event
        close(turn)
        if (effect === "fail" && event.overflow === true) at.failed = turn
        break
      case "abort":
        if (!turn && !hasCall) continue
        turn ??= open(event)
        turn.sentOnly = false
        if (event.kind === "assistant" && !hasCall) turn.final = event
        else {
          if (hasCall) (event.parts ?? []).forEach((part, index) => addPart(turn!, event, part, index))
          turn.stopped = event.kind === "assistant" ? "turn aborted" : "turn interrupted"
        }
        close(turn)
        break
      case "compact": {
        const item = activityOf(event)
        if (turn && before.phase === "open") {
          // Compaction inside an open turn (before or after its first step): the turn goes on.
          if (item) turn.activity.push(item)
          break
        }
        if (failed && before.phase === "failed" && before.overflow) {
          // The turn failed on a context overflow; the compaction resumes it.
          turn = failed
          turn.final = undefined
          turn.pending = true
          at.current = turn
          at.local = null
          if (item) turn.activity.push(item)
          break
        }
        turn = localRow(event)
        if (item) turn.activity.push(item)
        break
      }
      case "none": {
        if (event.kind === "user") {
          // A local slash command (`/model`): an operator row, no agent turn.
          turn ??= localRow(event)
          turn.users.push(event)
          break
        }
        const item = activityOf(event)
        if (!item) continue
        turn ??= localRow(event)
        turn.activity.push(item)
        break
      }
    }
    turn.end = Math.max(turn.end, event.at)
  }

  return turns
}

/** All-events pair identity. The server supplies a hash because its body is cut to 160 chars. */
export function intercomPairKey(
  meta: Pick<NonNullable<ViewerEvent["intercom"]>, "from" | "to" | "body" | "pairKey">,
): string {
  const pair = [meta.from, meta.to].sort().join("|")
  return `${pair}|${meta.pairKey ?? meta.body.replace(/\s+/g, " ").trim()}`
}

function intercomBodyKey(event: ViewerEvent): string {
  const meta = event.intercom
  if (!meta) return ""
  const pair = [meta.from, meta.to].sort().join("|")
  return `${pair}|${meta.body.replace(/\s+/g, " ").trim()}`
}

function isIntercomPart(part: ViewerPart): boolean {
  return part.type === "tool-call" && (part.toolName === "SendMessage" || part.toolName === "intercom")
}

function intercomCard(event: ViewerEvent, meta: NonNullable<ViewerEvent["intercom"]>, index: number): ViewerEvent {
  const summary =
    meta.direction === "sent"
      ? `→ ${meta.to} · ${meta.summary ?? firstLine(meta.body)}`
      : `← ${meta.from} · ${meta.summary ?? firstLine(meta.body)}`
  return {
    ...event,
    id: `${event.id}:intercom:${String(index).padStart(3, "0")}`,
    kind: "intercom",
    role: "intercom",
    summary,
    text: undefined,
    parts: undefined,
    intercom: meta,
    intercoms: undefined,
    isError: meta.failed === true || meta.delivery === "failed" || undefined,
    truncated: meta.truncated || undefined,
    detail:
      meta.direction === "sent"
        ? `intercom sent to ${meta.to}`
        : `intercom received from ${meta.from}`,
  }
}

/** One assistant entry can issue several peer messages; each becomes its own card. */
export function expandIntercomCalls(events: ViewerEvent[]): ViewerEvent[] {
  return events.flatMap((event) => {
    const metas = event.intercoms
    if (!metas?.length) return [event]
    const parts = event.parts?.filter((part) => !isIntercomPart(part))
    const first = parts?.find((part) => part.type === "tool-call")
    // Keep the entry only when it still carries non-intercom tool work. A text-only
    // preamble must not settle the turn before the cards it belongs to.
    const base = first
      ? {
          ...event,
          intercoms: undefined,
          parts,
          summary: `${first.toolName ?? "tool"}${first.summary ? ` · ${first.summary}` : ""}`,
        }
      : null
    const cards = metas.map((meta, index) => intercomCard(event, meta, index))
    return base ? [base, ...cards] : cards
  })
}

/** An invisible stand-in that keeps a merged event's turn effect for its own agent. */
function effectCarrier(event: ViewerEvent): ViewerEvent {
  return { ...event, id: `${event.id}:effect`, kind: "meta", intercom: undefined, intercoms: undefined, effect: eventEffect(event) }
}

/**
 * A message between two viewers is written twice, once on each side. Keep the send
 * position and time, but borrow the receiver's message id and delivery proof.
 */
export function dedupeIntercoms(
  events: ViewerEvent[],
  /** Receives an invisible stand-in for each merged copy that moves its own agent's turn. */
  carriers?: ViewerEvent[],
): ViewerEvent[] {
  const out: ViewerEvent[] = []
  const byBody = new Map<string, number>()
  const byId = new Map<string, number>()

  for (const event of expandIntercomCalls(events)) {
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
    // The copy merges into the card already shown, but what it does to its own agent's turn
    // stays: a peer message that wakes the receiver still opens its turn (w2w9 line 3381).
    // Only an opening effect is carried: an invisible carrier cannot close a turn (a reply on a
    // meta event is skipped) and must not draw a stopped row (abort).
    const copyEffect = eventEffect(event)
    if (carriers && (copyEffect === "open" || copyEffect === "step")) carriers.push(effectCarrier(event))
    if (existing.intercom?.direction === "sent" && event.intercom.direction === "sent") {
      // A retry of the same body: a later success proves the message can be delivered, while
      // a later failure must never erase an earlier success.
      if (existing.intercom.failed && !event.intercom.failed) {
        out[index] = {
          ...existing,
          isError: false,
          summary: existing.summary.replace(/\s*· failed$/, ""),
          intercom: {
            ...existing.intercom,
            messageId: existing.intercom.messageId ?? event.intercom.messageId,
            toolCallId: event.intercom.toolCallId ?? existing.intercom.toolCallId,
            failed: undefined,
            error: undefined,
            delivery: event.intercom.delivery === "failed" ? "sent" : (event.intercom.delivery ?? "sent"),
          },
        }
        byBody.set(bodyKey, index)
        if (idKey) byId.set(idKey, index)
      }
      continue
    }
    if (existing.intercom?.direction === "sent" && event.intercom.direction === "received") {
      // The receiver's copy is proof of delivery. It overrides a stale failure from an
      // earlier attempt, including its error text and the event-level error flag.
      out[index] = {
        ...existing,
        isError: false,
        summary: existing.summary.replace(/\s*· failed$/, ""),
        intercom: {
          ...existing.intercom,
          messageId: existing.intercom.messageId ?? event.intercom.messageId,
          expectsReply: existing.intercom.expectsReply || event.intercom.expectsReply,
          failed: undefined,
          error: undefined,
          delivery: "delivered",
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

export function compareChannelItems(a: ChannelItem, b: ChannelItem): number {
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
  const carriers: ViewerEvent[] = []
  for (const event of [...dedupeIntercoms(events, carriers), ...carriers]) {
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
