import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  agentsInScope,
  defaultScope,
  defaultTarget,
  describeScope,
  identicalScope,
  parseScope,
  resolveScope,
  sameScope,
  sameScopeState,
  scopeFromUrl,
  scopeRowKey,
  serialiseScope,
  trackScope,
  SCOPE_GRACE,
  type Scope,
  type ScopeTrack,
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
    windowId: `@${windowIndex + 1}`,
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
    { kind: "window", session: "xx", window: 1, windowId: "@2" },
    { kind: "pane", session: "xx", window: 0, windowId: "@1", paneId: "%2" },
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
  const pane: Scope = { kind: "pane", session: "xx", window: 0, windowId: "@1", paneId: "%2" }
  // The pane leaves; its window still has %1.
  assert.deepEqual(resolveScope(pane, without("%2")), { kind: "window", session: "xx", window: 0, windowId: "@1" })
  // The whole window empties: the session.
  assert.deepEqual(resolveScope(pane, without("%1", "%2")), { kind: "session", session: "xx" })
  assert.deepEqual(resolveScope({ kind: "window", session: "xx", window: 1, windowId: "@2" }, without("%5")), { kind: "session", session: "xx" })
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
    { kind: "window", session: "xx", window: 0, windowId: "@1" }, // two panes: has a row
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

// ---------------------------------------------------------------------------
// XTRM-1022 review delta: polls, grace, identity, address bar
// ---------------------------------------------------------------------------

const without = (...ids: string[]): ViewerSession[] =>
  SESSIONS.map((session) => ({ ...session, agents: session.agents.filter((entry) => !ids.includes(entry.paneId)) }))
const EMPTY: ViewerSession[] = []
const PANE: Scope = { kind: "pane", session: "xx", window: 0, windowId: "@1", paneId: "%2" }

test("an empty or failed discovery poll keeps the last good scope and does not count as absence", () => {
  let track: ScopeTrack = { scope: { kind: "window", session: "xx", window: 2, windowId: "@3" }, absent: 0 }
  for (let poll = 0; poll < 10; poll += 1) {
    track = trackScope(track, EMPTY, null)
    assert.deepEqual(track.scope, { kind: "window", session: "xx", window: 2, windowId: "@3" })
    assert.equal(track.absent, 0)
  }
  // Sessions that exist but hold no agent are the same as no discovery.
  track = trackScope(track, [{ name: "xx", agents: [], capturedAt: 0 }], null)
  assert.deepEqual(track.scope, { kind: "window", session: "xx", window: 2, windowId: "@3" })
  // Before any scope has resolved, an empty poll leaves the request waiting (no default invented).
  assert.deepEqual(trackScope({ scope: null, absent: 0 }, EMPTY, parseScope("?s=xx&w=2")), { scope: null, absent: 0 })
})

test("the page-open URL is read only until a scope has resolved; it never replaces the user's selection", () => {
  const requested = parseScope("?s=xx&w=2")
  let track = trackScope({ scope: null, absent: 0 }, SESSIONS, requested)
  assert.deepEqual(track.scope, { kind: "window", session: "xx", window: 2, windowId: "@3" }, "the request resolves on the first poll")
  // The user then clicks a pane. A later empty poll, and a later good poll, both keep the pane,
  // even though the stale request is still passed in.
  track = { scope: PANE, absent: 0 }
  track = trackScope(track, EMPTY, requested)
  assert.equal(track.scope, PANE)
  track = trackScope(track, SESSIONS, requested)
  assert.equal(track.scope, PANE)
  // The request is not even consulted once a scope exists: an unresolvable one changes nothing.
  assert.equal(trackScope(track, SESSIONS, parseScope("?s=gone&w=9")).scope, PANE)
})

test("a request that cannot resolve falls back at once when there is no last good scope to hold", () => {
  const first = trackScope({ scope: null, absent: 0 }, SESSIONS, parseScope("?s=xx&w=999"))
  assert.deepEqual(first.scope, { kind: "session", session: "xx" })
  assert.deepEqual(trackScope({ scope: null, absent: 0 }, SESSIONS, parseScope("?s=nosuch&w=3&p=%251")).scope, { kind: "session", session: "xx" })
  assert.deepEqual(trackScope({ scope: null, absent: 0 }, SESSIONS, null).scope, { kind: "session", session: "xx" })
})

