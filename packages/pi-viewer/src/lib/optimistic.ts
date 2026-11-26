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
    event.at <= message.at + 60_000
  )
}
