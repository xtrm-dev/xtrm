// Contrast gate for the transcript text roles (XTRM-1034, audit 1.6), in all five palettes (XTRM-1046,
// XTRM-1051).
// Reads the --x-* tokens from src/styles.css, so a token edit re-runs the proof. The Console palette
// is the Threads set with the :root[data-palette="console"] blocks laid over it, as the cascade does.
// Desktop (dark only) is the Threads dark set with its own block and the soft-text layer over it; Desktop in
// the light theme is the Threads light set, because no Desktop rule matches there. A soft-text version is its
// base plus the soft-text layer in dark, and equals its base in light.
// Since XTRM-1048 it also holds the sidebar's status dot to 3:1 against the sidebar: the dot carries
// the state alone, so its colour is a non-text mark that must stay visible in every palette.
// Usage: node scripts/contrast-check.mjs   (exit 1 when a text pair is below 4.5:1 or a dot below 3:1)
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { SIDEBAR_DOT } from "../src/lib/status-dot.ts"

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8")

function block(selector) {
  const start = css.indexOf(selector)
  const open = css.indexOf("{", start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1
    if (css[i] === "}") {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`block not found: ${selector}`)
}

function tokens(text) {
  const out = {}
  for (const match of text.matchAll(/--x-([\w-]+):\s*([^;]+);/g)) out[match[1]] = match[2].trim().replace(/\/\*.*?\*\//g, "").trim()
  return out
}

const threadsLight = tokens(block(":root {"))
const dark = tokens(block(':root[data-theme="dark"]'))
const consoleAll = tokens(block(':root[data-palette="console"] {'))
const consoleDark = tokens(block(':root[data-palette="console"][data-theme="dark"]'))
const desktopDark = tokens(block(':root[data-palette="desktop"][data-theme="dark"] {'))
// The text-only layer Desktop and the soft-text versions share (XTRM-1053).
const softText = tokens(block(':root[data-text="soft"][data-theme="dark"] {'))
const consoleDarkSet = { ...threadsLight, ...dark, ...consoleAll, ...consoleDark }
const sets = [
  ["threads", "light", threadsLight],
  ["threads", "dark", { ...threadsLight, ...dark }],
  ["threads-soft", "light", threadsLight],
  ["threads-soft", "dark", { ...threadsLight, ...dark, ...softText }],
  ["console", "light", { ...threadsLight, ...consoleAll }],
  ["console", "dark", consoleDarkSet],
  ["console-soft", "light", { ...threadsLight, ...consoleAll }],
  ["console-soft", "dark", { ...consoleDarkSet, ...softText }],
  ["desktop", "light", threadsLight],
  // Desktop alone restyles muted text inside its #454545 selected row (styles.css, [aria-selected]).
  ["desktop", "dark", { ...threadsLight, ...dark, ...desktopDark, ...softText, "muted-selected-rule": "on" }],
]

/** The final value of a token, following var(--x-name) the way the cascade does. */
function value(set, name) {
  let text = set[name]
  for (let guard = 0; guard < 8; guard += 1) {
    const ref = /^var\(--x-([\w-]+)\)$/.exec(text ?? "")
    if (!ref) break
    text = set[ref[1]]
  }
  if (text === undefined) throw new Error(`no token ${name}`)
  return text
}

function parse(value, under) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value)
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4])
    return [1, 2, 3].map((i, n) => Math.round(Number(rgb[i]) * alpha + under[n] * (1 - alpha)))
  }
  throw new Error(`cannot parse ${value}`)
}

function luminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function mix(fg, bg, alpha) {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)))
}

// Transcript text roles and the planes they sit on. The first four planes are the Threads set;
// canvas, sidebar, composer-focus and code are the region roles the palette swaps; inset is the
// quiet panel in the thread, drawn at 40% over the canvas as ActivityDisclosure draws it.
// selected is the sidebar's selected row (the --x-selected wash over the sidebar); track is the segmented
// controls' pressed track (the --x-pressed wash over the canvas).
const planes = ["deep", "surface", "raised", "control", "canvas", "sidebar", "composer-focus", "code", "inset", "selected", "track"]
const roles = [
  { name: "ink (prose 90%)", token: "ink", alpha: 0.9 },
  { name: "ink", token: "ink" },
  { name: "read (thread prose)", token: "read" },
  { name: "ink-muted (tool rows, meta, fold line)", token: "ink-muted" },
  { name: "accent-ink (links)", token: "accent-ink" },
  { name: "danger (failed, errors)", token: "danger" },
]

