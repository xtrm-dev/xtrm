import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { SIDEBAR_DOT, SIDEBAR_DOT_SHOWN, STATUS_DOT, STATUS_WORD, sidebarDotLabel } from "../src/lib/status-dot.ts"
import type { AgentStatus } from "../src/shared/types.ts"

const STATUSES: AgentStatus[] = ["working", "attention", "quiet", "waiting", "error", "idle", "unknown"]

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8")

/** The declarations of the first block whose selector starts with `selector`. */
function block(selector: string): string {
  const start = css.indexOf(selector)
  assert.ok(start >= 0, `block not found: ${selector}`)
  const open = css.indexOf("{", start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1
    if (css[i] === "}") {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  assert.fail(`unclosed block: ${selector}`)
}

function tokens(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of text.matchAll(/--x-([\w-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].replace(/\/\*.*?\*\//g, "").trim()
  }
  return out
}

const threadsLight = tokens(block(":root {"))
const dark = tokens(block(':root[data-theme="dark"]'))
const consoleLight = tokens(block(':root[data-palette="console"] {'))
const consoleDark = tokens(block(':root[data-palette="console"][data-theme="dark"]'))
const sets: Array<[string, string, Record<string, string>]> = [
  ["threads", "light", threadsLight],
  ["threads", "dark", { ...threadsLight, ...dark }],
  ["console", "light", { ...threadsLight, ...consoleLight }],
  ["console", "dark", { ...threadsLight, ...dark, ...consoleLight, ...consoleDark }],
]

function value(set: Record<string, string>, name: string): string {
  let text = set[name]
  for (let guard = 0; guard < 8; guard += 1) {
    const ref = /^var\(--x-([\w-]+)\)$/.exec(text ?? "")
    if (!ref) break
    text = set[ref[1]]
  }
  assert.ok(text, `no token ${name}`)
  return text
}

function rgb(set: Record<string, string>, name: string): number[] {
  const text = value(set, name)
  const hex = /^#([0-9a-f]{6})$/i.exec(text)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
  const short = /^#([0-9a-f]{3})$/i.exec(text)
  if (short) return [0, 1, 2].map((i) => parseInt(short[1][i] + short[1][i], 16))
  const parts = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(text)
  assert.ok(parts, `cannot parse ${text}`)
  return [1, 2, 3].map((i) => Number(parts[i]))
}

function luminance(colour: number[]): number {
  const lin = colour.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function ratio(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The token, alpha and paint kind a Tailwind class draws the dot with (`bg-transparent` is a ring). */
function paint(classes: string): { token: string; alpha: number } {
  const fill = /(?:^|\s)bg-([a-z-]+)(?:\/(\d+))?(?=\s|$)/.exec(classes)
  assert.ok(fill, `no bg-* class in ${classes}`)
  const ring = /(?:^|\s)border-([a-z-]+)(?:\/(\d+))?(?=\s|$)/.exec(classes)
  const [token, alpha] = fill[1] === "transparent" && ring ? [ring[1], ring[2]] : [fill[1], fill[2]]
  return { token, alpha: alpha === undefined ? 1 : Number(alpha) / 100 }
}

test("each state keeps the shared dot's colour and animation", () => {
  assert.deepEqual(STATUS_DOT, {
    working: "bg-accent viewer-pulse",
    attention: "bg-accent",
    quiet: "bg-ink-faint",
    waiting: "bg-success",
    error: "bg-danger",
    idle: "bg-ink-faint/50",
    unknown: "bg-ink-faint/30",
  })
  assert.deepEqual(Object.keys(STATUS_DOT).sort(), [...STATUSES].sort())
  assert.deepEqual(Object.keys(STATUS_WORD).sort(), [...STATUSES].sort())
})

test("the sidebar dot: one class and one label per state", () => {
  assert.deepEqual(SIDEBAR_DOT, {
    working: "bg-accent viewer-pulse",
    attention: "bg-accent viewer-fade",
    quiet: "bg-ink-muted",
    waiting: "bg-ink-muted/75",
    error: "bg-danger",
    idle: "bg-ink-muted/75",
    unknown: "border border-ink-muted/75 bg-transparent",
  })
  assert.deepEqual(Object.keys(SIDEBAR_DOT).sort(), [...STATUSES].sort())
  // XTRM-1058: the sidebar draws no dot for idle, and waiting reads as idle.
  assert.deepEqual(SIDEBAR_DOT_SHOWN, {
    working: true,
    attention: true,
    quiet: true,
    waiting: false,
    error: true,
    idle: false,
    unknown: true,
  })
  assert.deepEqual(Object.keys(SIDEBAR_DOT_SHOWN).sort(), [...STATUSES].sort())
  assert.equal(sidebarDotLabel("working"), "Working")
  assert.equal(sidebarDotLabel("attention"), "Needs you")
  assert.equal(sidebarDotLabel("waiting"), "Waiting")
  assert.equal(sidebarDotLabel("error"), "Failed")
  assert.equal(sidebarDotLabel("idle"), "Idle")
  assert.equal(sidebarDotLabel("unknown"), "Unknown")
  assert.equal(sidebarDotLabel("quiet"), "Quiet")
  assert.equal(sidebarDotLabel("quiet", "no output for 16m"), "Quiet 16m")
})

test("every sidebar dot is >= 3:1 against the sidebar in both palettes and themes", () => {
  // SUCCESS (5): the non-text minimum, measured from the CSS tokens the classes resolve to.
  for (const [palette, theme, set] of sets) {
    const plane = rgb(set, "sidebar")
    for (const status of STATUSES) {
      const { token, alpha } = paint(SIDEBAR_DOT[status])
      const colour = rgb(set, token)
      const drawn = colour.map((v, i) => Math.round(v * alpha + plane[i] * (1 - alpha)))
      const result = ratio(drawn, plane)
      assert.ok(result >= 3, `${status} dot on ${palette} ${theme} sidebar: ${result.toFixed(2)}:1`)
    }
  }
})

test("the sidebar's dot animations stop under prefers-reduced-motion", () => {
  // SUCCESS (4): the colour still distinguishes the state; only the motion goes.
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n")
  for (const status of STATUSES) {
    for (const animation of SIDEBAR_DOT[status].split(" ").filter((name) => name === "viewer-pulse" || name === "viewer-fade")) {
      assert.match(reduced, new RegExp(`\\.${animation} \\{ animation: none; opacity: 1; \\}`), `${animation} has no reduced-motion branch`)
    }
  }
})
