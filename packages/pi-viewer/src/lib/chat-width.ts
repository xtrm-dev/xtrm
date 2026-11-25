/**
 * The chat lane width setting (XTRM-1042, audit goodie 18). One value, applied as the CSS
 * variable `--chat-lane` on the root, drives the thread lane, the composer and the presence line.
 * Presets: Comfortable 46rem (default), Wide 72rem, Full. Custom runs from 36rem up to Full.
 */
export type ChatWidth =
  | { mode: "comfortable" }
  | { mode: "wide" }
  | { mode: "full" }
  | { mode: "custom"; rem: number }

export const COMFORTABLE_REM = 46
export const WIDE_REM = 72
export const MIN_REM = 36
/** A stored custom value above this is treated as Full: nothing larger fits a screen. */
export const MAX_STORED_REM = 400

export const DEFAULT_WIDTH: ChatWidth = { mode: "comfortable" }
export const STORAGE_KEY = "pi-viewer-chat-width"

/** The value of `--chat-lane`. Full is `100%`: the lane fills its column minus the side padding. */
export function laneValue(width: ChatWidth): string {
  switch (width.mode) {
    case "comfortable":
      return `${COMFORTABLE_REM}rem`
    case "wide":
      return `${WIDE_REM}rem`
    case "full":
      return "100%"
    case "custom":
      return `${width.rem}rem`
  }
}

/** Clamp a custom width to 36rem..`maxRem`; a value at or above `maxRem` is Full. */
export function fromSlider(rem: number, maxRem: number): ChatWidth {
  const max = Math.max(MIN_REM, maxRem)
  if (!Number.isFinite(rem)) return DEFAULT_WIDTH
  if (rem >= max) return { mode: "full" }
  return { mode: "custom", rem: Math.max(MIN_REM, Math.round(rem)) }
}

/** The slider position for a width: Full sits at the right end. */
export function toSlider(width: ChatWidth, maxRem: number): number {
  const max = Math.max(MIN_REM, maxRem)
  switch (width.mode) {
    case "comfortable":
      return Math.min(COMFORTABLE_REM, max)
    case "wide":
      return Math.min(WIDE_REM, max)
    case "full":
      return max
    case "custom":
      return Math.min(Math.max(MIN_REM, width.rem), max)
  }
}

export function serialize(width: ChatWidth): string {
  return width.mode === "custom" ? `custom:${width.rem}` : width.mode
}

/** Anything that is not a known value falls back to Comfortable. */
export function parse(raw: string | null | undefined): ChatWidth {
  if (raw === "comfortable" || raw === "wide" || raw === "full") return { mode: raw }
  const match = /^custom:(\d{1,4})$/.exec(raw ?? "")
  if (!match) return DEFAULT_WIDTH
  const rem = Number(match[1])
  if (rem >= MAX_STORED_REM) return { mode: "full" }
  return { mode: "custom", rem: Math.max(MIN_REM, rem) }
}

export function loadWidth(): ChatWidth {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_WIDTH
  }
}

export function saveWidth(width: ChatWidth): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serialize(width))
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

export function widthLabel(width: ChatWidth): string {
  switch (width.mode) {
    case "comfortable":
      return "Comfortable"
    case "wide":
      return "Wide"
    case "full":
      return "Full"
    case "custom":
      return `${width.rem}rem`
  }
}
