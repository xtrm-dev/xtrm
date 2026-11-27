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
  if (palette === "desktop") return "Dark theme, with soft text. In the light theme it uses the Threads colours."
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

/** Sets the root attributes for a preset; styles.css swaps the variables. No re-render, no reload. */
export function applyPalette(palette: Palette, root: HTMLElement = document.documentElement): void {
  applyColours(PRESETS[palette], root)
}

/*
 * Independent colours (operator, 2026-11-26): the sidebar plane, the chat planes and the text tone are set
 * separately; the five palettes above stay as presets that set all three at once. Root attributes:
 * data-palette = the chat palette (canvas, composer, panels, code, popovers: every region except the sidebar),
 * data-sidebar = the sidebar plane, which wins over the chat palette for the sidebar fill and its selected row,
 * data-text = "soft" for the soft text layer (Desktop's text colours), absent for standard text.
 */
export type Plane = PaletteBase
export type TextTone = "standard" | "soft"
export interface Colours {
  sidebar: Plane
  chat: Plane
  text: TextTone
}

export const PLANES: readonly Plane[] = ["threads", "console", "desktop"]
export const TEXT_TONES: readonly TextTone[] = ["standard", "soft"]
export const COLOURS_KEY = "pi-viewer-colours"

/** Every preset as its three settings. Desktop reads in soft text, as it always has. */
export const PRESETS: Record<Palette, Colours> = {
  threads: { sidebar: "threads", chat: "threads", text: "standard" },
  "threads-soft": { sidebar: "threads", chat: "threads", text: "soft" },
  console: { sidebar: "console", chat: "console", text: "standard" },
  "console-soft": { sidebar: "console", chat: "console", text: "soft" },
  desktop: { sidebar: "desktop", chat: "desktop", text: "soft" },
}

const PLANE_LABELS: Record<Plane, string> = { threads: "Threads", console: "Console", desktop: "Desktop" }
const TEXT_LABELS: Record<TextTone, string> = { standard: "Standard", soft: "Soft" }

export function planeLabel(plane: Plane): string {
  return PLANE_LABELS[plane]
}

export function textToneLabel(tone: TextTone): string {
  return TEXT_LABELS[tone]
}

/** The preset these settings equal, or null for a custom mix. */
export function presetOf(colours: Colours): Palette | null {
  return (
    PALETTES.find((palette) => {
      const preset = PRESETS[palette]
      return preset.sidebar === colours.sidebar && preset.chat === colours.chat && preset.text === colours.text
    }) ?? null
  )
}

/** A label for the current settings: the preset's name, or "Custom". */
export function coloursLabel(colours: Colours): string {
  const preset = presetOf(colours)
  return preset ? paletteLabel(preset) : "Custom"
}

export function parseColours(value: unknown): Colours | null {
  if (!value || typeof value !== "object") return null
  const { sidebar, chat, text } = value as Record<string, unknown>
  if (!PLANES.includes(sidebar as Plane) || !PLANES.includes(chat as Plane) || !TEXT_TONES.includes(text as TextTone)) return null
  return { sidebar: sidebar as Plane, chat: chat as Plane, text: text as TextTone }
}

/** The saved settings; a viewer that only ever saved a preset gets that preset's settings. */
export function loadColours(): Colours {
  try {
    const raw = window.localStorage.getItem(COLOURS_KEY)
    const parsed = raw ? parseColours(JSON.parse(raw)) : null
    if (parsed) return parsed
  } catch {
    // Unreadable or blocked: fall back to the preset key below.
  }
  return { ...PRESETS[loadPalette()] }
}

export function saveColours(colours: Colours): void {
  try {
    window.localStorage.setItem(COLOURS_KEY, JSON.stringify(colours))
    // Keep the preset key meaningful for older builds and for the boot script's fallback.
    const preset = presetOf(colours)
    if (preset) window.localStorage.setItem(PALETTE_KEY, preset)
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

export function applyColours(colours: Colours, root: HTMLElement = document.documentElement): void {
  root.dataset.palette = colours.chat
  root.dataset.sidebar = colours.sidebar
  if (colours.text === "soft") root.dataset.text = "soft"
  else delete root.dataset.text
}
