import type { ViewerEvent } from "../shared/types.ts"

export interface OptimisticMessage {
  id: string
  paneId: string
  agentName: string
  text: string
  at: number
  status: "sending" | "sent" | "error"
  error?: string
}

/** Compare the composer text with the prompt text pi writes to the session file. */
export function normalizePrompt(value: string): string {
  return value
    .replace(/^\s*›\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * How long an optimistic prompt can wait for its transcript row. A busy agent may hold a
 * queued prompt for minutes; the quiet window is the outer bound before a row is abandoned.
 */
export const ECHO_WINDOW_MS = 15 * 60_000

/** A session user event that is the echo of an optimistic composer message. */
export function isEchoOf(
  event: { kind: string; agentId: string; text?: string; at: number },
  message: OptimisticMessage,
): boolean {
  return (
    event.kind === "user" &&
    event.agentId === message.paneId &&
    normalizePrompt(event.text ?? "") === normalizePrompt(message.text) &&
    event.at >= message.at - 30_000 &&
    event.at <= message.at + ECHO_WINDOW_MS
  )
}

/**
 * Match each optimistic prompt to the transcript row that echoes it. A busy agent can hold the
 * prompt for minutes, so the match is by agent, text and a bounded time window, not by arrival
 * order. The echo keeps the optimistic key so React updates the row instead of remounting it.
 */
export function matchEchoes(
  events: readonly ViewerEvent[],
  messages: readonly OptimisticMessage[],
): { visible: OptimisticMessage[]; keys: Map<string, string> } {
  const keys = new Map<string, string>()
  const matched = new Set<string>()
  const visible: OptimisticMessage[] = []
  for (const message of messages) {
    const echo = events.find((event) => !matched.has(event.id) && isEchoOf(event, message))
    if (echo) {
      matched.add(echo.id)
      keys.set(echo.id, `optimistic:${message.id}`)
    } else {
      visible.push(message)
    }
  }
  return { visible, keys }
}
