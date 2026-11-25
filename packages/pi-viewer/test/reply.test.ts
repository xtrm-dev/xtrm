import assert from "node:assert/strict"
import { test } from "node:test"

import { escapeClearsReply, replyAvailability, replyBarAgent, replyIdFor, replyLabel, replyTitle } from "../src/lib/reply.ts"
import type { ViewerAgent } from "../src/shared/types.ts"

function agent(id: string, name: string): ViewerAgent {
  return { id, name } as ViewerAgent
}

test("Reply is ready for a present agent and disabled for a gone one", () => {
  assert.equal(replyAvailability(agent("%1", "alpha")), "ready")
  assert.equal(replyAvailability(undefined), "gone")
  assert.equal(replyTitle("ready"), "Reply")
  assert.equal(replyTitle("gone"), "Agent is gone")
})

test("the aria label names the agent", () => {
  assert.equal(replyLabel("xtrm-xt-pi-i1wb"), "Reply to xtrm-xt-pi-i1wb")
})

test("a session or window scope remembers the reply; a pane scope shows no bar", () => {
  assert.equal(replyIdFor("session", "%3"), "%3")
  assert.equal(replyIdFor("window", "%3"), "%3")
  assert.equal(replyIdFor("pane", "%3"), null)
})

test("the bar names the reply agent only while the composer still aims at it", () => {
  const a = agent("%1", "alpha")
  const b = agent("%2", "beta")
  assert.equal(replyBarAgent("%1", a), a)
  assert.equal(replyBarAgent("%1", b), null, "the target moved to another agent")
  assert.equal(replyBarAgent(null, a), null, "no reply, no bar")
  assert.equal(replyBarAgent("%1", null), null, "no target")
})

test("Escape clears the bar from an empty composer and leaves a draft alone", () => {
  assert.equal(escapeClearsReply(true, ""), true)
  assert.equal(escapeClearsReply(true, "draft"), false)
  assert.equal(escapeClearsReply(false, ""), false)
})
