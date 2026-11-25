/**
 * Colours setting (XTRM-1046): which background palette the viewer wears.
 * "threads" is the viewer's own look; "console" applies the console's region assignments and
 * values (see the token table in docs/design/palette-console.md). The choice is a root
 * `data-palette` attribute that styles.css reads; nothing else in the app knows about it.
 */

export type Palette = "threads" | "console"

export const DEFAULT_PALETTE: Palette = "threads"
export const PALETTE_KEY = "pi-viewer-palette"
export const PALETTES: readonly Palette[] = ["threads", "console"]

export function parsePalette(value: string | null | undefined): Palette {
  return value === "console" ? "console" : DEFAULT_PALETTE
}

export function paletteLabel(palette: Palette): string {
  return palette === "console" ? "Console" : "Threads"
}

export function loadPalette(): Palette {
  try {
    return parsePalette(window.localStorage.getItem(PALETTE_KEY))
  } catch {
    return DEFAULT_PALETTE
  }
}

export function savePalette(palette: Palette): void {
  try {
    window.localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

/** Sets the root attribute; styles.css swaps the variables. No re-render, no reload. */
export function applyPalette(palette: Palette, root: HTMLElement = document.documentElement): void {
  root.dataset.palette = palette
}
