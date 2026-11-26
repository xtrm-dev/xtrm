import assert from "node:assert/strict"
import { appendFileSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { createServer, request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { gunzipSync } from "node:zlib"

import { handleApi, resetDiscovery, scopeAgentIds, seedDiscovery } from "../server/api.ts"
import { cachedThread } from "../server/thread-cache.ts"
import { eventsInScope } from "../src/lib/scope.ts"
import type { ThreadPayload, ViewerAgent, ViewerSession } from "../src/shared/types.ts"

const T0 = 1_700_000_000_000

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

function header(): string {
  return (
    line({ type: "session", version: 3, id: "s", timestamp: new Date(T0).toISOString(), cwd: "/tmp" }) +
    line({ type: "session_info", id: "si", parentId: null, timestamp: new Date(T0).toISOString(), name: "x" })
  )
}

/** One user turn and its answer, `index` apart in time; `lane` offsets agents so they interleave. */
function turn(prefix: string, index: number, lane: number): string {
  const id = `${prefix}u${index}`
  const at = T0 + index * 10_000 + lane * 3_000
  return (
    line({ type: "message", id, parentId: index ? `${prefix}a${index - 1}` : null, timestamp: new Date(at).toISOString(), message: { role: "user", content: [{ type: "text", text: `${prefix} question ${index}` }], timestamp: at } }) +
    line({ type: "message", id: `${prefix}a${index}`, parentId: id, timestamp: new Date(at + 1_000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: `${prefix} answer ${index}` }], stopReason: "stop", timestamp: at + 1_000 } })
  )
}

interface Fixture {
  agents: ViewerAgent[]
  files: Record<string, string>
  counts: Record<string, number>
}

function agentOf(id: string, file: string, count: number, window: { index: number; id: string }): ViewerAgent {
  const now = Date.now()
  return {
    id,
    paneId: id,
    panePid: 1,
    piPid: null,
    tmuxSession: "scope",
    windowIndex: window.index,
    windowId: window.id,
    windowName: `w${window.index}`,
    paneIndex: 1,
    name: `agent-${id}`,
    title: `agent-${id}`,
    cwd: "/tmp",
    role: null,
    sessionFile: file,
    sessionId: id,
    sessionName: `agent-${id}`,
    provider: "pi",
    model: null,
    thinkingLevel: null,
    modifiedAt: now,
    lastWriteAt: now,
    eventCount: count,
    status: "idle",
    statusNote: null,
  }
}

/** Three agents: %a and %b in window @1, %c in window @2. `turns` maps pane id to its turn count. */
function fixture(turns: Record<string, number>): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "pi-viewer-scope-"))
  const layout: Array<[string, string, number, { index: number; id: string }]> = [
    ["%1", "a", 0, { index: 1, id: "@1" }],
    ["%2", "b", 1, { index: 1, id: "@1" }],
    ["%3", "c", 2, { index: 2, id: "@2" }],
  ]
  const files: Record<string, string> = {}
  const counts: Record<string, number> = {}
  const agents: ViewerAgent[] = []
  for (const [id, prefix, lane, window] of layout) {
    const file = join(dir, `${prefix}.jsonl`)
    let text = header()
    for (let index = 0; index < (turns[id] ?? 0); index += 1) text += turn(prefix, index, lane)
    writeFileSync(file, text)
    files[id] = file
    counts[id] = 2 + (turns[id] ?? 0) * 2
    agents.push(agentOf(id, file, counts[id], window))
  }
  return { agents, files, counts }
}

function session(fix: Fixture, name: string) {
  return { name, serverId: "s", agents: fix.agents, version: "v", capturedAt: Date.now() }
}

function textOf(event: ThreadPayload["events"][number]): string {
  return event.text ?? event.summary
}

function idsOf(payload: ThreadPayload): string[] {
  return payload.events.map((event) => event.id)
}

test("a scoped window holds the same events as the client filter of the session window", () => {
  const fix = fixture({ "%1": 20, "%2": 20, "%3": 20 })
  const s = session(fix, "eq")
  const whole = cachedThread(s, { scope: "branch" })
  const cases: Array<[string, string[]]> = [
    ["pane %1", ["%1"]],
    ["window @1", ["%1", "%2"]],
    ["pane %3", ["%3"]],
  ]
  for (const [scope, ids] of cases) {
    const scoped = cachedThread(s, { scope: "branch", agentIds: ids })
    const agents = fix.agents.filter((agent) => ids.includes(agent.id))
    assert.deepEqual(idsOf(scoped), idsOf({ ...whole, events: eventsInScope(whole.events, agents) }), scope)
    assert.ok(scoped.events.length > 0, scope)
  }
})

