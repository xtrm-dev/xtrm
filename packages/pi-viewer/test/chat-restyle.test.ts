import { strict as assert } from "node:assert"
import { test } from "node:test"

import { deliveryOfOptimistic, deliveryOfUser, latestUserIds } from "../src/lib/delivery.ts"
import { foldLine, groupActivity, groupSummary } from "../src/lib/fold.ts"
import type { OptimisticMessage } from "../src/lib/optimistic.ts"
import { newCount, newSinceIndex } from "../src/lib/readstate.ts"
import { followMode, recall, remember, smoothStep } from "../src/lib/stick.ts"
import { formatElapsed } from "../src/lib/elapsed.ts"
import { channelTimeline, type ActivityItem, type Turn } from "../src/lib/thread.ts"
import type { ViewerEvent } from "../src/shared/types.ts"

function item(key: string, kind: ActivityItem["kind"], label: string, isError = false): ActivityItem {
  return { key, kind, label, summary: "", at: 0, isError, event: {} as ViewerEvent }
}

function turn(activity: ActivityItem[], start: number, end: number, final = true): Turn {
  return {
    id: "t",
    agentId: "a",
    agentName: "a",
    seq: 0,
    start,
    end,
    final: final ? ({ at: end } as ViewerEvent) : undefined,
    users: [],
    inbound: [],
    sent: [],
    activity,
    pending: !final,
  }
}

function event(agentId: string, seq: number, at: number, kind: ViewerEvent["kind"], extra: Partial<ViewerEvent> = {}): ViewerEvent {
  return {
    id: `${agentId}:${seq}`,
    agentId,
    agentName: agentId,
    seq,
    at,
    kind,
    role: kind === "user" ? "user" : "assistant",
    summary: `${kind} ${seq}`,
    onBranch: true,
    ...extra,
  }
}

test("fold: a run of two or more tool calls becomes one group, singles stay rows", () => {
  const rows = groupActivity([
    item("1", "thinking", "Thinking"),
    item("2", "tool", "Read"),
    item("3", "tool", "Read"),
    item("4", "bash", "Ran"),
    item("5", "notice", "Notice"),
    item("6", "tool", "Edited"),
  ])
  assert.deepEqual(rows.map((row) => row.kind), ["row", "group", "row", "row"])
  const group = rows[1]
  assert.equal(group.kind === "group" && group.items.length, 3)
  assert.equal(group.kind === "group" && group.summary, "Read ×2 · Ran")
  assert.equal(group.key, "group:2")
})

test("fold: group summary keeps first-use order and omits a count of one", () => {
  assert.equal(groupSummary([item("1", "tool", "Ran"), item("2", "tool", "Read"), item("3", "tool", "Ran")]), "Ran ×2 · Read")
})

test("fold: failure roll-up counts failed steps in groups and on the turn line", () => {
  const activity = [item("1", "tool", "Read", true), item("2", "tool", "Read"), item("3", "bash", "Ran", true)]
  const rows = groupActivity(activity)
  assert.equal(rows[0].kind === "group" && rows[0].failed, 2)
  const line = foldLine(turn(activity, 0, 72_000))
  assert.equal(line.failed, 2)
  assert.equal(line.label, "Worked for 1m 12s")
  assert.equal(line.detail, "3 tools")
})

test("fold: a turn with no usable duration falls back to a step count and no failure", () => {
  const line = foldLine(turn([item("1", "thinking", "Thinking")], 100, 100))
  assert.equal(line.label, "1 step")
  assert.equal(line.failed, 0)
  assert.equal(line.detail, "")
})

test("delivery: optimistic status maps to queued, typed, failed", () => {
  assert.equal(deliveryOfOptimistic("sending"), "queued")
  assert.equal(deliveryOfOptimistic("sent"), "typed")
  assert.equal(deliveryOfOptimistic("error"), "failed")
})

