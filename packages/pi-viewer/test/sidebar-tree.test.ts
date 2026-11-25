import { strict as assert } from "node:assert"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  buildTree,
  flatten,
  navigate,
  paneKey,
  resolveSelection,
  stateOf,
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

test("sessions, windows and panes without an agent are omitted", () => {
  const tree = buildTree(FIXTURE)
  assert.ok(!tree.some((node) => node.name === "empty"), "a session with no agent is not listed")
  const withBlank = buildTree([session("zz", [agent({ paneId: "" }), agent({ paneId: "%7", windowIndex: 3 })])])
  assert.equal(withBlank[0].windows.length, 1, "a pane without an id adds no window")
  assert.deepEqual(withBlank[0].windows[0].panes.map((pane) => pane.agent.paneId), ["%7"])
  assert.deepEqual(buildTree([session("none", [agent({ paneId: "" })])]), [])
})

test("the selected pane id is stable across polls, whatever the list order or counts", () => {
  const first = resolveSelection(null, FIXTURE)
  assert.deepEqual(first, { session: "xx", paneId: "%1" }, "default: preferred session, first by recency tie-break")
  const reordered: ViewerSession[] = [
    FIXTURE[2],
    session("xx", [...FIXTURE[0].agents].reverse().map((entry) => ({ ...entry, modifiedAt: 999 }))),
  ]
  const second = resolveSelection(first, reordered)
  assert.equal(second, first, "the same object comes back, so nothing reloads")
  const picked = { session: "xx", paneId: "%5" }
  assert.equal(resolveSelection(picked, FIXTURE), picked)
  assert.equal(resolveSelection(picked, reordered), picked)
})

test("when the selected pane disappears the selection falls back deterministically", () => {
  const recent = session("xx", [
    agent({ paneId: "%1", modifiedAt: 10 }),
    agent({ paneId: "%2", modifiedAt: 50 }),
  ])
  assert.deepEqual(resolveSelection({ session: "xx", paneId: "%gone" }, [recent, FIXTURE[2]]), {
    session: "xx",
    paneId: "%2",
  })
  assert.deepEqual(resolveSelection({ session: "gone", paneId: "%gone" }, [FIXTURE[2], recent]), {
    session: "xx",
    paneId: "%2",
  })
  assert.deepEqual(resolveSelection({ session: "xx", paneId: "%20" }, FIXTURE), { session: "yy", paneId: "%20" })
  assert.equal(resolveSelection({ session: "xx", paneId: "%1" }, []), null)
})

test("a pane shows one of four states and nothing else", () => {
  assert.equal(stateOf("working"), "running")
  assert.equal(stateOf("waiting"), "attention")
  assert.equal(stateOf("error"), "error")
  assert.equal(stateOf("idle"), "idle")
  assert.equal(stateOf("unknown"), "idle")
})

test("collapsing a session or window hides its rows and keeps the others", () => {
  const tree = buildTree(FIXTURE)
  const all = flatten(tree, new Set())
  assert.deepEqual(all.map((row) => row.level), [1, 2, 3, 3, 2, 3, 2, 3, 1, 2, 3])
  const noXx = flatten(tree, new Set(["s:xx"]))
  assert.deepEqual(noXx.map((row) => row.key), ["s:xx", "s:yy", "w:yy:0", paneKey("%20")])
  const noWindow = flatten(tree, new Set(["w:xx:0"]))
  assert.ok(noWindow.some((row) => row.key === "w:xx:0"))
  assert.ok(!noWindow.some((row) => row.key === paneKey("%1")))
  assert.ok(noWindow.some((row) => row.key === paneKey("%5")))
})

test("the keyboard model follows the WAI-ARIA tree pattern", () => {
  const rows: FlatRow[] = flatten(buildTree(FIXTURE), new Set())
  const at = (key: string) => navigate(rows, key, "ArrowDown")
  assert.deepEqual(at("s:xx"), { type: "focus", key: "w:xx:0" })
  assert.deepEqual(navigate(rows, "s:xx", "ArrowUp"), { type: "focus", key: "s:xx" }, "stays on the first row")
  assert.deepEqual(navigate(rows, "s:xx", "End"), { type: "focus", key: paneKey("%20") })
  assert.deepEqual(navigate(rows, paneKey("%20"), "Home"), { type: "focus", key: "s:xx" })
  // ArrowRight: open a closed group, else step into its first child.
  assert.deepEqual(navigate(rows, "s:xx", "ArrowRight"), { type: "focus", key: "w:xx:0" })
  const closed = flatten(buildTree(FIXTURE), new Set(["s:xx"]))
  assert.deepEqual(navigate(closed, "s:xx", "ArrowRight"), { type: "toggle", key: "s:xx", open: true })
  // ArrowLeft: close an open group, else go to the parent; a top-level row has nowhere to go.
  assert.deepEqual(navigate(rows, "s:xx", "ArrowLeft"), { type: "toggle", key: "s:xx", open: false })
  assert.deepEqual(navigate(rows, paneKey("%1"), "ArrowLeft"), { type: "focus", key: "w:xx:0" })
  assert.equal(navigate(closed, "s:xx", "ArrowLeft"), null)
  // Enter and Space: select a pane, toggle a group. A pane has no ArrowRight.
  assert.deepEqual(navigate(rows, paneKey("%1"), "Enter"), { type: "activate", key: paneKey("%1") })
  assert.deepEqual(navigate(rows, "w:xx:0", " "), { type: "toggle", key: "w:xx:0", open: false })
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
