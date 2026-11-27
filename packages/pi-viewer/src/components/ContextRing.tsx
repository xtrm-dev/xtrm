/** The context-usage ring beside the composer's model name (XTRM-1087).
 *
 * A 14px ring on the icon ladder: a faint track, and an arc for the fraction of the model's window
 * the agent's transcript already fills. The tone moves from muted to ink to danger as the window
 * fills, so a nearly full context is visible without reading a number. The number is in the
 * accessible name and the tooltip: "42% of 200k tokens". Nothing renders when the window is unknown.
 */

import { contextLabel, contextPercent, contextTone } from "@/lib/context-usage"
import { cn } from "@/lib/utils"
import type { ContextUsage } from "@/shared/types"

const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const TONE = {
  calm: "text-ink-muted",
  warm: "text-ink",
  hot: "text-danger",
} as const

export function ContextRing({ usage, className }: { usage: ContextUsage; className?: string }) {
  const percent = contextPercent(usage)
  const label = contextLabel(usage)
  return (
    <span
      data-context-ring=""
      data-context-percent={percent}
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", TONE[contextTone(usage)], className)}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5 -rotate-90">
        <circle cx="7" cy="7" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
    </span>
  )
}
