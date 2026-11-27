/**
 * `unwrapPasted` edge cases (XTRM-1116, PR #512 reviews 6082066934 and 6082108342).
 *
 * The function is exported and used at three prompt surfaces, so its shapes are pinned here directly:
 * the literal Claude Code wrapper, nesting, a quoted wrapper in prose, adjacent wrappers, an unclosed
 * wrapper and an empty wrapper. Before the fix, nesting left a dangling tag, prose that quoted a
 * complete wrapper lost its tags, and an empty wrapper unwrapped to nothing.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { unwrapPasted } from "../server/claude.ts"

test("a wrapper that opens the message shows its inner text", () => {
  assert.equal(unwrapPasted('\n\n<pasted_content id="a">\nhello\n</pasted_content id="a">\n'), "hello")
})

test("nested wrappers collapse to their text with no dangling tag", () => {
  const text = '<pasted_content id="a">X<pasted_content id="b">Y</pasted_content id="b">Z</pasted_content id="a">'
  const unwrapped = unwrapPasted(text)
  assert.equal(unwrapped, "XYZ")
  assert.ok(!unwrapped.includes("pasted_content"))
})

test("prose that quotes a complete wrapper keeps its markup", () => {
  const text = 'why does <pasted_content id="x"> show up in </pasted_content id="x"> the log?'
  assert.equal(unwrapPasted(text), text)
})

test("adjacent wrappers collapse in one call", () => {
  const text = '<pasted_content id="a">A</pasted_content id="a"><pasted_content id="b">B</pasted_content id="b">'
  assert.equal(unwrapPasted(text), "AB")
})

test("an unclosed wrapper is returned as it came", () => {
  const text = '\n<pasted_content id="a">\nnever closed'
  assert.equal(unwrapPasted(text), text)
})

test("an empty wrapper unwraps to nothing", () => {
  assert.equal(unwrapPasted('<pasted_content id="a"></pasted_content id="a">'), "")
})

test("text without a wrapper is returned unchanged", () => {
  assert.equal(unwrapPasted("  plain prompt  "), "  plain prompt  ")
})
