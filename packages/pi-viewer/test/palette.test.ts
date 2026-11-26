import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { COLOURS_KEY, DEFAULT_PALETTE, PALETTES, PALETTE_KEY, PRESETS, applyColours, applyPalette, coloursLabel, loadColours, loadPalette, paletteBase, paletteHint, paletteLabel, paletteSoft, parseColours, parsePalette, presetOf, saveColours, savePalette } from "../src/lib/palette.ts"

function fakeWindow(initial: Record<string, string> = {}, blocked = false) {
  const store = new Map(Object.entries(initial))
  const storage = {
    getItem: (key: string) => {
      if (blocked) throw new Error("blocked")
      return store.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("blocked")
      store.set(key, value)
    },
  }
  return { store, install: () => Object.assign(globalThis, { window: { localStorage: storage } }) }
}

test("Threads is the default; only the exact values 'console' and 'desktop' select another palette", () => {
  assert.equal(DEFAULT_PALETTE, "threads")
  assert.equal(parsePalette(null), "threads")
  assert.equal(parsePalette(undefined), "threads")
  assert.equal(parsePalette(""), "threads")
  assert.equal(parsePalette("Console"), "threads")
  assert.equal(parsePalette("console"), "console")
  assert.equal(parsePalette("desktop"), "desktop")
  assert.equal(parsePalette("threads-soft"), "threads-soft")
  assert.equal(parsePalette("console-soft"), "console-soft")
  assert.equal(parsePalette("Desktop"), "threads")
  assert.equal(parsePalette("soft"), "threads")
  assert.equal(parsePalette("threads"), "threads")
  assert.deepEqual([...PALETTES], ["threads", "threads-soft", "console", "console-soft", "desktop"])
})

test("labels match the switch wording", () => {
  assert.equal(paletteLabel("threads"), "Threads")
  assert.equal(paletteLabel("console"), "Console")
  assert.equal(paletteLabel("desktop"), "Desktop")
  assert.equal(paletteLabel("threads-soft"), "Threads · soft text")
  assert.equal(paletteLabel("console-soft"), "Console · soft text")
})

test("a soft version wears its base's surfaces and adds the text layer", () => {
  assert.deepEqual(PALETTES.map(paletteBase), ["threads", "threads", "console", "console", "desktop"])
  assert.deepEqual(PALETTES.map(paletteSoft), [false, true, false, true, false])
})

test("Desktop and the soft versions carry a hint that says what the light theme does; no branding in any label", () => {
  assert.equal(paletteHint("threads"), null)
  assert.equal(paletteHint("console"), null)
  assert.match(paletteHint("desktop") ?? "", /light theme it uses the Threads colours/)
  assert.match(paletteHint("threads-soft") ?? "", /light theme it equals Threads/)
  assert.match(paletteHint("console-soft") ?? "", /light theme it equals Console/)
  for (const palette of PALETTES) assert.doesNotMatch(`${paletteLabel(palette)} ${paletteHint(palette) ?? ""}`, /claude|anthropic/i)
})

test("a saved choice round-trips through storage", () => {
  const fake = fakeWindow()
  fake.install()
  assert.equal(loadPalette(), "threads")
  savePalette("console")
  assert.equal(fake.store.get(PALETTE_KEY), "console")
  assert.equal(loadPalette(), "console")
  savePalette("desktop")
  assert.equal(loadPalette(), "desktop")
  savePalette("console-soft")
  assert.equal(loadPalette(), "console-soft")
  savePalette("threads")
  assert.equal(loadPalette(), "threads")
})

test("blocked storage neither throws nor changes the default", () => {
  fakeWindow({}, true).install()
  assert.equal(loadPalette(), "threads")
  assert.doesNotThrow(() => savePalette("console"))
})

test("applyPalette writes the root attribute", () => {
  const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
  applyPalette("console", root)
  assert.equal(root.dataset.palette, "console")
  applyPalette("threads", root)
  assert.equal(root.dataset.palette, "threads")
  assert.equal(root.dataset.text, undefined)
})

test("a soft version keeps the base on data-palette and adds data-text=soft; a standard-text choice removes it", () => {
  const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
  applyPalette("console-soft", root)
  assert.equal(root.dataset.palette, "console")
  assert.equal(root.dataset.text, "soft")
  applyPalette("threads-soft", root)
  assert.equal(root.dataset.palette, "threads")
  assert.equal(root.dataset.text, "soft")
  applyPalette("desktop", root)
  assert.equal(root.dataset.palette, "desktop")
  assert.equal(root.dataset.sidebar, "desktop")
  assert.equal(root.dataset.text, "soft", "Desktop reads in soft text, now as the independent text layer")
  applyPalette("console", root)
  assert.equal(root.dataset.text, undefined)
})

