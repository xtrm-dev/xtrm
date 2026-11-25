import { cn } from "@/lib/utils"
import { STATE_LABEL, type SidebarState } from "@/lib/tree"

/**
 * The status carrier of a row. Shape and ink follow `DOT` and `StatusDot` in xtrm-app
 * src/ui/primitives.tsx: a 14px box around an 8px dot, colour only for accent and danger.
 *   idle      neutral  ring in muted ink
 *   running   active   ring in accent
 *   attention accent   solid accent
 *   error     danger   solid danger
 */
const DOT: Record<SidebarState, string> = {
  idle: "border border-ink-muted bg-transparent",
  running: "border-[1.5px] border-accent bg-transparent",
  attention: "bg-accent",
  error: "bg-danger",
}

export function SidebarDot({ state, className }: { state: SidebarState; className?: string }) {
  return (
    <span
      aria-hidden
      title={STATE_LABEL[state]}
      className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", className)}
    >
      <span className={cn("size-2 rounded-full", DOT[state])} />
    </span>
  )
}
