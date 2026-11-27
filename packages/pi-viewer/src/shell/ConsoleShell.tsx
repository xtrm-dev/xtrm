import { useEffect, type ReactNode } from "react"
import { Tooltip } from "radix-ui"

import { cn } from "@/lib/utils"

import { FillPanel, ResizableGroup, ResizeHandle, ResizablePanel } from "./resizable"
import { SIDEBAR, useSidebarLayout } from "./layout"

type Layout = ReturnType<typeof useSidebarLayout>

/**
 * The console's shell frame (packages/xtrm-app/src/shell/AppShell.tsx `ShellLayout`, XTRM-1044): a
 * split of a resizable sidebar panel, a hairline resize handle, and a fill panel (./resizable). The
 * sidebar collapses to width 0 and its reopen button lives in the top bar, as in the console; the
 * panel is `inert` while collapsed. On a narrow screen the console has no pattern, so the sidebar is an
 * overlay at the console's default width that closes on Escape or a click outside.
 */
export function ConsoleShell({ layout, sidebar, children }: { layout: Layout; sidebar: ReactNode; children: ReactNode }) {
  const { narrow, open, width, setOpen, resize } = layout
  useEffect(() => {
    if (!narrow || !open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [narrow, open, setOpen])
  return (
    <Tooltip.Provider delayDuration={350}>
      {narrow ? (
        <div className="relative flex h-dvh bg-canvas text-ink">
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
          {open ? (
            <>
              <div aria-hidden data-testid="sidebar-backdrop" onClick={() => setOpen(false)} className="fixed inset-0 z-20 bg-deep/60" />
              <div
                data-testid="sidebar-panel"
                data-state="expanded"
                style={{ width: SIDEBAR.default }}
                className="fixed inset-y-0 left-0 z-30 max-w-[85vw] bg-sidebar shadow-float"
              >
                {sidebar}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <ResizableGroup className="h-dvh bg-canvas text-ink">
          <ResizablePanel
            data-testid="sidebar-panel"
            size={width}
            minSize={SIDEBAR.min}
            maxSize={SIDEBAR.max}
            collapsed={!open}
            onSizeChange={resize}
          >
            <div inert={!open} data-state={open ? "expanded" : "collapsed"} className={cn("h-full bg-sidebar")}>
              {sidebar}
            </div>
          </ResizablePanel>
          <ResizeHandle label="Resize sidebar" hidden={!open} />
          <FillPanel className="flex flex-col overflow-hidden">{children}</FillPanel>
        </ResizableGroup>
      )}
    </Tooltip.Provider>
  )
}
