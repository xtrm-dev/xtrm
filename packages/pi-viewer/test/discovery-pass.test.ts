import assert from "node:assert/strict"
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { refreshDiscovery, resetDiscovery } from "../server/api.ts"
import { listOnce, statOnce, withStatPass } from "../server/stat-pass.ts"

test("inside a pass a file is stat'ed and a directory listed once", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-viewer-pass-"))
  const file = join(dir, "a.jsonl")
  writeFileSync(file, "x")
  withStatPass(() => {
    const first = statOnce(file)
    const names = listOnce(dir)
    appendFileSync(file, "yy")
    writeFileSync(join(dir, "b.jsonl"), "")
    assert.equal(statOnce(file), first, "the second look is the first stat")
    assert.equal(statOnce(file).size, 1)
    assert.equal(listOnce(dir), names)
  })
  assert.equal(statOnce(file).size, 3, "outside a pass every call reads the disk")
  assert.deepEqual(listOnce(dir).sort(), ["a.jsonl", "b.jsonl"])
})

test("a missing file fails the same way inside and outside a pass", () => {
  const missing = join(tmpdir(), "pi-viewer-pass-missing", "nope.jsonl")
  assert.throws(() => statOnce(missing), { code: "ENOENT" })
  withStatPass(() => {
    assert.throws(() => statOnce(missing), { code: "ENOENT" })
    assert.throws(() => statOnce(missing), { code: "ENOENT" })
  })
})

test("a nested pass joins the outer one and the memo ends with it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-viewer-pass-"))
  const file = join(dir, "a.jsonl")
  writeFileSync(file, "x")
  let inner: unknown
  const outer = withStatPass(() => {
    const first = statOnce(file)
    withStatPass(() => {
      inner = statOnce(file)
    })
    return first
  })
  assert.equal(inner, outer)
  appendFileSync(file, "z")
  assert.equal(statOnce(file).size, 2)
})

test("concurrent discovery requests share one refresh, which does not throw without tmux", async () => {
  resetDiscovery()
  const first = refreshDiscovery()
  const second = refreshDiscovery()
  assert.equal(first, second)
  const found = await first
  assert.ok(Array.isArray(found.sessions))
  resetDiscovery()
})
