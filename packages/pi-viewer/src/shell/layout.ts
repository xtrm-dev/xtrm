import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Sidebar layout state of the console shell, copied from packages/xtrm-app/src/shell/layout.ts
 * (XTRM-1044): the limits, the clamp, the persistence key and shape, the motion constants and the
 * Mod+B rule. Only the sidebar half is here; the console's inspector drawer does not exist in the viewer.
 */

/** Console `SIDEBAR`: default 264, min 220, max 360 (px). */
export const SIDEBAR = { default: 264, min: 220, max: 360 } as const

/** Console `LAYOUT_STORAGE_KEY`. A different origin from the console's, so the values never collide. */
export const LAYOUT_STORAGE_KEY = "xtrm.console.layout.v1"

/** Console `SHELL_MOTION`: 250ms, cubic-bezier(0.32, 0.72, 0, 1). */
export const SHELL_MOTION = { durationMs: 250, easingCss: "cubic-bezier(0.32, 0.72, 0, 1)" } as const

export const clampSidebar = (width: number) => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(width)))

/** Console `modShortcut`: the label of the Mod key, for the tooltip. */
export function modShortcut(key: string): string {
  const platform = typeof navigator !== "undefined" ? `${navigator.platform} ${navigator.userAgent}` : ""
  return /mac|iphone|ipad/i.test(platform) ? `⌘${key}` : `Ctrl ${key}`
}

/** Console `isShortcutSuppressed`: a shortcut must not fire in editable fields, dialogs and menus. */
export function isShortcutSuppressed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest("[role=dialog],[role=menu],[role=listbox]")) return true
  return !!target.closest("input,textarea,select,[contenteditable=true]")
}

export interface SidebarLayout {
  open: boolean
  width: number
}

const DEFAULT_LAYOUT: SidebarLayout = { open: true, width: SIDEBAR.default }

/** Console `restoreLayout`, sidebar fields only: validated, clamped, never throws. */
export function restoreSidebar(storage: Pick<Storage, "getItem"> = localStorage): SidebarLayout {
  try {
    const raw: unknown = JSON.parse(storage.getItem(LAYOUT_STORAGE_KEY) ?? "null")
    if (!raw || typeof raw !== "object") return DEFAULT_LAYOUT
    const stored = raw as { sidebarOpen?: unknown; sidebarWidth?: unknown }
    return {
      open: typeof stored.sidebarOpen === "boolean" ? stored.sidebarOpen : true,
      width:
        typeof stored.sidebarWidth === "number" && Number.isFinite(stored.sidebarWidth)
          ? clampSidebar(stored.sidebarWidth)
          : SIDEBAR.default,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

/** Console `persistLayout`, sidebar fields only; other fields of the stored object are kept. */
export function persistSidebar(layout: SidebarLayout, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  try {
    let previous: Record<string, unknown> = {}
    try {
      const raw: unknown = JSON.parse(storage.getItem(LAYOUT_STORAGE_KEY) ?? "null")
      if (raw && typeof raw === "object") previous = raw as Record<string, unknown>
    } catch {
      // unreadable: start from an empty object
    }
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...previous, sidebarOpen: layout.open, sidebarWidth: layout.width }))
  } catch {
    // storage unavailable: the layout simply does not persist
  }
}

const NARROW_QUERY = "(max-width: 767px)"

/** Tracks the narrow breakpoint, so a resize or rotation re-evaluates the layout. */
export function useNarrow(): boolean {
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
 * The shell's sidebar state. Desktop: open and width are the operator's and are persisted. Narrow:
 * the sidebar is an overlay that starts closed and is never persisted. Mod+B toggles either.
 */
export function useSidebarLayout() {
  const narrow = useNarrow()
  const [layout, setLayout] = useState(restoreSidebar)
  const [overlay, setOverlay] = useState(false)
  const open = narrow ? overlay : layout.open
  const userToggled = useRef(false)

  useEffect(() => persistSidebar(layout), [layout])
  useEffect(() => {
    if (!narrow) setOverlay(false)
  }, [narrow])

  const setOpen = useCallback(
    (next: boolean) => {
      userToggled.current = true
      if (narrow) setOverlay(next)
      else setLayout((current) => (current.open === next ? current : { ...current, open: next }))
    },
    [narrow],
  )
  const toggle = useCallback(() => setOpen(!open), [open, setOpen])

  // A drag reports a width on every pointer move; only a settled, in-range size is a width.
  const resize = useCallback((width: number) => {
    setLayout((current) =>
      !current.open || width < SIDEBAR.min || clampSidebar(width) === current.width
        ? current
        : { ...current, width: clampSidebar(width) },
    )
  }, [])

  // Focus follows the toggle: the button that swaps in takes it, so a keyboard user is not dropped on the page.
  useEffect(() => {
    if (!userToggled.current) return
    userToggled.current = false
    const id = window.setTimeout(() => {
      document.querySelector<HTMLElement>(open ? '[data-testid="sidebar-collapse"]' : '[data-testid="sidebar-reopen"]')?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "b") return
      if (isShortcutSuppressed(event.target)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggle])

  return { narrow, open, width: layout.width, setOpen, toggle, resize }
}
