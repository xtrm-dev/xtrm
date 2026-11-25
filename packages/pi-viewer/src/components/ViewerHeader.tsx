import { MoonIcon, SunIcon } from "lucide-react"

import { RoleChip } from "@/components/RoleChip"
import type { ScopeLabel } from "@/lib/scope"
import { cn } from "@/lib/utils"

function Segmented({
  view,
  onChange,
}: {
  view: "channel" | "all"
  onChange: (view: "channel" | "all") => void
}) {
  return (
    <div className="flex items-center rounded-lg bg-pressed p-0.5" role="tablist" aria-label="View">
      {(
        [
          ["channel", "Channel"],
          ["all", "All events"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
            view === value
              ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-ink-faint hover:text-ink-muted",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function ViewerHeader({
  label,
  view,
  onViewChange,
  theme,
  onToggleTheme,
}: {
  label: ScopeLabel | null
  view: "channel" | "all"
  onViewChange: (view: "channel" | "all") => void
  theme: "light" | "dark"
  onToggleTheme: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="min-w-0 truncate text-sm font-semibold text-ink" data-testid="scope-title">
          {label?.title ?? "No agent"}
        </span>
        {label?.role ? <RoleChip role={label.role} className="self-center" /> : null}
        <span className="hidden truncate text-2xs text-ink-faint sm:inline" data-testid="scope-detail">
          {label?.detail ?? ""}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Segmented view={view} onChange={onViewChange} />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="flex size-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink-muted"
        >
          {theme === "dark" ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
        </button>
      </div>
    </header>
  )
}
