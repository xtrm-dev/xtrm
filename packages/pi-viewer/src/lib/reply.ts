import type { ViewerAgent } from "@/shared/types"

/**
 * Reply to an agent message (XTRM-1045). The reply state is one pane id: the agent the composer
 * was aimed at by a Reply click. The composer target stays the single source of where a send
 * goes; the reply only decides whether the "Replying to" bar shows.
 */

export type ReplyScopeKind = "session" | "window" | "pane"

/** What the Reply button does for one agent row. */
export type ReplyAvailability = "ready" | "gone"

export function replyAvailability(agent: ViewerAgent | undefined): ReplyAvailability {
  return agent ? "ready" : "gone"
}

export function replyLabel(name: string): string {
  return `Reply to ${name}`
}

export function replyTitle(availability: ReplyAvailability): string {
  return availability === "gone" ? "Agent is gone" : "Reply"
}

/**
 * The pane id to remember after a Reply click. A pane scope has a fixed target, so Reply only
 * focuses the composer and no bar shows.
 */
export function replyIdFor(scopeKind: ReplyScopeKind, agentId: string): string | null {
  return scopeKind === "pane" ? null : agentId
}

/** The agent the bar names: the reply id, while the composer still aims at that agent and it is present. */
export function replyBarAgent(replyId: string | null, target: ViewerAgent | null): ViewerAgent | null {
  if (!replyId || !target) return null
  return target.id === replyId ? target : null
}

/** Escape clears the reply bar from an empty composer; a draft keeps Escape for itself. */
export function escapeClearsReply(hasBar: boolean, draft: string): boolean {
  return hasBar && draft.length === 0
}
