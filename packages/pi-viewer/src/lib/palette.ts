/**
 * Colours setting (XTRM-1046): which background palette the viewer wears.
 * "threads" is the viewer's own look; "console" applies the console's region assignments and
 * values; "desktop" (XTRM-1051) applies the operator's Claude Desktop dark values, with a dimmer reading
 * colour (see the token tables in docs/design/palette-console.md). The choice is a root
 * `data-palette` attribute that styles.css reads; nothing else in the app knows about it.
 */

export type Palette = "threads" | "console" | "desktop"

export const DEFAULT_PALETTE: Palette = "threads"
export const PALETTE_KEY = "pi-viewer-palette"
export const PALETTES: readonly Palette[] = ["threads", "console", "desktop"]

export function parsePalette(value: string | null | undefined): Palette {
  return value === "console" || value === "desktop" ? value : DEFAULT_PALETTE
}

export function paletteLabel(palette: Palette): string {
  return palette === "console" ? "Console" : palette === "desktop" ? "Desktop" : "Threads"
}

/** One line under a palette's name in the control, or null when there is nothing to add. */
export function paletteHint(palette: Palette): string | null {
  return palette === "desktop" ? "Dark theme. In the light theme it uses the Threads colours." : null
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