test("delivery: a transcript prompt is seen until its agent settles a later turn", () => {
  const seen = channelTimeline([event("a", 1, 1_000, "user", { text: "go" })])
  const user = seen.find((entry) => entry.kind === "user")
  assert.ok(user && user.kind === "user")
  assert.equal(deliveryOfUser(user, seen), "seen")

  const answered = channelTimeline([
    event("a", 1, 1_000, "user", { text: "go" }),
    event("a", 2, 2_000, "assistant", { parts: [{ type: "text", text: "done" }], stopReason: "stop", text: "done" }),
  ])
  const user2 = answered.find((entry) => entry.kind === "user")
  assert.ok(user2 && user2.kind === "user")
  assert.equal(deliveryOfUser(user2, answered), "answered")
})

test("delivery: only the newest operator message per agent carries a state", () => {
  const items = channelTimeline([
    event("a", 1, 1_000, "user", { text: "one" }),
    event("a", 3, 3_000, "user", { text: "two" }),
    event("b", 1, 2_000, "user", { text: "other" }),
  ])
  const ids = latestUserIds(items)
  assert.equal(ids.size, 2)
  assert.ok(ids.has("user:a:3"))
  assert.ok(ids.has("user:b:1"))
  assert.ok(!ids.has("user:a:1"))
})

test("delivery: an optimistic message counts as the newest message of its agent", () => {
  const message: OptimisticMessage = { id: "m", paneId: "a", agentName: "a", text: "x", at: 5_000, status: "sent" }
  const items = channelTimeline([event("a", 1, 1_000, "user", { text: "one" })], [message])
  const ids = latestUserIds(items)
  assert.deepEqual(Array.from(ids), ["optimistic:m"])
})

test("new since: divider lands before the first row newer than the last read, never on operator rows", () => {
  const rows = [
    { id: "1", at: 100, kind: "user" },
    { id: "2", at: 200, kind: "turn" },
    { id: "3", at: 300, kind: "user" },
    { id: "4", at: 400, kind: "turn" },
    { id: "5", at: 500, kind: "intercom" },
  ]
  assert.equal(newSinceIndex(rows, 250), 3)
  assert.equal(newCount(rows, 250), 2)
  assert.equal(newSinceIndex(rows, 500), -1)
  assert.equal(newCount(rows, 500), 0)
})

test("new since: no divider when nothing was ever read or the new row is first", () => {
  const rows = [{ id: "1", at: 100, kind: "turn" }]
  assert.equal(newSinceIndex(rows, 0), -1)
  assert.equal(newSinceIndex(rows, 50), -1)
  assert.equal(newCount(rows, 0), 0)
})

test("stick: follow mode never moves a reader who scrolled up", () => {
  assert.equal(followMode({ atBottom: false, working: true, reducedMotion: false }), "none")
  assert.equal(followMode({ atBottom: false, working: false, reducedMotion: false }), "none")
})

test("stick: smooth only while an agent works and motion is welcome", () => {
  assert.equal(followMode({ atBottom: true, working: true, reducedMotion: false }), "smooth")
  assert.equal(followMode({ atBottom: true, working: true, reducedMotion: true }), "instant")
  assert.equal(followMode({ atBottom: true, working: false, reducedMotion: false }), "instant")
})

test("stick: smooth step converges and snaps within a pixel", () => {
  let position = 0
  for (let step = 0; step < 60 && position !== 100; step += 1) position = smoothStep(position, 100)
  assert.equal(position, 100)
  assert.equal(smoothStep(99.5, 100), 100)
  assert.ok(smoothStep(0, 100) > 0 && smoothStep(0, 100) < 100)
})

test("stick: remembered position is per thread", () => {
  remember("s:one", { atEnd: false, anchorId: "turn:x", anchorTop: 12 })
  assert.deepEqual(recall("s:one"), { atEnd: false, anchorId: "turn:x", anchorTop: 12 })
  assert.equal(recall("s:two"), undefined)
})

test("ticker: elapsed text format", () => {
  assert.equal(formatElapsed(0), "0s")
  assert.equal(formatElapsed(42_000), "42s")
  assert.equal(formatElapsed(63_000), "1m 03s")
  assert.equal(formatElapsed(3_725_000), "1h 02m 05s")
})
