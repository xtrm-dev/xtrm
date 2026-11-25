import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"

import { agentsInScope, type Scope } from "@/lib/scope"
import { buildTree, flatten, railNext, stateOf, STATE_LABEL } from "@/lib/tree"
import type { ViewerSession } from "@/shared/types"
import { cn } from "@/lib/utils"

import { RAIL_WIDTH, SIDEBAR_WIDTH } from "./geometry"
import { SessionTree } from "./SessionTree"
import { SidebarDot } from "./SidebarDot"

const STORAGE_KEY = "pi-viewer-sidebar"
const NARROW_QUERY = "(max-width: 767px)"

interface Stored {
  collapsed: boolean
  closed: string[]
}

function readStored(): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>
      return {
        collapsed: record.collapsed === true,
        closed: Array.isArray(record.closed) ? record.closed.filter((key): key is string => typeof key === "string") : [],
      }
    }
  } catch {
    // storage can be blocked or hold garbage; start open
  }
  return { collapsed: false, closed: [] }
}

/** Tracks the narrow breakpoint, so a resize or rotation re-evaluates the layout. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return narrow
}

/**
 * Left sidebar: tmux session > window > pane. Console primitives only (no ReUI or shadcn
 * Sidebar). The plane is `bg-sidebar` with a quiet secondary-pane edge (`border-border-subtle`,
 * design doc §11); the header is the section-header step (text-xs, ink-faint); there is no
 * search, switcher or footer. It collapses to an icon rail of status dots.
 *
 * Two states, kept apart: on desktop the rail/open choice is the operator's and is persisted;
 * on a narrow screen the sidebar is an overlay that is closed by default, is never persisted,
 * and closes on Escape, on a click outside, and when a pane is chosen.
 */
export function Sidebar({
  sessions,
  scope,
  onSelect,
}: {
  sessions: ViewerSession[]
  scope: Scope | null
  onSelect: (scope: Scope) => void
}) {
  const [stored] = useState(readStored)
  const narrow = useNarrow()
  const [desktopCollapsed, setDesktopCollapsed] = useState(stored.collapsed)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(() => new Set(stored.closed))
  const collapsed = narrow ? !overlayOpen : desktopCollapsed

  // Only the desktop choice and the closed groups are persisted; the overlay never is.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed: desktopCollapsed, closed: [...closed] }))
    } catch {
      // keep the in-memory state
    }
  }, [desktopCollapsed, closed])

  useEffect(() => {
    if (!narrow) setOverlayOpen(false)
  }, [narrow])

  // Collapsing and expanding swap which button is on screen; focus follows the toggle, so a
  // keyboard user is not dropped on the page. The same counterpart button takes focus when the
  // overlay closes on Escape, a click outside or a choice, because the focused row is gone.
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    toggleRef.current?.focus()
  }, [collapsed])

  const setOpen = useCallback(
    (open: boolean) => {
      restoreFocus.current = true
      if (narrow) setOverlayOpen(open)
      else setDesktopCollapsed(!open)
    },
    [narrow],
  )

  useEffect(() => {
    if (!narrow || !overlayOpen) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [narrow, overlayOpen, setOpen])

  const tree = useMemo(() => buildTree(sessions), [sessions])
  const total = useMemo(() => tree.reduce((sum, session) => sum + session.count, 0), [tree])
  const railPanes = useMemo(
    () => flatten(tree, new Set()).flatMap((row) => (row.node.kind === "pane" ? [row.node] : [])),
    [tree],
  )

  const toggleGroup = useCallback((key: string, open: boolean) => {
    setClosed((previous) => {
      const next = new Set(previous)
      if (open) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Choosing any level (session, window or pane) selects its scope; on a narrow screen it also closes the overlay.
  const choose = useCallback(
    (next: Scope) => {
      onSelect(next)
      if (narrow) setOpen(false)
    },
    [onSelect, narrow, setOpen],
  )
  const inScope = useMemo(() => new Set(agentsInScope(sessions, scope).map((agent) => agent.paneId)), [sessions, scope])

  // Rail toolbar: one Tab stop, arrow keys move between agents.
  const railRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [railIndex, setRailIndex] = useState(0)
  const selectedRail = railPanes.findIndex((pane) => inScope.has(pane.agent.paneId))
  const railTab = Math.min(railIndex >= 0 && railIndex < railPanes.length ? railIndex : Math.max(selectedRail, 0), Math.max(railPanes.length - 1, 0))
  function onRailKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = railNext(railPanes.length, index, event.key)
    if (next === null) return
    event.preventDefault()
    setRailIndex(next)
    railRefs.current[next]?.focus()
  }

  return (
    // The aside holds the layout space: the rail width on a narrow screen however it is
    // opened, because an open sidebar there floats over the thread instead of pushing it.
    <aside
      aria-label="Sessions"
      className={cn("relative shrink-0 bg-sidebar", collapsed ? RAIL_WIDTH : cn(RAIL_WIDTH, "md:w-[15rem]"))}
      data-collapsed={collapsed}
      data-testid="sidebar"
    >
      {narrow && overlayOpen && (
        <div
          aria-hidden
          data-testid="sidebar-backdrop"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-deep/60"
        />
      )}
      <div
        className={cn(
          "flex h-full min-h-0 flex-col border-r border-border-subtle bg-sidebar",
          !collapsed && cn("max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-float", SIDEBAR_WIDTH),
          !collapsed && "md:w-full",
          collapsed && "w-full",
        )}
      >
        {collapsed ? (
          <>
            <div className="flex h-8 shrink-0 items-center justify-center">
              <button
                ref={toggleRef}
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Expand sidebar"
                aria-expanded={false}
                className="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-none"
              >
                <PanelLeftOpenIcon className="size-[0.8125rem]" />
              </button>
            </div>
            <div role="toolbar" aria-label="Agents" aria-orientation="vertical" className="thin-scrollbar flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto pb-2">
              {railPanes.map((pane, index) => {
                const { agent } = pane
                const selected = inScope.has(agent.paneId)
                const state = stateOf(agent.status)
                return (
                  <button
                    key={pane.key}
                    ref={(element) => {
                      railRefs.current[index] = element
                    }}
                    type="button"
                    tabIndex={index === railTab ? 0 : -1}
                    onClick={() => {
                      setRailIndex(index)
                      choose({ kind: "pane", session: pane.session, window: agent.windowIndex, paneId: agent.paneId })
                    }}
                    onFocus={() => setRailIndex(index)}
                    onKeyDown={(event) => onRailKey(event, index)}
                    aria-label={`${agent.name}, ${STATE_LABEL[state]}`}
                    aria-current={selected ? "true" : undefined}
                    title={`${agent.name} · ${STATE_LABEL[state]}`}
                    className={cn(
                      "relative flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
                      selected && "bg-hover",
                    )}
                  >
                    <SidebarDot state={state} />
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <div className="flex h-8 shrink-0 items-center gap-1.5 pr-1.5 pl-3">
              <h2 className="text-xs font-medium text-ink-faint">Sessions</h2>
              <span className="text-xs text-ink-faint tabular">{total || ""}</span>
              <button
                ref={toggleRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse sidebar"
                aria-expanded
                className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:outline-none"
              >
                <PanelLeftCloseIcon className="size-[0.8125rem]" />
              </button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {tree.length ? (
                <SessionTree tree={tree} scope={scope} collapsed={closed} onToggle={toggleGroup} onSelect={choose} />
              ) : (
                <p className="px-3 py-2 text-xs text-ink-faint">No pi or claude agent in tmux.</p>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