// The soft-text versions are a text-only layer over their base (XTRM-1053). These tests read styles.css the
// way the cascade does and prove the layer cannot change a surface, border, accent or any other non-text token.
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8")

function block(selector: string): string {
  const start = css.indexOf(selector)
  assert.ok(start >= 0, `no block ${selector}`)
  const open = css.indexOf("{", start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1
    if (css[i] === "}") {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unclosed ${selector}`)
}

function tokens(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of text.matchAll(/--x-([\w-]+):\s*([^;]+);/g)) out[match[1]] = match[2].replace(/\/\*.*?\*\//g, "").trim()
  return out
}

/** The only variables a soft-text layer may set: Desktop's text roles. */
const TEXT = ["ink", "read", "ink-muted", "ink-muted-selected"]

const threadsLight = tokens(block(":root {"))
const dark = tokens(block(':root[data-theme="dark"]'))
const consoleAll = tokens(block(':root[data-palette="console"] {'))
const consoleDark = tokens(block(':root[data-palette="console"][data-theme="dark"]'))
const desktopDark = tokens(block(':root[data-palette="desktop"][data-theme="dark"] {'))
const layer = tokens(block(':root[data-text="soft"][data-theme="dark"] {'))
const threadsDark = { ...threadsLight, ...dark }
const consoleDarkSet = { ...threadsLight, ...dark, ...consoleAll, ...consoleDark }

function differing(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => a[key] !== b[key]).sort()
}

test("the soft-text layer sets text variables only", () => {
  assert.deepEqual(Object.keys(layer).sort(), [...TEXT].sort())
  // Every rule that names data-text sets only text variables, and only in the dark theme.
  const rules = [...css.matchAll(/([^{}]*data-text="soft"[^{}]*)\{([^{}]*)\}/g)]
  assert.ok(rules.length >= 1)
  for (const [, selector, body] of rules) {
    assert.match(selector, /\[data-theme="dark"\]/, "a soft rule must be dark only")
    assert.doesNotMatch(selector, /aria-selected/, "a soft rule must not restyle selected rows")
    for (const name of Object.keys(tokens(body))) assert.ok(TEXT.includes(name), `soft layer sets non-text variable --x-${name}`)
  }
})

test("each soft version differs from its base only in text variables", () => {
  const cases: [string, Record<string, string>][] = [
    ["threads", threadsDark],
    ["console", consoleDarkSet],
  ]
  for (const [name, base] of cases) {
    const soft = { ...base, ...layer }
    const changed = differing(base, soft)
    assert.ok(changed.length > 0, `${name}: the layer changes something`)
    for (const key of changed) assert.ok(TEXT.includes(key), `${name}-soft changes non-text variable --x-${key}`)
    // Every non-text variable is byte-identical, including the ones that reference others.
    for (const key of Object.keys(base).filter((key) => !TEXT.includes(key))) assert.equal(soft[key], base[key], `--x-${key}`)
    assert.deepEqual(Object.keys(soft).sort(), [...new Set([...Object.keys(base), ...TEXT])].sort())
  }
})

test("in the light theme a soft version equals its base: no light rule names the layer", () => {
  assert.doesNotMatch(css, /data-text="soft"\](?!\[data-theme="dark"\])/)
  assert.doesNotMatch(css, /data-text="soft"\]\[data-theme="light"\]/)
})

test("the soft text values are Desktop's text set and Desktop's surfaces are unchanged", () => {
  assert.deepEqual(layer, { ink: "#e4e4e4", read: "#c8c8c8", "ink-muted": "#a1a1a1", "ink-muted-selected": "#c8c8c8" })
  // Desktop wears the same layer through its preset (text: soft), so its text equals the soft versions'; the
  // layer is no longer tied to the Desktop palette, so Desktop surfaces can read in standard text too.
  assert.equal(PRESETS.desktop.text, "soft")
  assert.doesNotMatch(css, /:root\[data-palette="desktop"\]\[data-theme="dark"\],\s*:root\[data-text="soft"\]/)
  assert.deepEqual(desktopDark, {
    deep: "#1f1f1f",
    sidebar: "#242424",
    surface: "#333333",
    raised: "#333333",
    control: "#383838",
    segment: "#454545",
    selected: "#454545",
    border: "#383838",
    danger: "#f58f8f",
    "composer-focus": "var(--x-control)",
    code: "var(--x-deep)",
    "code-edge": "var(--x-border)",
  })
  assert.deepEqual(differing(threadsDark, { ...threadsDark, ...layer }).sort(), ["ink", "ink-muted", "ink-muted-selected", "read"].sort())
})


test("every preset maps to its three settings, and the mapping round-trips", () => {
  for (const palette of PALETTES) assert.equal(presetOf(PRESETS[palette]), palette)
  assert.deepEqual(PRESETS.desktop, { sidebar: "desktop", chat: "desktop", text: "soft" })
  assert.deepEqual(PRESETS["console-soft"], { sidebar: "console", chat: "console", text: "soft" })
})

test("a mix that matches no preset is Custom", () => {
  const mix = { sidebar: "console", chat: "desktop", text: "standard" } as const
  assert.equal(presetOf(mix), null)
  assert.equal(coloursLabel(mix), "Custom")
  assert.equal(coloursLabel(PRESETS.threads), "Threads")
})

test("applyColours writes the three root attributes independently", () => {
  const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
  applyColours({ sidebar: "console", chat: "desktop", text: "standard" }, root)
  assert.equal(root.dataset.sidebar, "console")
  assert.equal(root.dataset.palette, "desktop")
  assert.equal(root.dataset.text, undefined)
  applyColours({ sidebar: "threads", chat: "threads", text: "soft" }, root)
  assert.equal(root.dataset.text, "soft")
})

test("parseColours accepts only known values", () => {
  assert.deepEqual(parseColours({ sidebar: "desktop", chat: "console", text: "soft" }), { sidebar: "desktop", chat: "console", text: "soft" })
  assert.equal(parseColours({ sidebar: "Desktop", chat: "console", text: "soft" }), null)
  assert.equal(parseColours({ sidebar: "desktop", chat: "console" }), null)
  assert.equal(parseColours(null), null)
  assert.equal(parseColours("threads"), null)
})

test("colours round-trip through storage; an older preset-only save loads as that preset; a preset mix also writes the preset key", () => {
  const legacy = fakeWindow({ [PALETTE_KEY]: "console-soft" })
  legacy.install()
  assert.deepEqual(loadColours(), PRESETS["console-soft"])

  const fake = fakeWindow()
  fake.install()
  assert.deepEqual(loadColours(), PRESETS.threads)
  saveColours({ sidebar: "desktop", chat: "threads", text: "soft" })
  assert.deepEqual(loadColours(), { sidebar: "desktop", chat: "threads", text: "soft" })
  assert.equal(fake.store.get(PALETTE_KEY), undefined, "a custom mix leaves the preset key alone")
  saveColours({ ...PRESETS.console })
  assert.equal(fake.store.get(PALETTE_KEY), "console")
  assert.ok(fake.store.get(COLOURS_KEY)?.includes('"chat":"console"'))

  fakeWindow({ [COLOURS_KEY]: "{not json" }, false).install()
  assert.deepEqual(loadColours(), PRESETS.threads)
})

test("the sidebar plane blocks come after the palettes and set only the sidebar fill and selected row", () => {
  const sidebarStart = css.indexOf(':root[data-sidebar="threads"][data-theme="dark"]')
  assert.ok(sidebarStart > css.indexOf(':root[data-palette="desktop"][data-theme="dark"] {'), "after the Desktop palette")
  assert.ok(sidebarStart > css.indexOf(':root[data-palette="console"][data-theme="dark"]'), "after the Console palette")
  for (const plane of ["threads", "console", "desktop"]) {
    const set = tokens(block(`:root[data-sidebar="${plane}"][data-theme="dark"] {`))
    assert.deepEqual(Object.keys(set).sort(), ["selected", "sidebar"], `${plane}: only the sidebar fill and selected row`)
  }
  assert.equal(tokens(block(':root[data-sidebar="desktop"][data-theme="dark"] {')).sidebar, "#242424")
  assert.equal(tokens(block(':root[data-sidebar="console"][data-theme="dark"] {')).sidebar, "#232323")
  assert.equal(tokens(block(':root[data-sidebar="threads"][data-theme="dark"] {')).sidebar, "#181818")
})
