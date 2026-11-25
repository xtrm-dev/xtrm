import { CheckIcon } from "lucide-react"
import { Popover } from "radix-ui"
import { useState } from "react"

import { RoleChip } from "@/components/RoleChip"
import {
  COMFORTABLE_REM,
  MIN_REM,
  WIDE_REM,
  fromSlider,
  toSlider,
  widthLabel,
  type ChatWidth,
} from "@/lib/chat-width"
import type { ScopeLabel } from "@/lib/scope"
import { cn } from "@/lib/utils"
import { Icon } from "@/shell/icon"
import { IconButton } from "@/shell/IconButton"
import { modShortcut } from "@/shell/layout"

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


const PRESETS: { mode: "comfortable" | "wide" | "full"; label: string; detail: string }[] = [
  { mode: "comfortable", label: "Comfortable", detail: `${COMFORTABLE_REM}rem` },
  { mode: "wide", label: "Wide", detail: `${WIDE_REM}rem` },
  { mode: "full", label: "Full", detail: "whole column" },
]

/** The widest lane that fits: the thread column minus its side padding, in rem. */
function availableRem(): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
  const column = viewport instanceof HTMLElement ? viewport.clientWidth : window.innerWidth
  // sm:px-12 on each side is 6rem.
  return Math.max(MIN_REM, Math.floor(column / root) - 6)
}

function ChatWidthControl({
  width,
  onChange,
}: {
  width: ChatWidth
  onChange: (width: ChatWidth) => void
}) {
  const [maxRem, setMaxRem] = useState(() => availableRem())
  const position = toSlider(width, maxRem)

  return (
    <Popover.Root onOpenChange={(open) => open && setMaxRem(availableRem())}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Chat width: ${widthLabel(width)}`}
          title={`Chat width: ${widthLabel(width)}`}
          // Below 640px the lane is already the full column.
          className="hidden size-7 items-center justify-center rounded-md text-ink-muted transition-colors outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover active:bg-pressed data-[state=open]:bg-hover data-[state=open]:text-ink sm:flex"
        >
          <Icon name="width" size="text" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Chat width"
          className="z-30 w-64 rounded-lg bg-raised p-1 shadow-float"
        >
          <div className="px-2 py-1 text-2xs text-ink-muted">Chat width</div>
          <div role="radiogroup" aria-label="Preset widths" className="flex flex-col">
            {PRESETS.map((preset) => {
              const selected = width.mode === preset.mode
              return (
                <button
                  key={preset.mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ mode: preset.mode })}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-hover",
                    selected && "bg-pressed",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {selected ? <CheckIcon className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                  <span className="text-xs text-ink-muted tabular">{preset.detail}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-1 flex flex-col gap-1.5 px-2 pt-1.5 pb-2">
            <div className="flex items-center justify-between text-xs">
              <span className={cn(width.mode === "custom" ? "text-ink" : "text-ink-muted")}>Custom</span>
              <span className="text-ink-muted tabular">
                {width.mode === "full" ? "Full" : `${position}rem`}
              </span>
            </div>
            <input
              type="range"
              min={MIN_REM}
              max={maxRem}
              step={1}
              value={position}
              disabled={maxRem <= MIN_REM}
              aria-label="Custom chat width"
              aria-valuetext={position >= maxRem ? "Full" : `${position}rem`}
              onChange={(event) => onChange(fromSlider(Number(event.target.value), maxRem))}
              className="w-full accent-accent"
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ViewerHeader({
  label,
  view,
  onViewChange,
  theme,
  onToggleTheme,
  chatWidth,
  onChatWidthChange,
  sidebarOpen,
  onOpenSidebar,
}: {
  label: ScopeLabel | null
  view: "channel" | "all"
  onViewChange: (view: "channel" | "all") => void
  theme: "light" | "dark"
  onToggleTheme: () => void
  chatWidth: ChatWidth
  onChatWidthChange: (width: ChatWidth) => void
  sidebarOpen: boolean
  onOpenSidebar: () => void
}) {
  return (
    // The console's top bar is 44px (h-11) and carries the sidebar reopen button while the sidebar is closed.
    <header className="flex h-11 shrink-0 items-center gap-3 px-3 sm:px-4" data-testid="top-bar">
      {sidebarOpen ? null : (
        <IconButton data-testid="sidebar-reopen" icon="sidebar" label="Open sidebar" shortcut={modShortcut("B")} aria-expanded={false} onClick={onOpenSidebar} />
      )}
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
        {view === "channel" ? <ChatWidthControl width={chatWidth} onChange={onChatWidthChange} /> : null}
        <IconButton
          icon={theme === "dark" ? "sun" : "moon"}
          label={theme === "dark" ? "Light theme" : "Dark theme"}
          aria-pressed={theme === "dark"}
          onClick={onToggleTheme}
        />
      </div>
    </header>
  )
}
