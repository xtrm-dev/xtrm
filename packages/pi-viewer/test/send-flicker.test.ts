import { strict as assert } from "node:assert"
import { test } from "node:test"

import { isEchoOf, type OptimisticMessage } from "../src/lib/optimistic.ts"
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
  assert.equal(isEchoOf({ ...echo, at: 170_001 }, sent), false)
})