function plane(set, name) {
  if (name === "inset") {
    const canvas = parse(value(set, "canvas"), [255, 255, 255])
    return mix(parse(value(set, "inset"), canvas), canvas, 0.4)
  }
  if (name === "selected") return parse(value(set, "selected"), parse(value(set, "sidebar"), [255, 255, 255]))
  if (name === "track") return parse(value(set, "pressed"), parse(value(set, "canvas"), [255, 255, 255]))
  return parse(value(set, name), [255, 255, 255])
}

// ink-muted on control is the user bubble and the code toolbar; the others are the canvas and frames.
// Prose is held to 7:1 on the canvas in every palette; muted text to 4.5:1 there (the generic loop).
const PROSE_MIN = 7

let failures = 0
for (const [palette, theme, set] of sets) {
  for (const role of roles) {
    for (const name of planes) {
      // Error text never sits on a control, a selected sidebar row or a segmented track.
      if (role.token === "danger" && ["control", "selected", "track"].includes(name)) continue
      const bg = plane(set, name)
      // Inside a selected row a palette may restyle muted text (Desktop: --x-ink-muted-selected).
      const token = role.token === "ink-muted" && name === "selected" && set["muted-selected-rule"] ? "ink-muted-selected" : role.token
      let fg = parse(value(set, token), bg)
      if (role.alpha) fg = mix(fg, bg, role.alpha)
      const result = ratio(fg, bg)
      const ok = result >= 4.5
      if (!ok) failures += 1
      console.log(`${ok ? "PASS" : "FAIL"} ${palette.padEnd(12)} ${theme.padEnd(5)} ${role.name.padEnd(40)} on ${name.padEnd(14)} ${result.toFixed(2)}`)
    }
  }
  const bg = plane(set, "canvas")
  const prose = ratio(parse(value(set, "read"), bg), bg)
  if (prose < PROSE_MIN) failures += 1
  console.log(`${prose >= PROSE_MIN ? "PASS" : "FAIL"} ${palette.padEnd(12)} ${theme.padEnd(5)} thread prose (read) on canvas, minimum 7:1 ${prose.toFixed(2)}`)
}
// ink-faint is a glyph and heading role only; it must not carry transcript text.
for (const [palette, theme, set] of sets) {
  const bg = plane(set, "canvas")
  console.log(`INFO ${palette.padEnd(12)} ${theme.padEnd(5)} ink-faint (glyphs only, not text) on canvas ${ratio(parse(value(set, "ink-faint"), bg), bg).toFixed(2)}`)
}

/** The token and alpha a dot class paints with; `bg-transparent` means the border draws the ring. */
function paint(classes) {
  const fill = /(?:^|\s)bg-([a-z-]+)(?:\/(\d+))?(?=\s|$)/.exec(classes)
  const ring = /(?:^|\s)border-([a-z-]+)(?:\/(\d+))?(?=\s|$)/.exec(classes)
  const [token, alpha] = fill[1] === "transparent" && ring ? [ring[1], ring[2]] : [fill[1], fill[2]]
  return { token, alpha: alpha === undefined ? 1 : Number(alpha) / 100 }
}

// XTRM-1048: the sidebar's status dot is the only mark of the state (the state word left line 2), so
// each dot colour is checked against the sidebar plane it sits on, at the 3:1 non-text minimum.
let dotFailures = 0
for (const [palette, theme, set] of sets) {
  const bg = plane(set, "sidebar")
  for (const [status, classes] of Object.entries(SIDEBAR_DOT)) {
    const { token, alpha } = paint(classes)
    const fg = mix(parse(value(set, token), bg), bg, alpha)
    const result = ratio(fg, bg)
    if (result < 3) dotFailures += 1
    console.log(`${result >= 3 ? "PASS" : "FAIL"} ${palette.padEnd(12)} ${theme.padEnd(5)} ${("dot " + status).padEnd(40)} on ${"sidebar".padEnd(14)} ${result.toFixed(2)}`)
  }
}

if (failures) {
  console.error(`${failures} pair(s) below 4.5:1`)
}
if (dotFailures) {
  console.error(`${dotFailures} sidebar dot(s) below 3:1`)
}
if (failures || dotFailures) process.exit(1)
console.log(`all transcript text roles >= 4.5:1 (Desktop dark muted text on a selected row reads in --x-ink-muted-selected), prose >= 7:1 on the canvas, and all sidebar status dots >= 3:1, in all five palettes`)