test("one poll that drops a pane does not downgrade the scope; it degrades only after three absent polls", () => {
  assert.equal(SCOPE_GRACE, 3)
  let track: ScopeTrack = { scope: PANE, absent: 0 }
  // Poll 1 drops the pane: the pane scope stays.
  track = trackScope(track, without("%2"), null)
  assert.equal(track.scope, PANE)
  assert.equal(track.absent, 1)
  // It reappears before the grace ends: nothing happened, the counter resets.
  track = trackScope(track, SESSIONS, null)
  assert.equal(track.scope, PANE)
  assert.equal(track.absent, 0)
  // Two absent polls in a row still hold.
  track = trackScope(track, without("%2"), null)
  track = trackScope(track, without("%2"), null)
  assert.equal(track.scope, PANE)
  assert.equal(track.absent, 2)
  // Back after two: restored, counter reset (the deeper scope was never lost).
  const back = trackScope(track, SESSIONS, null)
  assert.equal(back.scope, PANE)
  assert.equal(back.absent, 0)
  // The third consecutive absent poll degrades along the chain: pane to window.
  const third = trackScope(track, without("%2"), null)
  assert.deepEqual(third.scope, { kind: "window", session: "xx", window: 0, windowId: "@1" })
  assert.equal(third.absent, 0)
  // An intermittent pane never accumulates: absent, present, absent, present stays a pane.
  let flaky: ScopeTrack = { scope: PANE, absent: 0 }
  for (let poll = 0; poll < 12; poll += 1) flaky = trackScope(flaky, poll % 2 ? SESSIONS : without("%2"), null)
  assert.equal(flaky.scope, PANE)
})

test("after the grace the chain continues: window to session to the default", () => {
  let track: ScopeTrack = { scope: { kind: "window", session: "xx", window: 1, windowId: "@2" }, absent: 0 }
  const gone = without("%5")
  for (let poll = 1; poll < SCOPE_GRACE; poll += 1) {
    track = trackScope(track, gone, null)
    assert.deepEqual(track.scope, { kind: "window", session: "xx", window: 1, windowId: "@2" }, `poll ${poll}`)
  }
  track = trackScope(track, gone, null)
  assert.deepEqual(track.scope, { kind: "session", session: "xx" })
  // The whole session leaves: held for the grace, then the default.
  const noXx = SESSIONS.filter((session) => session.name !== "xx")
  for (let poll = 1; poll < SCOPE_GRACE; poll += 1) {
    track = trackScope(track, noXx, null)
    assert.deepEqual(track.scope, { kind: "session", session: "xx" })
  }
  track = trackScope(track, noXx, null)
  assert.deepEqual(track.scope, { kind: "session", session: "yy" })
})

test("a pane scope is the pane id alone: no new selection, no remount, no duplicate history entry", () => {
  const bare: Scope = { kind: "pane", session: "xx", window: null, paneId: "%12" }
  const full: Scope = { kind: "pane", session: "xx", window: 2, windowId: "@3", paneId: "%12" }
  assert.ok(sameScope(bare, full), "?s=xx&p=%12 then a click on %12 is the same selection")
  assert.ok(!identicalScope(bare, full), "but the URL still learns the window")
  assert.equal(scopeRowKey(bare), scopeRowKey(full), "so the scroller and All events keys do not change")
  assert.ok(!sameScope(full, { ...full, paneId: "%5" }))
  // The poll upgrades a window-less pane scope to the pane's real window, and keeps the identity.
  const track = trackScope({ scope: bare, absent: 0 }, SESSIONS, null)
  assert.deepEqual(track.scope, full)
  assert.ok(sameScope(track.scope, bare))
  // A pane whose URL carries a stale window is corrected to where the pane is.
  assert.deepEqual(resolveScope({ kind: "pane", session: "xx", window: 9, windowId: "@3", paneId: "%12" }, SESSIONS), full)
  // An already-correct scope keeps its identity (the same object): nothing re-renders.
  assert.equal(trackScope({ scope: full, absent: 0 }, SESSIONS, null).scope, full)
})

