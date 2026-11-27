import { strict as assert } from "node:assert"
import { test } from "node:test"

import { ECHO_WINDOW_MS, isEchoOf, matchEchoes, type OptimisticMessage } from "../src/lib/optimistic.ts"
import { channelTimeline } from "../src/lib/thread.ts"
import type { ViewerEvent } from "../src/shared/types.ts"

function event(seq: number, at: number, kind: ViewerEvent["kind"], extra: Partial<ViewerEvent> = {}): ViewerEvent {
  return {
    id: `a1:${seq}`,
    agentId: "a1",
    agentName: "a1",
    seq,
    at,
    kind,
    role: kind === "user" ? "user" : "assistant",
    summary: "",
    onBranch: true,
    ...extra,
  }
}

const sent: OptimisticMessage = {
  id: "m1",
  paneId: "a1",
  agentName: "a1",
  text: "FLICKER PIN",
  at: 10_000,
  status: "sent",
}

test("send flicker: an echoed prompt keeps the optimistic row key", () => {
  const prompt = event(1, 10_200, "user", { text: "FLICKER PIN" })
  const reply = event(2, 11_000, "assistant", { text: "ok", stopReason: "stop", parts: [{ type: "text", text: "ok" }] })
  const items = channelTimeline([prompt, reply], [], new Map([[prompt.id, "optimistic:m1"]]))
  const row = items.find((item) => item.kind === "user")
  assert.ok(row)
  assert.equal(row.id, "optimistic:m1")
})

test("send flicker: echo matching is bounded, so an old send cannot claim a new prompt", () => {
  const echo = event(1, 10_200, "user", { text: "FLICKER PIN" })
  assert.equal(isEchoOf(echo, sent), true)
  assert.equal(isEchoOf({ ...echo, at: 10_000 + ECHO_WINDOW_MS + 1 }, sent), false)
})

test("send flicker: a prompt held by a busy agent still matches when it is written minutes later", () => {
  const queued = event(1, 100_000, "user", { text: "FLICKER PIN", queued: true })
  assert.equal(isEchoOf(queued, sent), true)
})

test("busy send: the queued row adopts the optimistic key and survives delivery", () => {
  const queued = event(3, 10_000 + 5 * 60_000, "user", { id: "queue:abc", text: "FLICKER PIN", queued: true })
  const view = matchEchoes([queued], [sent])
  assert.equal(view.visible.length, 0, "the optimistic row must be replaced by its queued echo")
  assert.equal(view.keys.get(queued.id), "optimistic:m1")

  const pending = channelTimeline([queued], view.visible, view.keys)
  const pendingRows = pending.filter((item) => item.kind === "user" || item.kind === "optimistic")
  assert.equal(pendingRows.length, 1)
  assert.equal(pendingRows[0].id, "optimistic:m1")

  const delivered = { ...queued, queued: undefined, at: queued.at + 1_000 }
  const settled = channelTimeline([delivered], view.visible, view.keys)
  const settledRows = settled.filter((item) => item.kind === "user" || item.kind === "optimistic")
  assert.equal(settledRows.length, 1)
  assert.equal(settledRows[0].id, "optimistic:m1")
})
