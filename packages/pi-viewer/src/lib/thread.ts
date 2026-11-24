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
  start: number
  end: number
  final?: ViewerEvent
  users: ViewerEvent[]
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
    start: event.at,
    end: event.at,
    users: [],
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
    const callId = item.call?.parts?.find((part) => part.type === "tool-call")?.toolCallId
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

    if (event.kind === "user") {
      if (!current || current.final) {
        if (current) turns.push(current)
        current = newTurn(event)
      }
      current.users.push(event)
      current.end = Math.max(current.end, event.at)
      continue
    }

    if (!current) {
      if (event.kind === "assistant" && !event.parts?.some((part) => part.type === "tool-call")) {
        continue
      }
      current = newTurn(event)
    }

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

export function channelTurns(events: ViewerEvent[]): Turn[] {
  const byAgent = new Map<string, ViewerEvent[]>()
  for (const event of events) {
    const list = byAgent.get(event.agentId) ?? []
    list.push(event)
    byAgent.set(event.agentId, list)
  }
  const turns: Turn[] = []
  for (const agentEvents of byAgent.values()) {
    agentEvents.sort((a, b) => a.seq - b.seq)
    turns.push(...groupAgent(agentEvents))
  }
  turns.sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? 1 : -1
    const at = a.pending ? a.end : a.start
    const bt = b.pending ? b.end : b.start
    return at - bt || a.agentId.localeCompare(b.agentId)
  })
  return turns
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