test("a scoped window is the scope's own newest turns, not what is left of the session's", () => {
  // %b writes 200 turns after %a's 20: the session's newest 150 turns hold none of %a's.
  const fix = fixture({ "%1": 20, "%2": 0, "%3": 0 })
  const dir = mkdtempSync(join(tmpdir(), "pi-viewer-scope-"))
  const busy = join(dir, "b.jsonl")
  let text = header()
  for (let index = 0; index < 200; index += 1) text += turn("b", index + 100, 1)
  writeFileSync(busy, text)
  fix.agents[1] = agentOf("%2", busy, 2 + 200 * 2, { index: 1, id: "@1" })
  const s = session(fix, "own")
  const whole = cachedThread(s, { scope: "branch" })
  assert.equal(eventsInScope(whole.events, [fix.agents[0]]).length, 0)
  const scoped = cachedThread(s, { scope: "branch", agentIds: ["%1"] })
  assert.equal(scoped.events.filter((event) => event.agentId === "%1").length, 40)
  assert.ok(scoped.events.every((event) => event.agentId === "%1"))
  assert.ok(scoped.events.length < whole.events.length)
})

test("the window is memoized per counter and rebuilt when the cache moves", () => {
  const fix = fixture({ "%1": 10, "%2": 10, "%3": 10 })
  const s = session(fix, "memo")
  const first = cachedThread(s, { scope: "branch", agentIds: ["%1"] })
  const second = cachedThread(s, { scope: "branch", agentIds: ["%1"] })
  assert.equal(second.events, first.events, "same counter: the cut window is reused")
  assert.notEqual(second, first, "the envelope is a copy, so per-request fields cannot leak")
  const other = cachedThread(s, { scope: "branch", agentIds: ["%2"] })
  assert.notEqual(other.events, first.events)

  appendFileSync(fix.files["%1"], turn("a", 10, 0))
  const future = new Date(Date.now() + 2_000)
  utimesSync(fix.files["%1"], future, future)
  fix.agents[0] = agentOf("%1", fix.files["%1"], fix.counts["%1"] + 2, { index: 1, id: "@1" })
  fix.agents[0].modifiedAt = future.getTime()
  const third = cachedThread(s, { scope: "branch", agentIds: ["%1"] })
  assert.notEqual(third.events, first.events)
  assert.ok(third.cursor > first.cursor)
  assert.equal(third.events.filter((event) => textOf(event) === "a answer 10").length, 1)
})

test("a scoped poll returns only that scope's new events, and no events when idle", () => {
  const fix = fixture({ "%1": 5, "%2": 5, "%3": 5 })
  const s = session(fix, "poll")
  const first = cachedThread(s, { scope: "branch", agentIds: ["%1"] })
  const idle = cachedThread(s, { scope: "branch", agentIds: ["%1"], since: first.cursor, revision: first.revision })
  assert.equal(idle.unchanged, true)
  assert.equal(idle.events.length, 0)

  appendFileSync(fix.files["%2"], turn("b", 5, 1))
  const future = new Date(Date.now() + 3_000)
  utimesSync(fix.files["%2"], future, future)
  fix.agents[1] = { ...agentOf("%2", fix.files["%2"], fix.counts["%2"] + 2, { index: 1, id: "@1" }), modifiedAt: future.getTime() }
  const other = cachedThread(s, { scope: "branch", agentIds: ["%1"], since: first.cursor, revision: first.revision })
  assert.equal(other.unchanged, true, "another agent's event is not this pane's")
  assert.ok(other.cursor > first.cursor)

  const window = cachedThread(s, { scope: "branch", agentIds: ["%1", "%2"], since: first.cursor })
  assert.deepEqual(window.events.map(textOf), ["b question 5", "b answer 5"])
})

