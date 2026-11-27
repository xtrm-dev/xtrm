import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  DEFAULT_WIDTH,
  MAX_STORED_REM,
  fromSlider,
  laneValue,
  parse,
  serialize,
  toSlider,
  widthLabel,
  type ChatWidth,
} from "../src/lib/chat-width.ts"

test("chat width: preset values", () => {
  assert.equal(laneValue({ mode: "comfortable" }), "46rem")
  assert.equal(laneValue({ mode: "wide" }), "72rem")
  assert.equal(laneValue({ mode: "full" }), "100%")
  assert.equal(laneValue({ mode: "custom", rem: 54 }), "54rem")
  assert.deepEqual(DEFAULT_WIDTH, { mode: "comfortable" })
})

test("chat width: custom clamps to 36rem and becomes Full at the slider maximum", () => {
  assert.deepEqual(fromSlider(20, 100), { mode: "custom", rem: 36 })
  assert.deepEqual(fromSlider(36, 100), { mode: "custom", rem: 36 })
  assert.deepEqual(fromSlider(60.4, 100), { mode: "custom", rem: 60 })
  assert.deepEqual(fromSlider(100, 100), { mode: "full" })
  assert.deepEqual(fromSlider(250, 100), { mode: "full" })
  assert.deepEqual(fromSlider(Number.NaN, 100), DEFAULT_WIDTH)
  // A viewport narrower than the minimum still yields a valid range.
  assert.deepEqual(fromSlider(40, 30), { mode: "full" })
})

test("chat width: slider position round trip", () => {
  assert.equal(toSlider({ mode: "full" }, 100), 100)
  assert.equal(toSlider({ mode: "comfortable" }, 100), 46)
  assert.equal(toSlider({ mode: "wide" }, 60), 60)
  assert.equal(toSlider({ mode: "custom", rem: 50 }, 100), 50)
  assert.equal(toSlider({ mode: "custom", rem: 500 }, 100), 100)
})

test("chat width: persistence round trip for every mode", () => {
  const widths: ChatWidth[] = [
    { mode: "comfortable" },
    { mode: "wide" },
    { mode: "full" },
    { mode: "custom", rem: 52 },
  ]
  for (const width of widths) assert.deepEqual(parse(serialize(width)), width)
})

test("chat width: invalid stored values fall back to Comfortable", () => {
  for (const raw of [null, undefined, "", "huge", "custom", "custom:", "custom:abc", "custom:-4", "custom:1.5", "wide ", "WIDE", "custom:99999", "custom:9999"]) {
    const result = parse(raw as string | null | undefined)
    if (raw === "custom:9999") assert.deepEqual(result, { mode: "full" })
    else assert.deepEqual(result, DEFAULT_WIDTH, `value ${String(raw)}`)
  }
})

test("chat width: a stored custom value is clamped on load", () => {
  assert.deepEqual(parse("custom:10"), { mode: "custom", rem: 36 })
  assert.deepEqual(parse(`custom:${MAX_STORED_REM}`), { mode: "full" })
})

test("chat width: labels", () => {
  assert.equal(widthLabel({ mode: "comfortable" }), "Comfortable")
  assert.equal(widthLabel({ mode: "custom", rem: 60 }), "60rem")
})
