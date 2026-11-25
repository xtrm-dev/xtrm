import { strict as assert } from "node:assert"
import { test } from "node:test"

import { composerMeta } from "../src/lib/composer-meta.ts"

test("composer meta: a Pi target reports the model and the thinking effort", () => {
  assert.deepEqual(composerMeta({ model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" }), {
    model: "anthropic/claude-sonnet-4-5",
    effort: "high",
    label: "anthropic/claude-sonnet-4-5 · thinking high",
  })
})

test("composer meta: a Claude target with no thinking level shows the model alone", () => {
  assert.deepEqual(composerMeta({ model: "claude-opus-4-5", thinkingLevel: null }), {
    model: "claude-opus-4-5",
    effort: null,
    label: "claude-opus-4-5",
  })
})

test("composer meta: an effort without a model is not dropped", () => {
  const meta = composerMeta({ model: null, thinkingLevel: "low" })
  assert.equal(meta.effort, "low")
  assert.equal(meta.label, "thinking low")
})

test("composer meta: the row's effort is the bare level, its label spells out thinking", () => {
  const meta = composerMeta({ model: "claude-opus-5-5", thinkingLevel: "high" })
  assert.equal(meta.effort, "high")
  assert.equal(meta.label, "claude-opus-5-5 · thinking high")
})

test("composer meta: a missing value is omitted, never guessed", () => {
  assert.deepEqual(composerMeta({ model: null, thinkingLevel: null }), { model: null, effort: null, label: null })
  assert.equal(composerMeta({ model: "", thinkingLevel: "" }).label, null)
  assert.equal(composerMeta({ model: "   ", thinkingLevel: "  " }).label, null)
})

test("composer meta: no target means no row text", () => {
  assert.equal(composerMeta(null).label, null)
  assert.equal(composerMeta(undefined).label, null)
})

test("composer meta: values are trimmed so the row has no stray whitespace", () => {
  const meta = composerMeta({ model: " claude-opus-4-5 ", thinkingLevel: " medium " })
  assert.equal(meta.label, "claude-opus-4-5 · thinking medium")
})
