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

import { cachedKeys, cachedThread, invalidateThread, pruneCaches } from "../server/thread-cache.ts"
import { cachedFiles, parseSessionFile, pruneFileCaches } from "../server/session.ts"
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
  // Two strikes: one discovery without a pane does not drop it (XTRM-1109 round 2).
  pruneCaches(new Set(["%7"]), new Set(["live"]))
  const dropped = pruneCaches(new Set(["%7"]), new Set(["live"]))
  assert.ok(dropped >= 1, `at least the dead session is dropped (dropped ${dropped})`)
  assert.ok(!cachedKeys().sessions.includes("dead"), "the gone session is no longer cached")
  assert.ok(cachedKeys().sessions.includes("live"), "the live session survives")
  // The live entry survives: a second call is served from the cache without throwing.
  assert.doesNotThrow(() => cachedThread(session("live", [agent({ id: "%7", paneId: "%7" })]), { limit: 10, scope: "all" }))
})

test("a session cache survives one transient absence and is dropped on the second", () => {
  invalidateThread("twice")
  cachedThread(session("twice", [agent({ id: "%21", paneId: "%21" })]), { limit: 10, scope: "all" })
  assert.ok(cachedKeys().sessions.includes("twice"), "cached before the prune")
  // First discovery without the pane: kept, so a listing that momentarily lost it cannot reset the
  // revision the client pages with.
  pruneCaches(new Set(), new Set())
  assert.ok(cachedKeys().sessions.includes("twice"), "a single absence keeps the session")
  assert.ok(cachedKeys().agents.includes("%21"), "a single absence keeps the agent")
  pruneCaches(new Set(), new Set())
  assert.ok(!cachedKeys().sessions.includes("twice"), "the second absence drops the session")
  assert.ok(!cachedKeys().agents.includes("%21"), "the second absence drops the agent")
})

test("a cache key that comes back between absences starts counting again", () => {
  invalidateThread("flaps")
  cachedThread(session("flaps", [agent({ id: "%22", paneId: "%22" })]), { limit: 10, scope: "all" })
  pruneCaches(new Set(), new Set())
  pruneCaches(new Set(["%22"]), new Set(["flaps"]))
  pruneCaches(new Set(), new Set())
  assert.ok(cachedKeys().sessions.includes("flaps"), "the strike count restarted when the key returned")
  assert.ok(cachedKeys().agents.includes("%22"))
})

test("the per-file caches prune on the same two-absence rule", () => {
  const live = join(dir, "prune-live.jsonl")
  const gone = join(dir, "prune-gone.jsonl")
  const line = `${JSON.stringify({ type: "message", id: "p1", timestamp: "2026-11-26T00:00:00.000Z", message: { role: "user", content: "hi" } })}\n`
  writeFileSync(live, line)
  writeFileSync(gone, line)
  parseSessionFile(live)
  parseSessionFile(gone)
  assert.ok(cachedFiles().includes(gone), "the parsed path is cached")
  pruneFileCaches(new Set([live]))
  assert.ok(cachedFiles().includes(gone), "one absence keeps the file cache")
  pruneFileCaches(new Set([live]))
  assert.ok(!cachedFiles().includes(gone), "two absences drop the file cache")
  assert.ok(cachedFiles().includes(live), "a live path always survives")
})
