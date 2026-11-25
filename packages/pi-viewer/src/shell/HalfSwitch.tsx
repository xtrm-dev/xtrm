import { Tooltip } from "radix-ui"

import { cn } from "@/lib/utils"

import { modShortcut } from "./layout"

/**
 * The console's top switcher, copied from packages/xtrm-app/src/shell/ContextSidebar.tsx `HalfSwitch`
 * (XTRM-1044): a two-entry segmented radiogroup in a `bg-pressed` track, 28px high, the selected entry
 * on `bg-control`, the other `text-ink-faint` with a "Switch to ..." tooltip and the Mod+. hint.
 * The console's entries are Work and Agent; the viewer shows the same two, with its own entry named
 * "Threads" (operator ruling) and selected. "Work" looks as in the console and does nothing: the viewer
 * has no route to the console yet.
 */
const HALVES = [
  { id: "console", label: "Work" },
  { id: "threads", label: "Threads" },
] as const

export function HalfSwitch({ current = "threads" }: { current?: "console" | "threads" }) {
  return (
    <div role="radiogroup" aria-label="Workspace" data-testid="half-switch" className="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-sm bg-pressed p-0.5">
      {HALVES.map((half) => {
        const on = half.id === current
        return (
          <Tooltip.Root key={half.id}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={half.label}
                className={cn(
                  "flex h-6 min-w-0 flex-1 items-center justify-center rounded-sm text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
                  on ? "bg-control text-ink" : "text-ink-faint hover:text-ink-muted",
                )}
              >
                {half.label}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="bottom" sideOffset={6} className="z-50 flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-xs text-ink shadow-float">
                {on ? half.label : `Switch to ${half.label}`}
                <kbd className="rounded-sm border border-border px-1 font-sans text-2xs text-ink-faint">{modShortcut(".")}</kbd>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
