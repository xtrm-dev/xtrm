/**
 * A transcript that vanished is one agent's problem, not the whole server's (XTRM-1109, PR #512 review).
 *
 * The review showed that parseSessionFile throwing inside refreshDiscovery or cachedThread turned every
 * route into a 500 until the file returned. These tests hold the degrade in place for both providers.
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { invalidateThread, cachedThread, pruneCaches } from "../server/thread-cache.ts"
import type { ViewerAgent } from "../src/shared/types.ts"

const dir = mkdtempSync(join(tmpdir(), "pi-viewer-parse-"))

function agent(overrides: Partial<ViewerAgent>): ViewerAgent {
  return {
    id: "%1",
    paneId: "%1",
    panePid: 1,
    provider: "pi",
    tmuxSession: "probe",
    windowIndex: 0,
    windowId: "@0",
    windowName: "w0",
    paneIndex: 1,
    name: "agent-probe",
    role: "worker",
    title: "",
    cwd: dir,
    sessionFile: join(dir, "missing.jsonl"),
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt: 0,
    lastWriteAt: 0,
    eventCount: 0,
    status: "working",
    statusNote: null,
    ...overrides,
  } as ViewerAgent
}

function session(name: string, agents: ViewerAgent[]) {
  return { name, serverId: "1:probe", agents, version: "v1", capturedAt: Date.now() }
}

test.after(() => rmSync(dir, { recursive: true, force: true }))

test("a Pi transcript that vanished serves an empty thread instead of throwing", () => {
  invalidateThread("probe")
  assert.doesNotThrow(() => cachedThread(session("probe", [agent({})]), { limit: 10, scope: "all" }))
  const payload = cachedThread(session("probe", [agent({})]), { limit: 10, scope: "all" })
  assert.equal(payload.events.length, 0, "no events come from a file that is not there")
})

test("a Claude transcript that vanished serves an empty thread instead of throwing", () => {
  invalidateThread("probe-claude")
  const claude = agent({ id: "%2", paneId: "%2", provider: "claude", sessionFile: join(dir, "gone.jsonl") })
  const payload = cachedThread(session("probe-claude", [claude]), { limit: 10, scope: "all" })
  assert.equal(payload.events.length, 0)
})

test("one unreadable transcript does not hide a readable one beside it", () => {
  invalidateThread("probe-mixed")
  const good = join(dir, "good.jsonl")
  writeFileSync(
    good,
    `${JSON.stringify({ type: "message", id: "e1", timestamp: "2026-11-26T00:00:00.000Z", message: { role: "user", content: "hello" } })}\n`,
  )
  const readable = agent({ id: "%1", paneId: "%1", sessionFile: good })
  const broken = agent({ id: "%3", paneId: "%3", sessionFile: join(dir, "gone-3.jsonl") })
  const payload = cachedThread(session("probe-mixed", [readable, broken]), { limit: 10, scope: "all" })
  assert.equal(payload.events.length, 1, "the readable transcript still serves its event")
  assert.equal(payload.events[0].agentId, "%1")
})

test("pruneCaches drops the agents and sessions that are gone and keeps the live ones", () => {
  invalidateThread("live")
  cachedThread(session("live", [agent({ id: "%7", paneId: "%7" })]), { limit: 10, scope: "all" })
  cachedThread(session("dead", [agent({ id: "%8", paneId: "%8" })]), { limit: 10, scope: "all" })
  const dropped = pruneCaches(new Set(["%7"]), new Set(["live"]))
  assert.ok(dropped >= 1, `at least the dead session is dropped (dropped ${dropped})`)
  // The live entry survives: a second call is served from the cache without throwing.
  assert.doesNotThrow(() => cachedThread(session("live", [agent({ id: "%7", paneId: "%7" })]), { limit: 10, scope: "all" }))
})
