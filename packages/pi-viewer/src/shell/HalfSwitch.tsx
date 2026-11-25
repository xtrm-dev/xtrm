import { cn } from "@/lib/utils"

/**
 * The console's top switcher, copied from packages/xtrm-app/src/shell/ContextSidebar.tsx `HalfSwitch`
 * (XTRM-1044): a Work / Agent segmented radiogroup in a `bg-pressed` track, 28px high. The console's
 * "Agent" half is where the agents live, so the viewer is the Agent entry and is selected. "Work" is
 * the console's issue half: inert here, because the viewer has no route to it yet.
 */
const HALVES = [
  { id: "console", label: "Work" },
  { id: "agent", label: "Agent" },
] as const

export function HalfSwitch({ current = "agent" }: { current?: "console" | "agent" }) {
  return (
    <div role="radiogroup" aria-label="Workspace" data-testid="half-switch" className="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-sm bg-pressed p-0.5">
      {HALVES.map((half) => {
        const on = half.id === current
        return (
          <button
            key={half.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={half.label}
            aria-disabled={on ? undefined : true}
            title={on ? half.label : `${half.label}: opens in the console (not connected in this spike)`}
            className={cn(
              "flex h-6 min-w-0 flex-1 items-center justify-center rounded-sm text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
              on ? "bg-control text-ink" : "cursor-default text-ink-faint",
            )}
          >
            {half.label}
          </button>
        )
      })}
    </div>
  )
}
