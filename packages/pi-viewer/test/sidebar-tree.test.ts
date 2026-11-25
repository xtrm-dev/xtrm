import { strict as assert } from "node:assert"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  buildTree,
  flatten,
  mergeLive,
  navigate,
  paneKey,
  railNext,
  stateOf,
  survivingFocus,
  type FlatRow,
} from "../src/lib/tree.ts"
import type { ViewerAgent, ViewerSession } from "../src/shared/types.ts"

let counter = 0

function agent(extra: Partial<ViewerAgent> & { paneId: string }): ViewerAgent {
  counter += 1
  return {
    id: extra.paneId,
    panePid: 100 + counter,
    provider: "pi",
    piPid: 200 + counter,
    tmuxSession: "xx",
    windowIndex: 0,
    windowId: `@${(extra.windowIndex ?? 0) + 1}`,
    windowName: "w0",
    paneIndex: 0,
    name: `agent-${extra.paneId}`,
    role: null,
    title: "",
    cwd: "/work",
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

function session(name: string, agents: ViewerAgent[]): ViewerSession {
  return { name, agents: agents.map((entry) => ({ ...entry, tmuxSession: name })), capturedAt: 0 }
}

const FIXTURE: ViewerSession[] = [
  session("xx", [
    agent({ paneId: "%9", windowIndex: 2, windowName: "late", paneIndex: 0 }),
    agent({ paneId: "%2", windowIndex: 0, windowName: "first", paneIndex: 1 }),
    agent({ paneId: "%1", windowIndex: 0, windowName: "first", paneIndex: 0, role: "lead", provider: "claude" }),
    agent({ paneId: "%5", windowIndex: 1, windowName: "mid", paneIndex: 0 }),
  ]),
  session("empty", []),
  session("yy", [agent({ paneId: "%20" })]),
]

test("the tree groups by session and window, orders windows by index and panes by pane index", () => {
  const tree = buildTree(FIXTURE)
  assert.deepEqual(tree.map((node) => node.name), ["xx", "yy"])
  const xx = tree[0]
  assert.deepEqual(xx.windows.map((window) => [window.index, window.name]), [[0, "first"], [1, "mid"], [2, "late"]])
  assert.deepEqual(xx.windows[0].panes.map((pane) => pane.agent.paneId), ["%1", "%2"])
  assert.equal(xx.count, 4)
})

test("windows group by stable tmux id, not the renumbered index", () => {
  const tree = buildTree([session("xx", [
    agent({ paneId: "%1", windowIndex: 0, windowId: "@1", windowName: "one" }),
    agent({ paneId: "%2", windowIndex: 7, windowId: "@1", windowName: "one", paneIndex: 1 }),
    agent({ paneId: "%9", windowIndex: 1, windowId: "@9", windowName: "nine" }),
  ])])
  assert.equal(tree[0].windows.length, 2)
  assert.equal(tree[0].windows[0].key, "w:xx:@1")
  assert.deepEqual(tree[0].windows[0].panes.map((pane) => pane.agent.paneId), ["%1", "%2"])
})

test("sessions, windows and panes without an agent are omitted", () => {
  const tree = buildTree(FIXTURE)
  assert.ok(!tree.some((node) => node.name === "empty"), "a session with no agent is not listed")
  const withBlank = buildTree([session("zz", [agent({ paneId: "" }), agent({ paneId: "%7", windowIndex: 3 })])])
  assert.equal(withBlank[0].windows.length, 1, "a pane without an id adds no window")
  assert.deepEqual(withBlank[0].windows[0].panes.map((pane) => pane.agent.paneId), ["%7"])
  assert.deepEqual(buildTree([session("none", [agent({ paneId: "" })])]), [])
})

test("a pane shows one of three states: a finished turn awaiting input is idle, not attention", () => {
  assert.equal(stateOf("working"), "running")
  assert.equal(stateOf("waiting"), "idle", "the server's waiting is a finished turn")
  assert.equal(stateOf("error"), "error")
  assert.equal(stateOf("idle"), "idle")
  assert.equal(stateOf("unknown"), "idle")
  const states = new Set((["working", "waiting", "error", "idle", "unknown"] as const).map(stateOf))
  assert.deepEqual([...states].sort(), ["error", "idle", "running"])
})

test("collapsing a session or window hides its rows and keeps the others", () => {
  const tree = buildTree(FIXTURE)
  const all = flatten(tree, new Set())
  assert.deepEqual(all.map((row) => row.level), [1, 2, 3, 3, 2, 2, 1, 2])
  const noXx = flatten(tree, new Set(["s:xx"]))
  assert.deepEqual(noXx.map((row) => row.key), ["s:xx", "s:yy", paneKey("%20")])
  const noWindow = flatten(tree, new Set(["w:xx:@1"]))
  assert.ok(noWindow.some((row) => row.key === "w:xx:@1"))
  assert.ok(!noWindow.some((row) => row.key === paneKey("%1")))
  assert.ok(noWindow.some((row) => row.key === paneKey("%5")))
  // A window with one pane has no row of its own; its pane sits directly under the session.
  const single = all.find((row) => row.key === paneKey("%5"))
  assert.equal(single?.level, 2)
  assert.equal(single?.parentKey, "s:xx")
  assert.ok(!all.some((row) => row.key === "w:xx:@2"), "no window row for a one-pane window")
})

test("the keyboard model follows the WAI-ARIA tree pattern", () => {
  const rows: FlatRow[] = flatten(buildTree(FIXTURE), new Set())
  const at = (key: string) => navigate(rows, key, "ArrowDown")
  assert.deepEqual(at("s:xx"), { type: "focus", key: "w:xx:@1" })
  assert.deepEqual(navigate(rows, "s:xx", "ArrowUp"), { type: "focus", key: "s:xx" }, "stays on the first row")
  assert.deepEqual(navigate(rows, "s:xx", "End"), { type: "focus", key: paneKey("%20") })
  assert.deepEqual(navigate(rows, paneKey("%20"), "Home"), { type: "focus", key: "s:xx" })
  // ArrowRight: open a closed group, else step into its first child.
  assert.deepEqual(navigate(rows, "s:xx", "ArrowRight"), { type: "focus", key: "w:xx:@1" })
  const closed = flatten(buildTree(FIXTURE), new Set(["s:xx"]))
  assert.deepEqual(navigate(closed, "s:xx", "ArrowRight"), { type: "toggle", key: "s:xx", open: true })
  // ArrowLeft: close an open group, else go to the parent; a top-level row has nowhere to go.
  assert.deepEqual(navigate(rows, "s:xx", "ArrowLeft"), { type: "toggle", key: "s:xx", open: false })
  assert.deepEqual(navigate(rows, paneKey("%1"), "ArrowLeft"), { type: "focus", key: "w:xx:@1" })
  assert.equal(navigate(closed, "s:xx", "ArrowLeft"), null)
  // Enter and Space select the scope of any level (session, window or pane); the arrows expand and
  // collapse. A pane has no ArrowRight.
  assert.deepEqual(navigate(rows, paneKey("%1"), "Enter"), { type: "activate", key: paneKey("%1") })
  assert.deepEqual(navigate(rows, "w:xx:@1", " "), { type: "activate", key: "w:xx:@1" })
  assert.deepEqual(navigate(rows, "s:xx", "Enter"), { type: "activate", key: "s:xx" })
  assert.equal(navigate(rows, paneKey("%1"), "ArrowRight"), null)
  assert.equal(navigate(rows, paneKey("%1"), "x"), null)
  assert.equal(navigate(rows, "missing", "ArrowDown"), null)
})

test("the sidebar sources follow the console unit rule: rem indents and type, no px indent or text size", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "sidebar")
  const offenders: string[] = []
  for (const name of readdirSync(dir)) {
    const source = readFileSync(join(dir, name), "utf8")
    const patterns = [
      /\b(?:p|m)[lrxs]?-\[\d+(?:\.\d+)?px\]/,
      /text-\[[\d.]+(?:px|rem)\]/,
      /(?:paddingLeft|marginLeft|left)\s*:\s*["'`]?\d+px/,
      /font-size\s*:\s*\d+px/,
    ]
    for (const pattern of patterns) if (pattern.test(source)) offenders.push(`${name}: ${pattern}`)
  }
  assert.deepEqual(offenders, [])
})

test("a thread payload of another session never overrides a session's agents", () => {
  const mine = FIXTURE[0]
  const other = FIXTURE[2]
  const fresh = { session: "yy", agents: [agent({ paneId: "%99", name: "stale-from-yy" })] }
  // Reading xx while the payload in state still belongs to yy: sessions come back untouched.
  assert.equal(mergeLive(FIXTURE, "xx", fresh), FIXTURE)
  // Reading yy with its own payload: only yy changes.
  const merged = mergeLive(FIXTURE, "yy", fresh)
  assert.equal(merged[0], mine)
  assert.deepEqual(merged[2].agents.map((entry) => entry.paneId), ["%99"])
  assert.notEqual(merged[2], other)
  // No payload, no session, or both: untouched.
  assert.equal(mergeLive(FIXTURE, "xx", null), FIXTURE)
  assert.equal(mergeLive(FIXTURE, null, fresh), FIXTURE)
  // After a merge no pane key repeats across the tree.
  const keys = flatten(buildTree(mergeLive(FIXTURE, "xx", { session: "xx", agents: mine.agents })), new Set()).map((row) => row.key)
  assert.equal(new Set(keys).size, keys.length)
})

test("focus on a vanished row goes to its nearest visible ancestor", () => {
  const tree = buildTree(FIXTURE)
  const open = flatten(tree, new Set())
  const parents = new Map(open.map((row) => [row.key, row.parentKey] as const))
  // The window collapses: its pane is gone, the window row remains.
  const windowClosed = flatten(tree, new Set(["w:xx:@1"]))
  assert.equal(survivingFocus(parents, windowClosed, paneKey("%1")), "w:xx:@1")
  // The whole session collapses: the nearest visible ancestor is the session row.
  const sessionClosed = flatten(tree, new Set(["s:xx"]))
  assert.equal(survivingFocus(parents, sessionClosed, paneKey("%1")), "s:xx")
  // A visible row keeps focus; an unknown row has no ancestor.
  assert.equal(survivingFocus(parents, open, paneKey("%1")), paneKey("%1"))
  assert.equal(survivingFocus(parents, open, "p:%never-seen"), null)
  // A pane that left tmux entirely falls back through its remembered parents to the nearest visible row.
  const gone = flatten(buildTree([session("xx", [agent({ paneId: "%2", windowIndex: 0, windowName: "first" })]), FIXTURE[2]]), new Set())
  assert.equal(survivingFocus(parents, gone, paneKey("%1")), "s:xx", "its window now holds one pane and has no row")
})

test("the rail toolbar moves one agent at a time and stops at the ends", () => {
  assert.equal(railNext(4, 0, "ArrowDown"), 1)
  assert.equal(railNext(4, 3, "ArrowDown"), 3)
  assert.equal(railNext(4, 0, "ArrowUp"), 0)
  assert.equal(railNext(4, 2, "ArrowUp"), 1)
  assert.equal(railNext(4, 2, "Home"), 0)
  assert.equal(railNext(4, 1, "End"), 3)
  assert.equal(railNext(4, 1, "Enter"), null)
  assert.equal(railNext(0, 0, "ArrowDown"), null)
})
