import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"

import {
  flatten,
  navigate,
  survivingFocus,
  type FlatRow,
  type PaneNode,
  type SessionNode,
  type WindowNode,
} from "@/lib/tree"
import { hostGlyph, hostLabel, windowHost, type HostGlyphName, type WindowHost } from "@/lib/host-glyph"
import { scopeRowKey, type Scope } from "@/lib/scope"
import { sidebarDotLabel } from "@/lib/status-dot"
import { cn } from "@/lib/utils"
import { Icon } from "@/shell/icon"

import {
  DISCLOSURE,
  INDENT_REM,
  ROW_BASE,
  ROW_ONE_LINE,
  ROW_SELECTED,
  ROW_TWO_LINE,
} from "./geometry"
import { SidebarDot } from "./SidebarDot"

const PROVIDER_LABEL = { pi: "Pi", claude: "Claude" } as const

/**
 * The host glyph on a row (XTRM-1155): the monitor for the machine that serves this viewer, the
 * server for another host. It is decorative; the row's accessible name and tooltip carry `label`.
 */
function HostGlyph({ glyph, label, className }: { glyph: HostGlyphName; label: string; className?: string }) {
  return (
    <span
      data-testid="host-glyph"
      data-host={glyph === "monitor" ? "local" : "remote"}
      title={label}
      aria-hidden
      className={cn("flex shrink-0 items-center", className)}
    >
      <Icon name={glyph} size="xs" />
    </span>
  )
}

/**
 * The role on line 2, bold for every role. Lead and Manager keep their role colours (the thread
 * view's pill colours); every other role is bold in the normal line ink (operator ruling, XTRM-1028).
 */
function RoleLabel({ role }: { role: string | null }) {
  const key = role?.trim().toLowerCase()
  if (!key) return null
  const label = key.charAt(0).toUpperCase() + key.slice(1)
  if (key === "lead") return <span className="shrink-0 font-semibold text-role-lead-ink">{label}</span>
  if (key === "manager" || key === "coordinator") return <span className="shrink-0 font-semibold text-role-manager-ink">{label}</span>
  return <span className="shrink-0 font-semibold text-ink">{label}</span>
}

function GroupRow({
  row,
  node,
  host,
  onToggle,
}: {
  row: FlatRow
  node: SessionNode | WindowNode
  /** The window's host; null on a session row, which spans windows. */
  host: WindowHost | null
  onToggle: (key: string, open: boolean) => void
}) {
  const isSession = node.kind === "session"
  const count = node.kind === "session" ? node.count : node.panes.length
  return (
    <>
      <span className="flex min-w-0 items-center gap-1" style={{ marginLeft: "var(--row-indent)" }}>
        {host?.glyph ? <HostGlyph glyph={host.glyph} label={host.label} className="text-ink-muted" /> : null}
        <span
          className={cn("min-w-0 truncate text-sm", isSession ? "font-semibold text-ink" : "font-medium text-ink-muted")}
          title={node.kind === "window" ? `window ${node.index}${host ? ` · ${host.label}` : ""}` : undefined}
        >
          {node.name}
        </span>
      </span>
      {/* The chevron sits right after the label, as in the Claude Code sidebar. The row selects its
          scope; the chevron alone expands and collapses (the arrow keys do too). */}
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center justify-center text-ink-faint", DISCLOSURE)}
        onClick={(event) => {
          event.stopPropagation()
          onToggle(row.key, !row.expanded)
        }}
      >
        <Icon name="chevronDown" size="xs" className={cn("transition-transform", !row.expanded && "-rotate-90")} />
      </span>
      <span className="ml-auto shrink-0 text-xs text-ink-faint tabular">{count}</span>
    </>
  )
}