test("a stable window id survives tmux renumbering and keeps the URL", () => {
  const before: Scope = { kind: "window", session: "xx", window: 1, windowId: "@2" }
  assert.equal(serialiseScope(before), "?s=xx&w=%402")
  const renumbered = SESSIONS.map((entry) => ({
    ...entry,
    agents: entry.agents.map((item) => (item.windowId === "@2" ? { ...item, windowIndex: 5 } : item)),
  }))
  const after = resolveScope(before, renumbered)
  assert.deepEqual(after, { kind: "window", session: "xx", window: 5, windowId: "@2" })
  assert.equal(serialiseScope(after as Scope), "?s=xx&w=%402")
  assert.equal(agentsInScope(renumbered, before).length, 1)
  assert.ok(sameScope(after, before), "the target is the same")
  assert.ok(!sameScopeState(after, before), "but the displayed index changed")
})

test("an old index URL resolves once to the stable id and rewrites", () => {
  const migrated = scopeFromUrl("?s=xx&w=2&p=%2512", null, SESSIONS)
  assert.deepEqual(migrated, { kind: "pane", session: "xx", window: 2, windowId: "@3", paneId: "%12" })
  assert.equal(serialiseScope(migrated as Scope), "?s=xx&w=%403&p=%2512")
  // A window URL migrates the same way.
  assert.deepEqual(scopeFromUrl("?s=xx&w=1", null, SESSIONS), { kind: "window", session: "xx", window: 1, windowId: "@2" })
  // A window id in the URL parses without an index; resolution fills the current one.
  assert.deepEqual(parseScope("?s=xx&w=%402"), { kind: "window", session: "xx", window: null, windowId: "@2" })
})

test("Back or Forward to a stale or invalid URL resolves to a valid scope whose URL replaces the address", () => {
  const current: Scope = { kind: "window", session: "xx", window: 1, windowId: "@2" }
  // Stale: a window and a pane that no longer exist resolve to the session; the URL to write is that scope's.
  const stale = scopeFromUrl("?s=xx&w=9&p=%25404", current, SESSIONS)
  assert.deepEqual(stale, { kind: "session", session: "xx" })
  assert.equal(serialiseScope(stale as Scope), "?s=xx")
  // Invalid: no usable session means the current scope is kept, and its URL is what to write.
  const garbled = scopeFromUrl("?s=&w=zz&p=nope", current, SESSIONS)
  assert.deepEqual(garbled, current)
  assert.equal(serialiseScope(garbled as Scope), "?s=xx&w=%402")
  assert.deepEqual(scopeFromUrl("", current, SESSIONS), current)
  // A vanished session resolves to the default.
  assert.deepEqual(scopeFromUrl("?s=nosuch", current, SESSIONS), { kind: "session", session: "xx" })
  // A valid deeper URL is honoured as is.
  assert.deepEqual(scopeFromUrl("?s=xx&w=2&p=%2512", current, SESSIONS), { kind: "pane", session: "xx", window: 2, windowId: "@3", paneId: "%12" })
  // Empty discovery keeps the current scope instead of resetting it.
  assert.deepEqual(scopeFromUrl("?s=xx&w=2", current, EMPTY), current)
  assert.equal(scopeFromUrl("?s=xx", null, EMPTY), null)
})


test("a reused window index with a different id is not the same state, and a missing id falls back to the index", () => {
  const sameIndex: Scope = { kind: "window", session: "xx", window: 1, windowId: "@2" }
  const reused: Scope = { kind: "window", session: "xx", window: 1, windowId: "@3" }
  const renumbered: Scope = { kind: "window", session: "xx", window: 5, windowId: "@2" }
  assert.equal(sameScope(sameIndex, reused), false)
  assert.equal(sameScopeState(sameIndex, reused), false)
  assert.equal(sameScopeState(sameIndex, renumbered), false, "the displayed index must follow a renumber")
  assert.equal(sameScopeState(sameIndex, { ...sameIndex }), true)
  assert.equal(
    sameScope(sameIndex, { kind: "window", session: "xx", window: 1, windowId: "" }),
    false,
    "an empty id is not the real tmux window at the same index",
  )

  const noId: Scope = { kind: "window", session: "xx", window: 1, windowId: "" }
  assert.equal(scopeRowKey(noId), "w:xx:1")
  assert.equal(serialiseScope(noId), "?s=xx&w=1")
  const tree = buildTree([
    {
      name: "xx",
      agents: [
        agent("%90", 1, 0, { windowId: "" }),
        agent("%91", 1, 1, { windowId: "" }),
      ],
      capturedAt: 1,
    },
  ])
  assert.equal(tree[0].windows[0].key, "w:xx:1", "the fallback key is the plain index, never a fake @id")
  assert.equal(tree[0].windows[0].windowId, "1")
})
