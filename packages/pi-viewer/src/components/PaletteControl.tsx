import { CheckIcon, PaletteIcon } from "lucide-react"
import { Popover } from "radix-ui"
import { useLayoutEffect, useState } from "react"

import { PALETTES, applyPalette, loadPalette, paletteLabel, savePalette, type Palette } from "@/lib/palette"
import { cn } from "@/lib/utils"

/**
 * Header control for the Colours setting (XTRM-1046): "Colours: Threads | Console". It owns its
 * state and writes the root `data-palette` attribute, so switching is instant and leaves the
 * scroll position alone. The glyph is 16px, the console's `sm` step.
 */
export function PaletteControl() {
  const [palette, setPalette] = useState<Palette>(() => loadPalette())

  useLayoutEffect(() => {
    applyPalette(palette)
  }, [palette])

  function choose(next: Palette) {
    setPalette(next)
    savePalette(next)
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Colours: ${paletteLabel(palette)}`}
          title={`Colours: ${paletteLabel(palette)}`}
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
          className="z-30 w-56 rounded-lg bg-raised p-1 shadow-float"
        >
          <div className="px-2 py-1 text-2xs text-ink-muted">Colours</div>
          <div role="radiogroup" aria-label="Colours" className="flex flex-col">
            {PALETTES.map((value) => {
              const selected = palette === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => choose(value)}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-hover",
                    selected && "bg-pressed",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {selected ? <CheckIcon className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{paletteLabel(value)}</span>
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
