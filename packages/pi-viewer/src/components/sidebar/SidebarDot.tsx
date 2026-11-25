import { cn } from "@/lib/utils"
import { STATE_LABEL, type SidebarState } from "@/lib/tree"

/**
 * The status carrier of a row: one small static dot, no animation. The state is also written
 * on the row's second line, so the dot only has to be calm and consistent.
 *   idle     faint ink, 40%
 *   running  muted ink, solid
 *   error    danger, solid
 * There is no "needs attention" dot: the server proves no such state (see `stateOf`).
 */
const DOT: Record<SidebarState, string> = {
  idle: "bg-ink-faint/40",
  running: "bg-ink-muted",
  error: "bg-danger",
}

export function SidebarDot({ state, className }: { state: SidebarState; className?: string }) {
  return (
    <span aria-hidden title={STATE_LABEL[state]} className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", className)}>
      <span className={cn("size-1.5 rounded-full", DOT[state])} />
    </span>
  )
}
