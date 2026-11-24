import { ChevronDownIcon, MoonIcon, SunIcon } from "lucide-react"

import type { ViewerSession } from "@/shared/types"
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
  sessions,
  session,
  onSessionChange,
  view,
  onViewChange,
  agentCount,
  theme,
  onToggleTheme,
}: {
  sessions: ViewerSession[]
  session: string | null
  onSessionChange: (session: string) => void
  view: "channel" | "all"
  onViewChange: (view: "channel" | "all") => void
  agentCount: number
  theme: "light" | "dark"
  onToggleTheme: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-muted px-4 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="relative inline-flex shrink-0 self-center">
          <select
            value={session ?? ""}
            onChange={(event) => onSessionChange(event.target.value)}
            aria-label="tmux session"
            className="max-w-52 cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-semibold text-ink focus:outline-none"
          >
            {sessions.length ? null : <option value="">no session</option>}
            {sessions.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-0 size-3 -translate-y-1/2 text-ink-faint" />
        </span>
        <span className="hidden text-2xs text-ink-faint sm:inline">
          {agentCount} {agentCount === 1 ? "agent" : "agents"}
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