function PaneRowBody({ pane, selected, host }: { pane: PaneNode; selected: boolean; host: { glyph: HostGlyphName; label: string } | null }) {
  const { agent } = pane
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col" style={{ marginLeft: "var(--row-indent)" }}>
        {/* The pane row carries a host glyph only when it is the row that speaks for the window: a
            single-pane window's stand-in row, or a pane in a window that mixes hosts (XTRM-1155). */}
        <span className="flex min-w-0 items-center gap-1">
          {host ? <HostGlyph glyph={host.glyph} label={host.label} className="text-ink" /> : null}
          <span className={cn("min-w-0 truncate text-sm", selected ? "font-medium text-ink" : "text-ink")}>{agent.name}</span>
        </span>
        {/* Line 2, in the operator's order (XTRM-1048): the role, then the runtime, then the folder and
            the repo. Spacing only, no separators; the state rides on the dot alone and is not written
            here a second time. */}
        <span data-testid="pane-row-line2" className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
          <RoleLabel role={agent.role} />
          <span className="shrink-0">{PROVIDER_LABEL[agent.provider]}</span>
          {agent.repo ? (
            <span className="flex min-w-0 items-center gap-0.5" title={agent.cwd}>
              <Icon name="folder" size="micro" className="shrink-0" />
              <span className="min-w-0 truncate">{agent.repo}</span>
            </span>
          ) : null}
        </span>
      </span>
      <SidebarDot status={agent.status} note={agent.statusNote} className="mt-[0.1875rem]" />
    </>
  )
}

