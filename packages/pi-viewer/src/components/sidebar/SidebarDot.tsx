import { StatusDot } from "@/components/StatusDot"
import { SIDEBAR_DOT, SIDEBAR_DOT_SHOWN, sidebarDotLabel } from "@/lib/status-dot"
import type { AgentStatus } from "@/shared/types"
import { cn } from "@/lib/utils"

/**
 * The status carrier of a sidebar row: the shared status dot (src/components/StatusDot.tsx), wearing
 * the sidebar's classes from `SIDEBAR_DOT` for the 3:1 contrast floor of the sidebar plane. The dot
 * carries the state alone — the row's second line no longer repeats it — so the label and the tooltip
 * hold the word (`Working`, `Needs you`, `Quiet 16m`) and the row's aria-label includes it.
 *
 * An idle agent draws no dot: the absence is the state (operator 2026-11-26, XTRM-1058). The same box
 * stays in the tree as an empty slot, so a state change moves nothing, and the row's aria-label keeps
 * saying `Idle`.
 */
export function SidebarDot({
  status,
  note,
  className,
}: {
  status: AgentStatus
  /** The server's status note; the quiet state reads its age from it. */
  note?: string | null
  className?: string
}) {
  const label = sidebarDotLabel(status, note)
  if (!SIDEBAR_DOT_SHOWN[status]) {
    return <span aria-hidden data-testid="sidebar-dot-slot" className={cn("inline-flex size-3.5 shrink-0", className)} />
  }
  return (
    <span
      data-testid="sidebar-dot"
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", className)}
    >
      <StatusDot status={status} className={SIDEBAR_DOT[status]} decorative />
    </span>
  )
}
