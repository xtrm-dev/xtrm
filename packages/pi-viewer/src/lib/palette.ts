/**
 * Colours setting (XTRM-1046): which background palette the viewer wears.
 * "threads" is the viewer's own look; "console" applies the console's region assignments and
 * values; "desktop" (XTRM-1051) applies the operator's Claude Desktop dark values, with a dimmer reading
 * colour (see the token tables in docs/design/palette-console.md). "threads-soft" and "console-soft"
 * (XTRM-1053) are their base with only the text tokens swapped to Desktop's: the root keeps the base's
 * `data-palette` and gains `data-text="soft"`, a text-only layer in styles.css. The choice is read from
 * those root attributes; nothing else in the app knows about it.
 */

export type Palette = "threads" | "threads-soft" | "console" | "console-soft" | "desktop"
/** The palette whose surfaces a choice wears: a soft-text version wears its base's. */
export type PaletteBase = "threads" | "console" | "desktop"

export const DEFAULT_PALETTE: Palette = "threads"
export const PALETTE_KEY = "pi-viewer-palette"
export const PALETTES: readonly Palette[] = ["threads", "threads-soft", "console", "console-soft", "desktop"]

export function parsePalette(value: string | null | undefined): Palette {
  return PALETTES.includes(value as Palette) ? (value as Palette) : DEFAULT_PALETTE
}

/** The root `data-palette` value: the base palette, so a soft version keeps every surface of its base. */
export function paletteBase(palette: Palette): PaletteBase {
  return palette === "threads-soft" ? "threads" : palette === "console-soft" ? "console" : palette
}

/** True for the soft-text versions: a text-only layer (root `data-text="soft"`) over the base palette. */
export function paletteSoft(palette: Palette): boolean {
  return palette === "threads-soft" || palette === "console-soft"
}

const LABELS: Record<Palette, string> = {
  threads: "Threads",
  "threads-soft": "Threads · soft text",
  console: "Console",
  "console-soft": "Console · soft text",
  desktop: "Desktop",
}

export function paletteLabel(palette: Palette): string {
  return LABELS[palette]
}

/** One line under a palette's name in the control, or null when there is nothing to add. */
export function paletteHint(palette: Palette): string | null {
  if (palette === "desktop") return "Dark theme. In the light theme it uses the Threads colours."
  if (paletteSoft(palette)) {
    return `Dark theme: ${paletteBase(palette) === "console" ? "Console" : "Threads"} surfaces with softer text. In the light theme it equals ${paletteBase(palette) === "console" ? "Console" : "Threads"}.`
  }
  return null
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
  root.dataset.palette = paletteBase(palette)
  if (paletteSoft(palette)) root.dataset.text = "soft"
  else delete root.dataset.text
}
