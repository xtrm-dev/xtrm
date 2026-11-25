import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  agentsInScope,
  defaultScope,
  defaultTarget,
  describeScope,
  parseScope,
  resolveScope,
  sameScope,
  scopeRowKey,
  serialiseScope,
  type Scope,
} from "../src/lib/scope.ts"
import { buildTree, flatten } from "../src/lib/tree.ts"
import type { ViewerAgent, ViewerSession } from "../src/shared/types.ts"

function agent(paneId: string, windowIndex: number, paneIndex: number, extra: Partial<ViewerAgent> = {}): ViewerAgent {
  return {
    id: paneId,
    paneId,
    panePid: 1,
    provider: "pi",
    piPid: 2,
    tmuxSession: "xx",
    windowIndex,
    windowName: `win${windowIndex}`,
    paneIndex,
    name: `agent${paneId}`,
    role: null,
    title: "",
    cwd: "/w",
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
    modifiedAt: 0,
    eventCount: 0,
    status: "idle",
    statusNote: null,
    ...extra,
  }
}

const SESSIONS: ViewerSession[] = [
  {
    name: "xx",
    capturedAt: 0,
    agents: [
      agent("%12", 2, 0),
      agent("%2", 0, 1, { modifiedAt: 50, role: "worker" }),
      agent("%1", 0, 0, { modifiedAt: 10, role: "lead" }),
      agent("%5", 1, 0, { modifiedAt: 30 }),
    ],
  },
  { name: "yy", capturedAt: 0, agents: [agent("%20", 0, 0)] },
]

const ROUND_TRIP: Scope[] = [
  { kind: "session", session: "xx" },
  { kind: "session", session: "my session & co" },
  { kind: "session", session: "a/b?c=d%e#f" },
  { kind: "session", session: "ünïcode-ß" },
  { kind: "window", session: "xx", window: 0 },
  { kind: "window", session: "xx", window: 12 },
  { kind: "pane", session: "xx", window: 2, paneId: "%12" },
  { kind: "pane", session: "my session", window: 0, paneId: "%1" },
  { kind: "pane", session: "xx", window: null, paneId: "%7" },
]

test("the URL scheme: ?s=<session>[&w=<window>[&p=<pane>]], documented shapes", () => {
  assert.equal(serialiseScope({ kind: "session", session: "xx" }), "?s=xx")
  assert.equal(serialiseScope({ kind: "window", session: "xx", window: 2 }), "?s=xx&w=2")
  assert.equal(serialiseScope({ kind: "pane", session: "xx", window: 2, paneId: "%12" }), "?s=xx&w=2&p=%2512")
  assert.deepEqual(parseScope("?s=xx&w=2&p=%2512"), { kind: "pane", session: "xx", window: 2, paneId: "%12" })
})

test("every scope survives serialise then parse unchanged", () => {
  for (const scope of ROUND_TRIP) {
    const search = serialiseScope(scope)
    assert.deepEqual(parseScope(search), scope, search)
    // A page URL carries the search string after the path; the leading ? is the only difference.
    assert.deepEqual(parseScope(new URL(`http://127.0.0.1:5199/${search}`).search), scope)
  }
})

test("a malformed URL degrades to the closest valid scope, or to nothing", () => {
  assert.equal(parseScope(""), null)
  assert.equal(parseScope("?w=2&p=%251"), null, "no session")
  assert.equal(parseScope("?s="), null, "empty session")
  assert.deepEqual(parseScope("?s=xx&w=-1"), { kind: "session", session: "xx" })
  assert.deepEqual(parseScope("?s=xx&w=abc"), { kind: "session", session: "xx" })
  assert.deepEqual(parseScope("?s=xx&w=1.5"), { kind: "session", session: "xx" })
  assert.deepEqual(parseScope("?s=xx&w=2&p=bad"), { kind: "window", session: "xx", window: 2 })
  assert.deepEqual(parseScope("?s=xx&p=12"), { kind: "session", session: "xx" }, "a pane id needs its %")
  assert.deepEqual(parseScope("?s=xx&p=%2512"), { kind: "pane", session: "xx", window: null, paneId: "%12" })
  assert.deepEqual(parseScope("?junk=1&s=xx&extra"), { kind: "session", session: "xx" })
})

test("agents in scope follow tree order: window index, then pane index", () => {
  const names = (scope: Scope) => agentsInScope(SESSIONS, scope).map((entry) => entry.paneId)
  assert.deepEqual(names({ kind: "session", session: "xx" }), ["%1", "%2", "%5", "%12"])
  assert.deepEqual(names({ kind: "window", session: "xx", window: 0 }), ["%1", "%2"])
  assert.deepEqual(names({ kind: "window", session: "xx", window: 1 }), ["%5"])
  assert.deepEqual(names({ kind: "pane", session: "xx", window: 0, paneId: "%2" }), ["%2"])
  assert.deepEqual(names({ kind: "session", session: "gone" }), [])
  assert.deepEqual(names({ kind: "window", session: "xx", window: 9 }), [])
  assert.deepEqual(names({ kind: "pane", session: "yy", window: 0, paneId: "%2" }), [], "a pane of another session is not found")
  assert.deepEqual(agentsInScope(SESSIONS, null), [])
})

test("a scope that still resolves comes back as the same object across polls", () => {
  for (const scope of [
    { kind: "session", session: "xx" },
    { kind: "window", session: "xx", window: 1 },
    { kind: "pane", session: "xx", window: 0, paneId: "%2" },
  ] as Scope[]) {
    assert.equal(resolveScope(scope, SESSIONS), scope)
    // A poll that reorders the agents changes nothing.
    const reordered = SESSIONS.map((session) => ({ ...session, agents: [...session.agents].reverse() }))
    assert.equal(resolveScope(scope, reordered), scope)
  }
})