test("a scope has its own revision; a changed agent set or scope reloads the window", () => {
  const fix = fixture({ "%1": 5, "%2": 5, "%3": 5 })
  const s = session(fix, "rev")
  const whole = cachedThread(s, { scope: "branch" })
  const pane = cachedThread(s, { scope: "branch", agentIds: ["%1"] })
  assert.notEqual(pane.revision, whole.revision)
  assert.ok(pane.revision.startsWith(whole.revision), "the scope tag extends the session revision")
  const pair = cachedThread(s, { scope: "branch", agentIds: ["%1", "%2"] })
  assert.notEqual(pair.revision, pane.revision)

  // A window that gains a pane: the old revision no longer matches, so the client reloads it.
  const grown = cachedThread(s, { scope: "branch", agentIds: ["%1", "%2"], since: pane.cursor, revision: pane.revision })
  assert.equal(grown.reset, true)
  assert.ok(grown.events.some((event) => textOf(event) === "b question 0"))
  // The session revision is unchanged by scoped traffic.
  assert.equal(cachedThread(s, { scope: "branch" }).revision, whole.revision)
})

test("a scope that matches no agent is an empty thread, not the whole session", () => {
  const fix = fixture({ "%1": 5, "%2": 5, "%3": 5 })
  const s = session(fix, "none")
  const empty = cachedThread(s, { scope: "branch", agentIds: [] })
  assert.deepEqual(empty.events, [])
  assert.equal(empty.hasEarlier, false)
})

test("scopeAgentIds applies the client's agentsInScope rules", () => {
  const fix = fixture({ "%1": 1, "%2": 1, "%3": 1 })
  const view: ViewerSession = { name: "x", serverId: "s", agents: fix.agents, capturedAt: 0 }
  assert.equal(scopeAgentIds(view, null, null), null)
  assert.deepEqual(scopeAgentIds(view, null, "%1"), ["%1"])
  assert.deepEqual(scopeAgentIds(view, "@1", null), ["%1", "%2"])
  assert.deepEqual(scopeAgentIds(view, "2", null), ["%3"])
  assert.deepEqual(scopeAgentIds(view, "@1", "%3"), ["%3"], "a pane wins over its window")
  assert.deepEqual(scopeAgentIds(view, null, "%99"), [])
  assert.throws(() => scopeAgentIds(view, null, "a"), /invalid pane id/)
  assert.throws(() => scopeAgentIds(view, "x", null), /invalid window id/)
})

function get(port: number, path: string, gzip: boolean): Promise<{ status: number; encoding: string | undefined; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, headers: gzip ? { "accept-encoding": "gzip" } : {} }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, encoding: res.headers["content-encoding"] as string | undefined, body: Buffer.concat(chunks) }),
      )
    })
    req.on("error", reject)
    req.end()
  })
}

test("the endpoint applies the scope, and a repeat poll reuses the compressed frame", async () => {
  const fix = fixture({ "%1": 60, "%2": 60, "%3": 60 })
  seedDiscovery({ sessions: [{ name: "http", serverId: "s", agents: fix.agents, capturedAt: Date.now() }] })
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  const decode = (reply: { encoding: string | undefined; body: Buffer }): ThreadPayload =>
    JSON.parse((reply.encoding === "gzip" ? gunzipSync(reply.body) : reply.body).toString("utf8")) as ThreadPayload
  const base = "/api/thread?session=http&scope=branch&limit=150"
  try {
    const whole = await get(port, base, true)
    assert.equal(whole.status, 200)
    assert.equal(whole.encoding, "gzip")
    const all = decode(whole)
    assert.equal(new Set(all.events.map((event) => event.agentId)).size, 3)

    const pane = await get(port, `${base}&p=%251`, true)
    const paneBody = decode(pane)
    assert.ok(paneBody.events.length > 0)
    assert.ok(paneBody.events.every((event) => event.agentId === "%1"))
    assert.ok(pane.body.length < whole.body.length / 2, "a pane's frame is a fraction of the session's")

    const window = decode(await get(port, `${base}&w=%401`, true))
    assert.deepEqual([...new Set(window.events.map((event) => event.agentId))].sort(), ["%1", "%2"])
    const missing = decode(await get(port, `${base}&p=%2599`, true))
    assert.deepEqual(missing.events, [], "a pane that is not in the session is an empty thread")

    // The same poll twice is served from one encoded frame: identical bytes.
    const again = await get(port, `${base}&p=%251`, true)
    assert.ok(again.body.equals(pane.body))
    // A client without gzip gets the same JSON.
    assert.deepEqual(decode(await get(port, `${base}&p=%251`, false)).events, paneBody.events)

    assert.equal((await get(port, `${base}&p=nope`, false)).status, 400)
  } finally {
    server.close()
    resetDiscovery()
  }
})
