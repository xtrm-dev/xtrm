import { CheckIcon, PaletteIcon } from "lucide-react"
import { Popover } from "radix-ui"
import { useLayoutEffect, useState } from "react"

import {
  PALETTES,
  PLANES,
  PRESETS,
  TEXT_TONES,
  applyColours,
  coloursLabel,
  loadColours,
  paletteHint,
  paletteLabel,
  planeLabel,
  presetOf,
  saveColours,
  textToneLabel,
  type Colours,
} from "@/lib/palette"
import { cn } from "@/lib/utils"

/**
 * Header control for the Colours setting (XTRM-1046). The five palettes are presets; under them the sidebar
 * plane, the chat planes and the text tone can be set independently (operator, 2026-11-26), and a mix that
 * matches no preset reads "Custom". It owns its state and writes root attributes (data-sidebar,
 * data-palette, data-text), so switching is instant and leaves the scroll position alone.
 */
export function PaletteControl() {
  const [colours, setColours] = useState<Colours>(() => loadColours())

  useLayoutEffect(() => {
    applyColours(colours)
  }, [colours])

  function choose(next: Colours) {
    setColours(next)
    saveColours(next)
  }

  const preset = presetOf(colours)
  const label = coloursLabel(colours)

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Colours: ${label}`}
          title={`Colours: ${label}`}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover active:bg-pressed data-[state=open]:bg-hover data-[state=open]:text-ink"
        >
          <PaletteIcon className="size-4" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-label="Colours"
          className="z-30 w-64 rounded-lg bg-raised p-1 shadow-float"
        >
          <div className="px-2 py-1 text-2xs text-ink-muted">Colours</div>
          <div role="radiogroup" aria-label="Colours" className="flex flex-col">
            {PALETTES.map((value) => {
              const selected = preset === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={paletteHint(value) ?? undefined}
                  onClick={() => choose({ ...PRESETS[value] })}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-hover",
                    selected && "bg-pressed",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {selected ? <CheckIcon className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{paletteLabel(value)}</span>
                  {paletteHint(value) ? (
                    <span className="shrink-0 text-2xs text-ink-muted" aria-hidden>
                      dark only
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="mx-2 my-1 h-px bg-border-muted" aria-hidden />

          <div data-colours-custom="" className="flex flex-col gap-2 px-2 pt-1 pb-2">
            <div className="flex items-center justify-between text-2xs text-ink-muted">
              <span>Mix</span>
              {preset ? null : <span className="font-medium text-ink">Custom</span>}
            </div>
            <Segmented
              label="Sidebar"
              options={PLANES}
              value={colours.sidebar}
              format={planeLabel}
              onChange={(sidebar) => choose({ ...colours, sidebar })}
            />
            <Segmented
              label="Chat"
              options={PLANES}
              value={colours.chat}
              format={planeLabel}
              onChange={(chat) => choose({ ...colours, chat })}
            />
            <Segmented
              label="Text"
              options={TEXT_TONES}
              value={colours.text}
              format={textToneLabel}
              onChange={(text) => choose({ ...colours, text })}
            />
            <p className="text-2xs text-ink-muted">Desktop and Soft change the dark theme only.</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** One row of the mix: a label and a segmented radio group, keyboard operable with the arrow keys. */
function Segmented<T extends string>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  format: (option: T) => string
  onChange: (option: T) => void
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = options[(options.indexOf(value) + step + options.length) % options.length]
    onChange(next)
    const group = event.currentTarget
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-ink-muted">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 rounded-md bg-control p-0.5"
      >
        {options.map((option) => {
          const selected = option === value
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option)}
              className={cn(
                "h-6 min-w-0 flex-1 truncate rounded-[5px] px-1.5 text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-border-strong",
                selected ? "bg-segment text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {format(option)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
