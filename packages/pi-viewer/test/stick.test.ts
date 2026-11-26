import { strict as assert } from "node:assert"
import { test } from "node:test"

import { followMode } from "../src/lib/stick.ts"

test("a send intent forces an instant follow even when the reader is scrolled up", () => {
  assert.equal(
    followMode({ atBottom: false, working: true, reducedMotion: false, sendPending: true }),
    "instant",
  )
  assert.equal(
    followMode({ atBottom: false, working: false, reducedMotion: true, sendPending: true }),
    "instant",
  )
})

test("without a send intent the reader's position still wins", () => {
  assert.equal(followMode({ atBottom: false, working: false, reducedMotion: false }), "none")
  assert.equal(followMode({ atBottom: true, working: true, reducedMotion: false }), "smooth")
})
