import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { buildTree, flatten, stateOf, STATE_LABEL, type Selection } from "@/lib/tree"
import type { ViewerSession } from "@/shared/types"
import { cn } from "@/lib/utils"

import { RAIL_WIDTH, SIDEBAR_WIDTH } from "./geometry"
import { SessionTree } from "./SessionTree"
import { SidebarDot } from "./SidebarDot"

const STORAGE_KEY = "pi-viewer-sidebar"

interface Stored {
  collapsed: boolean
  closed: string[]
}

function narrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
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

/**
 * Left sidebar: tmux session > window > pane. Console primitives only (no ReUI or shadcn
 * Sidebar). The plane is `bg-sidebar` with a quiet secondary-pane edge (`border-border-subtle`,
 * design doc §11); the header is the section-header step (text-xs, ink-faint); there is no
 * search, switcher or footer. It collapses to an icon rail of status dots.
 */
export function Sidebar({
  sessions,
  selection,
  onSelect,
}: {
  sessions: ViewerSession[]
  selection: Selection | null
  onSelect: (selection: Selection) => void
}) {
  const [stored] = useState(readStored)
  // A narrow screen starts on the rail: an open sidebar would cover the thread.
  const [collapsed, setCollapsed] = useState(() => (narrow() ? true : stored.collapsed))
  const [closed, setClosed] = useState<Set<string>>(() => new Set(stored.closed))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed, closed: [...closed] }))
    } catch {
      // keep the in-memory state
    }
  }, [collapsed, closed])

  const tree = useMemo(() => buildTree(sessions), [sessions])
  const total = useMemo(() => tree.reduce((sum, session) => sum + session.count, 0), [tree])
  const railRows = useMemo(() => flatten(tree, new Set()).filter((row) => row.node.kind === "pane"), [tree])

  const toggle = useCallback((key: string, open: boolean) => {
    setClosed((previous) => {
      const next = new Set(previous)
      if (open) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const choose = useCallback(
    (session: string, paneId: string) => {
      onSelect({ session, paneId })
      if (narrow()) setCollapsed(true)
    },
    [onSelect],
  )

  return (
    // The aside holds the layout space: the rail width on a narrow screen however it is
    // opened, because an open sidebar there floats over the thread instead of pushing it.
    <aside
      aria-label="Sessions"
      className={cn("relative shrink-0 bg-sidebar", collapsed ? RAIL_WIDTH : cn(RAIL_WIDTH, "md:w-[16.5rem]"))}
      data-collapsed={collapsed}
      data-testid="sidebar"
    >
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
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
                aria-expanded={false}
                className="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <PanelLeftOpenIcon className="size-[0.8125rem]" />
              </button>
            </div>
            <div role="toolbar" aria-label="Agents" aria-orientation="vertical" className="thin-scrollbar flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto pb-2">
              {railRows.map((row) => {
                if (row.node.kind !== "pane") return null
                const { agent } = row.node
                const selected = selection?.paneId === agent.paneId
                const state = stateOf(agent.status)
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => choose(row.node.kind === "pane" ? row.node.session : "", agent.paneId)}
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
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                aria-expanded
                className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <PanelLeftCloseIcon className="size-[0.8125rem]" />
              </button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {tree.length ? (
                <SessionTree tree={tree} selection={selection} collapsed={closed} onToggle={toggle} onSelect={choose} />
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
