import assert from "node:assert/strict"
import { appendFileSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { cachedThread } from "../server/thread-cache.ts"
import type { ViewerAgent, ViewerEvent } from "../src/shared/types.ts"

function agent(file: string, count: number): ViewerAgent {
  return {
    id: "%test",
    paneId: "%test",
    panePid: 1,
    piPid: null,
    tmuxSession: "test",
    windowIndex: 1,
    windowId: "@1",
    windowName: "test",
    paneIndex: 1,
    name: "test-agent",
    title: "test-agent",
    cwd: "/tmp",
    role: null,
    sessionFile: file,
    sessionId: "test",
    sessionName: "test-agent",
    provider: "pi",
    model: null,
    thinkingLevel: null,
    modifiedAt: Date.now(),
    eventCount: count,
    status: "idle",
    statusNote: null,
  }
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function turn(index: number): string {
  const id = `u${index}`
  const at = 1_700_000_000_000 + index * 10_000
  return (
    line({ type: "message", id, parentId: index ? `a${index - 1}` : null, timestamp: new Date(at).toISOString(), message: { role: "user", content: [{ type: "text", text: `question ${index}` }], timestamp: at } }) +
    line({ type: "message", id: `a${index}`, parentId: id, timestamp: new Date(at + 1_000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: `answer ${index}` }], stopReason: "stop", timestamp: at + 1_000 } })
  )
}

test("incremental and earlier pages merge to the full timeline in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-viewer-cache-"))
  const file = join(dir, "session.jsonl")
  let count = 2
  writeFileSync(
    file,
    line({ type: "session", version: 3, id: "s", timestamp: new Date(1_700_000_000_000).toISOString(), cwd: "/tmp" }) +
      line({ type: "session_info", id: "si", parentId: null, timestamp: new Date(1_700_000_000_000).toISOString(), name: "test-agent" }),
  )
  for (let index = 0; index < 40; index += 1) {
    appendFileSync(file, turn(index))
    count += 2
  }
  const future = new Date(Date.now() + 2_000)
  utimesSync(file, future, future)

  const session = { name: "cache-test", agents: [agent(file, count)], version: "v1", capturedAt: 0 }
  const first = cachedThread(session, { scope: "branch", limit: 10 })
  assert.equal(first.events.length, 20)
  assert.equal(first.hasEarlier, true)
  assert.equal(first.earlierTurns, 30)

  let merged: ViewerEvent[] = first.events
  let page = first
  while (page.hasEarlier && page.earlier != null) {
    page = cachedThread(session, {
      scope: "branch",
      limit: 10,
      before: page.earlier,
      revision: first.revision,
    })
    merged = [...page.events, ...merged]
  }

  appendFileSync(file, turn(40))
  count += 2
  const later = new Date(Date.now() + 4_000)
  utimesSync(file, later, later)
  session.agents = [agent(file, count)]
  session.version = "v2"
  const delta = cachedThread(session, {
    scope: "branch",
    since: first.cursor,
    revision: first.revision,
  })
  assert.equal(delta.events.length, 2)
  assert.equal(delta.unchanged, false)
  merged = [...merged, ...delta.events]

  const full = cachedThread(session, { scope: "branch", limit: 300 })
  assert.deepEqual(
    merged.map((event) => event.id),
    full.events.map((event) => event.id),
  )
  assert.equal(full.events.length, 82)
})

test("an unchanged poll returns no events", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-viewer-cache-"))
  const file = join(dir, "session.jsonl")
  writeFileSync(
    file,
    line({ type: "session", version: 3, id: "s", timestamp: new Date(1_700_000_000_000).toISOString(), cwd: "/tmp" }) + turn(0),
  )
  const future = new Date(Date.now() + 2_000)
  utimesSync(file, future, future)
  const session = { name: "cache-unchanged", agents: [agent(file, 3)], version: "v1", capturedAt: 0 }
  const first = cachedThread(session, { scope: "branch", limit: 10 })
  const again = cachedThread(session, {
    scope: "branch",
    since: first.cursor,
    revision: first.revision,
  })
  assert.equal(again.unchanged, true)
  assert.equal(again.events.length, 0)
})
