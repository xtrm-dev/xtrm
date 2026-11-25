// Contrast gate for the transcript text roles (XTRM-1034, audit 1.6).
// Reads the --x-* tokens from src/styles.css, so a token edit re-runs the proof.
// Usage: node scripts/contrast-check.mjs   (exit 1 when a text pair is below 4.5:1)
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

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

const light = tokens(block(":root {"))
const dark = { ...light, ...tokens(block(':root[data-theme="dark"]')) }

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

// Transcript text roles and the planes they sit on.
const planes = ["deep", "surface", "raised", "control"]
const roles = [
  { name: "ink (prose 90%)", token: "ink", alpha: 0.9 },
  { name: "ink", token: "ink" },
  { name: "ink-muted (tool rows, meta, fold line)", token: "ink-muted" },
  { name: "accent-ink (links)", token: "accent-ink" },
  { name: "danger (failed, errors)", token: "danger" },
]
// ink-muted on control is the user bubble and the code toolbar; the others are the canvas and frames.
let failures = 0
for (const [theme, set] of [["light", light], ["dark", dark]]) {
  for (const role of roles) {
    for (const plane of planes) {
      if (role.token === "danger" && plane === "control") continue
      const bg = parse(set[plane], [255, 255, 255])
      let fg = parse(set[role.token], bg)
      if (role.alpha) fg = mix(fg, bg, role.alpha)
      const value = ratio(fg, bg)
      const ok = value >= 4.5
      if (!ok) failures += 1
      console.log(`${ok ? "PASS" : "FAIL"} ${theme.padEnd(5)} ${role.name.padEnd(40)} on ${plane.padEnd(8)} ${value.toFixed(2)}`)
    }
  }
}
// ink-faint is a glyph and heading role only; it must not carry transcript text.
for (const [theme, set] of [["light", light], ["dark", dark]]) {
  const bg = parse(set.deep, [255, 255, 255])
  console.log(`INFO ${theme.padEnd(5)} ink-faint (glyphs only, not text) on deep ${ratio(parse(set["ink-faint"], bg), bg).toFixed(2)}`)
}
if (failures) {
  console.error(`${failures} pair(s) below 4.5:1`)
  process.exit(1)
}
console.log("all transcript text roles >= 4.5:1")
