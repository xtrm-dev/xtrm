import type { AgentStatus, ViewerAgent, ViewerSession } from "@/shared/types"

/**
 * The sidebar's data model: tmux session > window > pane, built from the agents that
 * discovery already returns. A pane is listed only when it holds a pi or claude agent, so
 * empty panes, and windows or sessions left with no agent, never appear.
 */

export type SidebarState = "idle" | "running" | "error"

/**
 * The states a pane row can show, and nothing else. The server's `waiting` means a finished
 * turn that awaits input, which is idle. "Needs attention" is not a state today: the server
 * proves no condition for it (no permission prompt, no question), so the set is idle, running
 * and error, and `unknown` reads as idle.
 */
export function stateOf(status: AgentStatus): SidebarState {
  if (status === "working") return "running"
  if (status === "error") return "error"
  return "idle"
}

export const STATE_LABEL: Record<SidebarState, string> = {
  idle: "idle",
  running: "running",
  error: "error",
}

export interface PaneNode {
  kind: "pane"
  key: string
  session: string
  agent: ViewerAgent
}

export interface WindowNode {
  kind: "window"
  key: string
  session: string
  index: number
  name: string
  panes: PaneNode[]
}

export interface SessionNode {
  kind: "session"
  key: string
  name: string
  windows: WindowNode[]
  /** Agents in the session, the count the row shows. */
  count: number
}

export type TreeNode = SessionNode | WindowNode | PaneNode

export const paneKey = (paneId: string) => `p:${paneId}`

export function buildTree(sessions: ViewerSession[]): SessionNode[] {
  const tree: SessionNode[] = []
  for (const session of sessions) {
    const byWindow = new Map<number, ViewerAgent[]>()
    for (const agent of session.agents) {
      if (!agent.paneId) continue
      const list = byWindow.get(agent.windowIndex) ?? []
      list.push(agent)
      byWindow.set(agent.windowIndex, list)
    }
    const windows: WindowNode[] = [...byWindow.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, agents]) => {
        const ordered = [...agents].sort((a, b) => a.paneIndex - b.paneIndex || a.paneId.localeCompare(b.paneId))
        return {
          kind: "window" as const,
          key: `w:${session.name}:${index}`,
          session: session.name,
          index,
          name: ordered[0]?.windowName || `window ${index}`,
          panes: ordered.map((agent) => ({
            kind: "pane" as const,
            key: paneKey(agent.paneId),
            session: session.name,
            agent,
          })),
        }
      })
    const count = windows.reduce((sum, window) => sum + window.panes.length, 0)
    if (!count) continue
    tree.push({ kind: "session", key: `s:${session.name}`, name: session.name, windows, count })
  }
  return tree
}

/**
 * The session being read refreshes with the thread poll; the others keep the discovery poll.
 * A thread payload that belongs to another session (a stale one, right after a cross-session
 * select) is ignored, so no session shows another session's agents and no pane key repeats.
 */
export function mergeLive(
  sessions: ViewerSession[],
  current: string | null,
  fresh: { session: string; agents: ViewerAgent[] } | null,
): ViewerSession[] {
  if (!fresh || !current || fresh.session !== current) return sessions
  return sessions.map((entry) => (entry.name === current ? { ...entry, agents: fresh.agents } : entry))
}

export interface FlatRow {
  key: string
  /** aria-level: session 1, window 2, pane 3. */
  level: 1 | 2 | 3
  node: TreeNode
  parentKey: string | null
  expandable: boolean
  expanded: boolean
  /** Position among its siblings, for aria-posinset and aria-setsize. */
  index: number
  siblings: number
}

/** The rows that are visible: children of a collapsed group are left out. */
export function flatten(tree: SessionNode[], collapsed: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = []
  tree.forEach((session, sessionIndex) => {
    const sessionOpen = !collapsed.has(session.key)
    rows.push({
      key: session.key,
      level: 1,
      node: session,
      parentKey: null,
      expandable: true,
      expanded: sessionOpen,
      index: sessionIndex,
      siblings: tree.length,
    })
    if (!sessionOpen) return
    session.windows.forEach((window, windowIndex) => {
      const windowOpen = !collapsed.has(window.key)
      rows.push({
        key: window.key,
        level: 2,
        node: window,
        parentKey: session.key,
        expandable: true,
        expanded: windowOpen,
        index: windowIndex,
        siblings: session.windows.length,
      })
      if (!windowOpen) return
      window.panes.forEach((pane, paneIndex) => {
        rows.push({
          key: pane.key,
          level: 3,
          node: pane,
          parentKey: window.key,
          expandable: false,
          expanded: false,
          index: paneIndex,
          siblings: window.panes.length,
        })
      })
    })
  })
  return rows
}

export type TreeAction =
  | { type: "focus"; key: string }
  | { type: "toggle"; key: string; open: boolean }
  | { type: "activate"; key: string }

/** Keyboard model of the tree (WAI-ARIA tree pattern). Returns null for a key it does not own. */
export function navigate(rows: FlatRow[], currentKey: string, key: string): TreeAction | null {
  const at = rows.findIndex((row) => row.key === currentKey)
  if (at === -1) return null
  const row = rows[at]
  switch (key) {
    case "ArrowDown":
      return at + 1 < rows.length ? { type: "focus", key: rows[at + 1].key } : { type: "focus", key: row.key }
    case "ArrowUp":
      return at > 0 ? { type: "focus", key: rows[at - 1].key } : { type: "focus", key: row.key }
    case "Home":
      return { type: "focus", key: rows[0].key }
    case "End":
      return { type: "focus", key: rows[rows.length - 1].key }
    case "ArrowRight":
      if (row.expandable && !row.expanded) return { type: "toggle", key: row.key, open: true }
      if (row.expandable && rows[at + 1]?.parentKey === row.key) return { type: "focus", key: rows[at + 1].key }
      return null
    case "ArrowLeft":
      if (row.expandable && row.expanded) return { type: "toggle", key: row.key, open: false }
      return row.parentKey ? { type: "focus", key: row.parentKey } : null
    case "Enter":
    case " ":
      // Every level is a selectable scope; the arrows expand and collapse.
      return { type: "activate", key: row.key }
    default:
      return null
  }
}

/**
 * Where focus goes when the focused row is no longer visible: its nearest visible ancestor,
 * found through the parents remembered from earlier renders. Null when none is left.
 */
export function survivingFocus(
  parents: ReadonlyMap<string, string | null>,
  rows: readonly FlatRow[],
  key: string,
): string | null {
  const visible = new Set(rows.map((row) => row.key))
  let cursor: string | null | undefined = key
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    if (visible.has(cursor)) return cursor
    seen.add(cursor)
    cursor = parents.get(cursor)
  }
  return null
}

/** One-axis roving focus for the rail toolbar. Returns the next index, or null for a key it does not own. */
export function railNext(count: number, index: number, key: string): number | null {
  if (count <= 0) return null
  if (key === "ArrowDown") return Math.min(index + 1, count - 1)
  if (key === "ArrowUp") return Math.max(index - 1, 0)
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return null
}