test("a vanished scope falls back: pane to window, window to session, session to the default", () => {
  const without = (...ids: string[]): ViewerSession[] =>
    SESSIONS.map((session) => ({ ...session, agents: session.agents.filter((entry) => !ids.includes(entry.paneId)) }))
  const pane: Scope = { kind: "pane", session: "xx", window: 0, paneId: "%2" }
  // The pane leaves; its window still has %1.
  assert.deepEqual(resolveScope(pane, without("%2")), { kind: "window", session: "xx", window: 0 })
  // The whole window empties: the session.
  assert.deepEqual(resolveScope(pane, without("%1", "%2")), { kind: "session", session: "xx" })
  assert.deepEqual(resolveScope({ kind: "window", session: "xx", window: 1 }, without("%5")), { kind: "session", session: "xx" })
  // The session itself goes: the default (the preferred session, else the first with agents).
  const noXx = SESSIONS.filter((session) => session.name !== "xx")
  assert.deepEqual(resolveScope(pane, noXx), { kind: "session", session: "yy" })
  assert.deepEqual(resolveScope({ kind: "session", session: "gone" }, SESSIONS), { kind: "session", session: "xx" })
  // A pane scope that never had a window (?s=xx&p=...) falls straight to the session.
  assert.deepEqual(resolveScope({ kind: "pane", session: "xx", window: null, paneId: "%404" }, SESSIONS), { kind: "session", session: "xx" })
  // Nothing at all: no scope, and no crash.
  assert.equal(resolveScope(pane, []), null)
  assert.equal(resolveScope(null, []), null)
  assert.equal(resolveScope(pane, [{ name: "xx", agents: [], capturedAt: 0 }]), null)
})

test("with no scope the page opens on the preferred session, else the first that has agents", () => {
  assert.deepEqual(defaultScope(SESSIONS), { kind: "session", session: "xx" })
  assert.deepEqual(defaultScope([SESSIONS[1], { name: "empty", agents: [], capturedAt: 0 }]), { kind: "session", session: "yy" })
  assert.deepEqual(defaultScope([{ name: "empty", agents: [], capturedAt: 0 }, SESSIONS[1]]), { kind: "session", session: "yy" })
  assert.equal(defaultScope([]), null)
})

test("the composer's default target follows scope: the pane itself, else the most recently active agent", () => {
  const session = agentsInScope(SESSIONS, { kind: "session", session: "xx" })
  assert.equal(defaultTarget(session, { kind: "session", session: "xx" })?.paneId, "%2", "modifiedAt 50 is newest")
  const window = agentsInScope(SESSIONS, { kind: "window", session: "xx", window: 0 })
  assert.equal(defaultTarget(window, { kind: "window", session: "xx", window: 0 })?.paneId, "%2")
  const pane = agentsInScope(SESSIONS, { kind: "pane", session: "xx", window: 0, paneId: "%1" })
  assert.equal(defaultTarget(pane, { kind: "pane", session: "xx", window: 0, paneId: "%1" })?.paneId, "%1")
  assert.equal(defaultTarget([], null), null)
})

test("scope row keys match the sidebar tree's keys one to one", () => {
  const rows = flatten(buildTree(SESSIONS), new Set())
  const keys = rows.map((row) => row.key)
  for (const scope of [
    { kind: "session", session: "xx" },
    { kind: "window", session: "xx", window: 2 },
    { kind: "pane", session: "xx", window: 2, paneId: "%12" },
  ] as Scope[]) {
    assert.ok(keys.includes(scopeRowKey(scope)), scopeRowKey(scope))
  }
})

test("the header describes the scope: name, level and agent count", () => {
  const session = describeScope({ kind: "session", session: "xx" }, agentsInScope(SESSIONS, { kind: "session", session: "xx" }))
  assert.deepEqual(session, { kind: "session", title: "xx", detail: "session · 4 agents", role: null })
  const window = describeScope({ kind: "window", session: "xx", window: 0 }, agentsInScope(SESSIONS, { kind: "window", session: "xx", window: 0 }))
  assert.deepEqual(window, { kind: "window", title: "win0", detail: "xx · window 0 · 2 agents", role: null })
  const pane = describeScope({ kind: "pane", session: "xx", window: 0, paneId: "%1" }, agentsInScope(SESSIONS, { kind: "pane", session: "xx", window: 0, paneId: "%1" }))
  assert.deepEqual(pane, { kind: "pane", title: "agent%1", detail: "xx · win0", role: "lead" })
  assert.equal(describeScope(null, []), null)
  assert.equal(describeScope({ kind: "window", session: "xx", window: 1 }, agentsInScope(SESSIONS, { kind: "window", session: "xx", window: 1 }))?.detail, "xx · window 1 · 1 agent")
})

test("sameScope compares kind, session and the level's own key", () => {
  assert.ok(sameScope({ kind: "session", session: "xx" }, { kind: "session", session: "xx" }))
  assert.ok(!sameScope({ kind: "session", session: "xx" }, { kind: "session", session: "yy" }))
  assert.ok(!sameScope({ kind: "session", session: "xx" }, { kind: "window", session: "xx", window: 0 }))
  assert.ok(!sameScope({ kind: "window", session: "xx", window: 0 }, { kind: "window", session: "xx", window: 1 }))
  assert.ok(!sameScope({ kind: "pane", session: "xx", window: 0, paneId: "%1" }, { kind: "pane", session: "xx", window: 0, paneId: "%2" }))
  assert.ok(!sameScope(null, { kind: "session", session: "xx" }))
  assert.ok(sameScope(null, null))
})
