import assert from "node:assert/strict"
import { test } from "node:test"

import { DEFAULT_PALETTE, PALETTES, PALETTE_KEY, applyPalette, loadPalette, paletteHint, paletteLabel, parsePalette, savePalette } from "../src/lib/palette.ts"

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
  assert.equal(parsePalette("Desktop"), "threads")
  assert.equal(parsePalette("threads"), "threads")
  assert.deepEqual([...PALETTES], ["threads", "console", "desktop"])
})

test("labels match the switch wording", () => {
  assert.equal(paletteLabel("threads"), "Threads")
  assert.equal(paletteLabel("console"), "Console")
  assert.equal(paletteLabel("desktop"), "Desktop")
})

test("only Desktop carries a hint, and it says the light theme uses Threads; no branding in any label", () => {
  assert.equal(paletteHint("threads"), null)
  assert.equal(paletteHint("console"), null)
  assert.match(paletteHint("desktop") ?? "", /light theme it uses the Threads colours/)
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
})
