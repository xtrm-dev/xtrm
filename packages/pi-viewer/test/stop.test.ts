import assert from "node:assert/strict"
import test from "node:test"

import { STOP_KEY, stopPlan } from "../server/stop.ts"

const agents = [{ paneId: "%12" }, { paneId: "%13" }]

test("a stop maps to one Escape on the listed pane", () => {
  const plan = stopPlan(agents, "%12")
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.ok && plan.argv, ["send-keys", "-t", "%12", "Escape"])
  assert.equal(plan.ok && plan.paneId, "%12")
})

test("the key is Escape, never a literal payload or a submit", () => {
  const plan = stopPlan(agents, "%13")
  assert.equal(plan.ok, true)
  const argv = plan.ok ? plan.argv : []
  assert.equal(STOP_KEY, "Escape")
  assert.equal(argv.includes("Enter"), false, "a stop must not submit a prompt")
  assert.equal(argv.includes("-l"), false, "a stop must not send the word Escape literally")
  assert.equal(argv.filter((part) => part === "Escape").length, 1, "exactly one Escape per request")
})

test("a pane the viewer does not list is refused", () => {
  const plan = stopPlan(agents, "%99")
  assert.deepEqual(plan, { ok: false, code: 404, reason: "pane is not a pi or claude agent in an open tmux session" })
})

test("only a tmux pane id is accepted", () => {
  for (const paneId of ["", "%", "12", "%12;kill-server", "%12 %13", "session:0.1"]) {
    const plan = stopPlan(agents, paneId)
    assert.equal(plan.ok, false, `${JSON.stringify(paneId)} is refused`)
    assert.equal(plan.ok ? 0 : plan.code, 400, `${JSON.stringify(paneId)} fails as a bad request`)
  }
})

test("no agent at all refuses every pane", () => {
  assert.equal(stopPlan([], "%12").ok, false)
})

test("pane ids are trimmed, not interpreted", () => {
  const plan = stopPlan(agents, "  %12  ")
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.ok && plan.argv, ["send-keys", "-t", "%12", "Escape"])
})
