import { StatusDot } from "@/components/StatusDot"
import { SIDEBAR_DOT, sidebarDotLabel } from "@/lib/status-dot"
import type { AgentStatus } from "@/shared/types"
import { cn } from "@/lib/utils"

/**
 * The status carrier of a sidebar row: the shared status dot (src/components/StatusDot.tsx), wearing
 * the sidebar's classes from `SIDEBAR_DOT` for the 3:1 contrast floor of the sidebar plane. The dot
 * carries the state alone — the row's second line no longer repeats it — so the label and the tooltip
 * hold the word (`Working`, `Needs you`, `Quiet 16m`) and the row's aria-label includes it.
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
