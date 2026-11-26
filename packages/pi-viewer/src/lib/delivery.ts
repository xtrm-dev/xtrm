import type { OptimisticMessage } from "./optimistic.ts"
import type { ChannelItem } from "./thread.ts"

/**
 * What the operator can know about a prompt sent through tmux send-keys.
 * queued: the request is in flight. typed: send-keys returned; the transcript has no echo yet.
 * seen: the prompt is in the transcript. answered: the same agent has since settled a turn.
 */
export type Delivery = "queued" | "typed" | "seen" | "answered" | "failed"

/** The words behind the delivery marks (operator, 2026-11-26): shown as the mark's label and tooltip, and as
 * text only for a failure, whose reason must stay readable. "answered" reads as "Replied". */
export const DELIVERY_WORD: Record<Delivery, string> = {
  queued: "Sending",
  typed: "Sent",
  seen: "Seen",
  answered: "Replied",
  failed: "Not sent",
}

export function deliveryOfOptimistic(status: OptimisticMessage["status"]): Delivery {
  if (status === "sending") return "queued"
  if (status === "error") return "failed"
  return "typed"
}

/** A user event in the transcript is `seen`, or `answered` once its agent settled a later turn. */
export function deliveryOfUser(item: Extract<ChannelItem, { kind: "user" }>, items: ChannelItem[]): Delivery {
  for (const other of items) {
    if (other.kind !== "turn" || other.agentId !== item.agentId) continue
    if (other.turn.final && other.at > item.at) return "answered"
  }
  return "seen"
}

/** Only the newest operator message per agent carries a state; older ones are history. */
export function latestUserIds(items: ChannelItem[]): Set<string> {
  const latest = new Map<string, { id: string; at: number; seq: number }>()
  for (const item of items) {
    if (item.kind !== "user" && item.kind !== "optimistic") continue
    const previous = latest.get(item.agentId)
    if (!previous || item.at > previous.at || (item.at === previous.at && item.seq >= previous.seq)) {
      latest.set(item.agentId, { id: item.id, at: item.at, seq: item.seq })
    }
  }
  return new Set(Array.from(latest.values(), (entry) => entry.id))
}
