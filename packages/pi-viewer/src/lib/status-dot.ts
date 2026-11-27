import type { AgentStatus } from "@/shared/types"

/**
 * The status dot: the one mark that carries an agent's state, in the thread, presence and the sidebar
 * (design: docs/design/working-presence.md §6, "one shape per state across a surface").
 *
 * The colours and animations live here, not in a component, so one table serves every surface and a
 * unit test can pin the mapping. Only existing tokens and the two existing keyframes are used
 * (`viewer-pulse`, `viewer-fade`), and both already stop under `prefers-reduced-motion`.
 */

/** The shared dot: colour and, for a live state, the animation that makes it read as live. */
export const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-accent viewer-pulse",
  attention: "bg-accent",
  quiet: "bg-ink-faint",
  waiting: "bg-success",
  error: "bg-danger",
  idle: "bg-ink-faint/50",
  unknown: "bg-ink-faint/30",
}

/** The state word a dot carries in its label. Lower case, as the existing call sites read it. */
export const STATUS_WORD: Record<AgentStatus, string> = {
  working: "working",
  attention: "needs you",
  quiet: "quiet",
  waiting: "waiting",
  error: "failed",
  idle: "idle",
  unknown: "unknown",
}

/**
 * The sidebar's dot. Same shape and the same accent/danger hues as the shared dot; the classes differ
 * because the sidebar is a small plane and every dot must keep the 3:1 non-text minimum against it
 * (`--x-sidebar`), which `ink-faint` misses at 2.74:1 in light and 2.93:1 in the console dark plane.
 *   working    accent, pulsing        attention  accent, flashing (the row needs the operator)
 *   quiet      ink-muted, solid       idle/waiting ink-muted at 75%, faint and static
 *   error      danger, solid          unknown    a hollow ring, not a filled dot
 * `bg-*` overrides are merged over STATUS_DOT by `cn` (tailwind-merge), so the shared table stays the
 * single source of the default and only the sidebar plane overrides it.
 */
export const SIDEBAR_DOT: Record<AgentStatus, string> = {
  working: "bg-accent viewer-pulse",
  attention: "bg-accent viewer-fade",
  quiet: "bg-ink-muted",
  waiting: "bg-ink-muted/75",
  error: "bg-danger",
  idle: "bg-ink-muted/75",
  unknown: "border border-ink-muted/75 bg-transparent",
}

/**
 * Whether the sidebar draws the dot at all. An idle agent draws nothing: the absence of the dot is the
 * state (operator 2026-11-26, XTRM-1058), and `waiting` reads as idle, so it draws nothing either. The
 * row leaves the slot empty, so nothing shifts when the state changes, and the row's aria-label keeps
 * the word (`Idle`, `Waiting`) for the screen reader.
 */
export const SIDEBAR_DOT_SHOWN: Record<AgentStatus, boolean> = {
  working: true,
  attention: true,
  quiet: true,
  error: true,
  unknown: true,
  idle: false,
  waiting: false,
}

/** The same words, capitalised for a label or tooltip; "failed" reads better than "error". */
const SIDEBAR_WORD: Record<AgentStatus, string> = {
  working: "Working",
  attention: "Needs you",
  quiet: "Quiet",
  waiting: "Waiting",
  error: "Failed",
  idle: "Idle",
  unknown: "Unknown",
}

/**
 * The dot's label in the sidebar, e.g. `Working`, `Needs you`, `Quiet 16m`. The quiet state carries its
 * age from the server's note (`no output for 16m`), as the presence line shows it.
 */
export function sidebarDotLabel(status: AgentStatus, note?: string | null): string {
  if (status !== "quiet") return SIDEBAR_WORD[status]
  const age = note?.replace(/^no output for /, "").trim()
  return age ? `Quiet ${age}` : "Quiet"
}
