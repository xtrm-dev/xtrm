import { strict as assert } from "node:assert"
import { test } from "node:test"

import { scopeRowKey, type Scope } from "../src/lib/scope.ts"
import { migrateLastSeen, shouldSaveLastSeen, threadReadKey, unseenTimelineItems } from "../src/lib/readstate.ts"
import { restoreExpired } from "../src/lib/stick.ts"

const windowScope: Scope = { kind: "window", session: "xx", window: 3, windowId: "@5" }

test("last-read is saved only after the first sync, at the end, on screen", () => {
  assert.equal(shouldSaveLastSeen({ ready: false, atBottom: true, visible: true, newest: 10 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: false, visible: true, newest: 10 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: true, visible: false, newest: 10 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: true, visible: true, newest: 0 }), false)
  assert.equal(shouldSaveLastSeen({ ready: true, atBottom: true, visible: true, newest: 10 }), true)
})

test("the new pill counts rows appended after leaving the bottom, not earlier pages", () => {
  const seen = new Set(["turn:1"])
  const items = [
    { id: "turn:0", at: 50, kind: "turn" },
    { id: "turn:1", at: 100, kind: "turn" },
    { id: "turn:2", at: 200, kind: "turn" },
  ]
  assert.equal(unseenTimelineItems(items, seen, 100, false), 1)
  assert.equal(unseenTimelineItems(items, seen, 100, true), 0)
  assert.equal(unseenTimelineItems(items, new Set(items.map((item) => item.id)), 100, false), 0)
})

test("the pill does not count the reader's own rows as new", () => {
  const items = [
    { id: "turn:1", at: 100, kind: "turn" },
    { id: "user:2", at: 200, kind: "user" },
    { id: "optimistic:3", at: 300, kind: "optimistic" },
    { id: "turn:4", at: 400, kind: "turn" },
  ]
  assert.equal(unseenTimelineItems(items, new Set(["turn:1"]), 100, false), 1)
})

test("a restore that never finds its row gives up at the deadline, not after a sync count", () => {
  assert.equal(restoreExpired(500, 2_000), false)
  assert.equal(restoreExpired(2_000, 2_000), false)
  assert.equal(restoreExpired(2_001, 2_000), true)
})

test("the read key is the scope, not the agents that happen to be in it", () => {
  const joined: Scope = { kind: "session", session: "xx" }
  assert.equal(scopeRowKey(joined), "s:xx")
  assert.equal(scopeRowKey(windowScope), "w:xx:@5")
  assert.ok(!scopeRowKey(joined).includes("%"))
  assert.ok(!scopeRowKey(windowScope).includes("%"))
})


test("read keys carry the tmux server identity", () => {
  assert.equal(threadReadKey("1234:/tmp/tmux-1000/default", "p:%85"), "1234:/tmp/tmux-1000/default:p:%85")
  assert.notEqual(
    threadReadKey("1234:/tmp/tmux-1000/default", "w:xx:@5"),
    threadReadKey("5678:/tmp/tmux-1000/default", "w:xx:@5"),
  )
})

test("old read keys migrate once and are dropped", () => {
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  }
  store.set("xtrm-viewer:last-seen:xx:%1,%2", "1500")
  const key = threadReadKey("tmux:test", "s:xx")
  assert.equal(migrateLastSeen(key, ["xx:%1,%2", "s:xx"]), 1500)
  assert.equal(store.get(`xtrm-viewer:last-seen:${key}`), "1500")
  assert.equal(store.has("xtrm-viewer:last-seen:xx:%1,%2"), false)
  assert.equal(store.has("xtrm-viewer:last-seen:s:xx"), false)
  assert.equal(migrateLastSeen(key, ["xx:%1,%2"]), 1500)
})
