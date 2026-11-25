import { useCallback, useEffect, useMemo, useState } from "react"

import { HalfSwitch } from "@/shell/HalfSwitch"
import { IconButton } from "@/shell/IconButton"
import { modShortcut } from "@/shell/layout"
import type { Scope } from "@/lib/scope"
import { buildTree } from "@/lib/tree"
import type { ViewerSession } from "@/shared/types"

import { SessionTree } from "./SessionTree"

const STORAGE_KEY = "pi-viewer-sidebar"

function readClosed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (typeof parsed === "object" && parsed !== null) {
      const closed = (parsed as Record<string, unknown>).closed
      if (Array.isArray(closed)) return new Set(closed.filter((key): key is string => typeof key === "string"))
    }
  } catch {
    // storage can be blocked or hold garbage; start open
  }
  return new Set()
}

/**
 * The sidebar content inside the console's container (src/shell/ConsoleShell.tsx): the console's
 * 44px header with the Work / Agent switcher and the collapse button, then the viewer's own
 * session > window > pane tree. Open, width and the narrow overlay belong to the shell; this
 * component keeps only which groups are folded, and persists that.
 */
export function Sidebar({
  sessions,
  scope,
  onSelect,
  onCollapse,
}: {
  sessions: ViewerSession[]
  scope: Scope | null
  onSelect: (scope: Scope) => void
  onCollapse: () => void
}) {
  const [closed, setClosed] = useState<Set<string>>(readClosed)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ closed: [...closed] }))
    } catch {
      // keep the in-memory state
    }
  }, [closed])

  const tree = useMemo(() => buildTree(sessions), [sessions])
  const total = useMemo(() => tree.reduce((sum, session) => sum + session.count, 0), [tree])

  const toggleGroup = useCallback((key: string, open: boolean) => {
    setClosed((previous) => {
      const next = new Set(previous)
      if (open) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <aside aria-label="Sessions" data-testid="sidebar" className="flex h-full min-h-0 min-w-0 flex-col bg-sidebar">
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-2">
        <HalfSwitch />
        <IconButton data-testid="sidebar-collapse" icon="sidebar" label="Collapse sidebar" shortcut={modShortcut("B")} aria-expanded onClick={onCollapse} />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1.5 pl-3">
        <h2 className="text-xs font-medium text-ink-faint">Sessions</h2>
        <span className="text-xs text-ink-faint tabular">{total || ""}</span>
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {tree.length ? (
          <SessionTree tree={tree} scope={scope} collapsed={closed} onToggle={toggleGroup} onSelect={onSelect} />
        ) : (
          <p className="px-3 py-2 text-xs text-ink-faint">No pi or claude agent in tmux.</p>
        )}
      </div>
    </aside>
  )
}