export function SessionTree({
  tree,
  scope,
  collapsed,
  onToggle,
  onSelect,
  localHostId = null,
}: {
  tree: SessionNode[]
  scope: Scope | null
  collapsed: ReadonlySet<string>
  onToggle: (key: string, open: boolean) => void
  onSelect: (scope: Scope) => void
  /** The viewer's own host id, once discovery reports hosts; null reads every reported host as remote. */
  localHostId?: string | null
}) {
  const localHost = localHostId ?? null
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed])
  // The window's host, and the host a pane row carries when the pane row is the one that speaks for
  // its window: a single-pane window has no row of its own, and a mixed window defers to its panes.
  const windowHosts = useMemo(() => {
    const map = new Map<string, WindowHost>()
    for (const session of tree) for (const window of session.windows) map.set(window.key, windowHost(window.panes.map((pane) => pane.agent), localHost))
    return map
  }, [tree, localHost])
  const paneHosts = useMemo(() => {
    const map = new Map<string, { glyph: HostGlyphName; label: string }>()
    for (const session of tree) {
      for (const window of session.windows) {
        const host = windowHost(window.panes.map((pane) => pane.agent), localHost)
        if (window.panes.length !== 1 && !host.mixed) continue
        for (const pane of window.panes) map.set(pane.key, { glyph: hostGlyph(pane.agent.host, localHost), label: hostLabel(pane.agent.host, localHost) })
      }
    }
    return map
  }, [tree, localHost])
  const refs = useRef(new Map<string, HTMLDivElement>())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // The row that holds focus now, and the parents seen so far. When a render removes the focused
  // row (a collapsed ancestor, a pane that left tmux) focus moves to its nearest visible ancestor
  // instead of falling to the page.
  const focusedRef = useRef<string | null>(null)
  const parents = useRef(new Map<string, string | null>())
  // A window with one pane has no row of its own: its pane row stands for it.
  const wanted = scope ? scopeRowKey(scope) : null
  const selectedKey =
    wanted && !rows.some((row) => row.key === wanted) && scope?.kind === "window"
      ? (rows.find((row) => {
          if (row.node.kind !== "pane" || row.node.session !== scope.session) return false
          const agent = row.node.agent
          if (scope.windowId) return agent.windowId === scope.windowId
          return agent.windowIndex === scope.window
        })?.key ?? wanted)
      : wanted

  // Roving tabindex: one row is tabbable. The remembered row if it is still visible, else the
  // selected pane, else the first row.
  const tabbable =
    (focusKey && rows.some((row) => row.key === focusKey) && focusKey) ||
    (selectedKey && rows.some((row) => row.key === selectedKey) && selectedKey) ||
    rows[0]?.key ||
    null

  const focus = useCallback((key: string) => {
    setFocusKey(key)
    refs.current.get(key)?.focus()
  }, [])

  useLayoutEffect(() => {
    for (const row of rows) parents.current.set(row.key, row.parentKey)
    const held = focusedRef.current
    if (!held || rows.some((row) => row.key === held)) return
    const active = document.activeElement
    if (active && active !== document.body) return
    const target = survivingFocus(parents.current, rows, held)
    focusedRef.current = target
    if (target) focus(target)
  }, [rows, focus])

  const activate = useCallback(
    (row: FlatRow) => {
      const node = row.node
      if (node.kind === "pane") {
        onSelect({ kind: "pane", session: node.session, window: node.agent.windowIndex, windowId: node.agent.windowId, paneId: node.agent.paneId })
      } else if (node.kind === "window") {
        onSelect({ kind: "window", session: node.session, window: node.index, windowId: node.windowId })
      } else {
        onSelect({ kind: "session", session: node.name })
      }
    },
    [onSelect],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, row: FlatRow) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const action = navigate(rows, row.key, event.key)
    if (!action) return
    event.preventDefault()
    if (action.type === "focus") focus(action.key)
    else if (action.type === "toggle") onToggle(action.key, action.open)
    else activate(row)
  }

  return (
    <div role="tree" aria-label="tmux sessions" className="flex flex-col">
      {rows.map((row) => {
        const selected = row.key === selectedKey
        const windowRowHost = row.node.kind === "window" ? (windowHosts.get(row.key) ?? null) : null
        const paneRowHost = row.node.kind === "pane" ? (paneHosts.get(row.key) ?? null) : null
        const rowHost = windowRowHost ?? paneRowHost
        const hostWords = rowHost ? `, ${rowHost.label}` : ""
        const label =
          row.node.kind === "pane"
            ? `${row.node.agent.name}, ${row.node.agent.role ? `${row.node.agent.role}, ` : ""}${PROVIDER_LABEL[row.node.agent.provider]}, ${sidebarDotLabel(row.node.agent.status, row.node.agent.statusNote)}${hostWords}`
            : row.node.kind === "session"
              ? `${row.node.name}, ${row.node.count} agents`
              : `${row.node.name}, ${row.node.panes.length} agents${hostWords}`
        return (
          <div
            key={row.key}
            ref={(element) => {
              if (element) refs.current.set(row.key, element)
              else refs.current.delete(row.key)
            }}
            role="treeitem"
            aria-level={row.level}
            aria-posinset={row.index + 1}
            aria-setsize={row.siblings}
            aria-expanded={row.expandable ? row.expanded : undefined}
            aria-selected={selected}
            aria-label={label}
            title={row.node.kind === "pane" ? `${row.node.agent.provider} · ${row.node.agent.windowName || `window ${row.node.agent.windowIndex}`} · ${row.node.agent.cwd}${paneRowHost ? ` · ${paneRowHost.label}` : ""}` : undefined}
            tabIndex={row.key === tabbable ? 0 : -1}
            data-key={row.key}
            data-provider={row.node.kind === "pane" ? row.node.agent.provider : undefined}
            onClick={() => {
              setFocusKey(row.key)
              activate(row)
            }}
            onFocus={() => {
              focusedRef.current = row.key
              setFocusKey(row.key)
            }}
            onBlur={() => {
              // A blur that leaves the row in the document is the user moving away; a row that was
              // removed while focused stays remembered so the layout effect can recover focus.
              const key = row.key
              window.setTimeout(() => {
                if (focusedRef.current === key && refs.current.get(key)?.isConnected) focusedRef.current = null
              }, 0)
            }}
            onKeyDown={(event) => handleKeyDown(event, row)}
            style={{ "--row-indent": `${(row.level - 1) * INDENT_REM}rem` } as CSSProperties}
            className={cn(ROW_BASE, row.node.kind === "pane" ? ROW_TWO_LINE : ROW_ONE_LINE, selected && ROW_SELECTED)}
          >
            {row.node.kind === "pane" ? (
              <PaneRowBody pane={row.node} selected={selected} host={paneRowHost} />
            ) : (
              <GroupRow row={row} node={row.node} host={windowRowHost} onToggle={onToggle} />
            )}
          </div>
        )
      })}
    </div>
  )
}
