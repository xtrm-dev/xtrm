import { strict as assert } from "node:assert"
import { test } from "node:test"

import { scopeRowKey, type Scope } from "../src/lib/scope.ts"
import { shouldSaveLastSeen, unseenEventCount } from "../src/lib/readstate.ts"
import { MAX_RESTORE_SYNCS, restoreExpired } from "../src/lib/stick.ts"

const windowScope: Scope = { kind: "window", session: "xx", window: 3, windowId: "@5" }

test("last-read is saved only after the first sync, at the end, on screen", () => {
  assert.equal(shouldSaveLastSeen({ ready: false, atBottom: true, visible: true, newest: 10 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: false, visible: true, newest: 10 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: true, visible: false, newest: 10 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: true, visible: true, newest: 0 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: true, visible: true, newest: 10 }), true)
})

test("the new pill counts events, not rows: one turn row can carry many events", () => {
  assert.equal(unseenEventCount(120, 100, false), 20)
  assert.equal(unseenEventCount(120, 100, true), 0)
  assert.equal(unseenEventCount(90, 100, false), 0)
})

test("a restore that never finds its row gives up after the sync budget or deadline", () => {
  assert.equal(restoreExpired(1, 500, 2_000), false)
  assert.equal(restoreExpired(MAX_RESTORE_SYNCS, 500, 2_000), false)
  assert.equal(restoreExpired(MAX_RESTORE_SYNCS + 1, 500, 2_000), true)
  assert.equal(restoreExpired(2, 2_001, 2_000), true)
})

test("the read key is the scope, not the agents that happen to be in it", () => {
  const joined: Scope = { kind: "session", session: "xx" }
  assert.equal(scopeRowKey(joined), "s:xx")
  assert.equal(scopeRowKey(windowScope), "w:xx:@5")
  assert.ok(!scopeRowKey(joined).includes("%"))
  assert.ok(!scopeRowKey(windowScope).includes("%"))
})
