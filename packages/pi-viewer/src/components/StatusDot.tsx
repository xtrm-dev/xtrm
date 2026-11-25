import { STATUS_DOT, STATUS_WORD } from "@/lib/status-dot"
import type { AgentStatus } from "@/shared/types"
import { cn } from "@/lib/utils"

/**
 * The shared status dot: the colour and animation for each agent state come from `STATUS_DOT`
 * (src/lib/status-dot.ts), so every surface draws one shape per state. The word is the label and
 * the tooltip; a caller that labels the dot elsewhere passes `decorative` and gets no label here.
 */
export function StatusDot({
  status,
  className,
  label,
  decorative,
}: {
  status: AgentStatus
  className?: string
  /** Label and tooltip text; defaults to the state word. */
  label?: string
  /** The dot is inside an element that already carries the label: hide it from assistive tech. */
  decorative?: boolean
}) {
  const word = label ?? STATUS_WORD[status]
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", STATUS_DOT[status], className)}
      title={decorative ? undefined : word}
      aria-label={decorative ? undefined : word}
      aria-hidden={decorative || undefined}
    />
  )
}

export function statusWord(status: AgentStatus): string {
  return STATUS_WORD[status]
}
