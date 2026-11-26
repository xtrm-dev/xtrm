// Shell split: a resizable sidebar panel, a hairline separator, and a fill panel (XTRM-1044 shell,
// XTRM-1067 replacement for motion-panels).
//
// motion-panels pulled framer-motion and motion-dom into the first paint — a 151 kB chunk, 51 kB gzip
// — for one draggable split whose behaviour is a width, a clamp, a drag, two arrow keys and a
// collapse. The console's values are unchanged (packages/xtrm-app/src/shell/layout.ts: default 264,
// min 220, max 360, 250ms cubic-bezier(0.32, 0.72, 0, 1)), and the sidebar gate checks the drag, both
// clamp edges, persistence, the keyboard path, the collapse and the reopen.
//
// Width stays where it already lived: the caller's layout state. A drag calls `onSizeChange` on every
// pointer move, so the panel and the separator follow the pointer with no second copy of the width.
import { createContext, useContext, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { SHELL_MOTION } from "./layout"

/** One arrow key press moves the separator this far. */
const KEY_STEP = 16

type Split = { width: number; min: number; max: number; setWidth: (width: number) => void }

type SplitContextValue = {
  split: React.RefObject<Split>
  dragging: boolean
  setDragging: (dragging: boolean) => void
}

const SplitContext = createContext<SplitContextValue | null>(null)

function useSplit() {
  const value = useContext(SplitContext)
  if (!value) throw new Error("the shell's split parts must be used inside ResizableGroup")
  return value
}

const asPx = (value: number | `${number}%`): number => (typeof value === "number" ? value : Number.parseFloat(value))

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))

export function ResizableGroup({ children, className }: { children: ReactNode; className?: string }) {
  const split = useRef<Split>({ width: 0, min: 0, max: Number.POSITIVE_INFINITY, setWidth: () => undefined })
  const [dragging, setDragging] = useState(false)
  return (
    <div className={cn("relative flex min-w-0 flex-1", className)}>
      <SplitContext.Provider value={{ split, dragging, setDragging }}>{children}</SplitContext.Provider>
    </div>
  )
}

export function ResizablePanel<S extends number | `${number}%`>({
  size,
  minSize,
  maxSize,
  onSizeChange,
  collapsed,
  children,
  className,
  ...rest
}: {
  collapsed?: boolean
  size: S
  minSize: number | `${number}%`
  maxSize: number | `${number}%`
  onSizeChange?: (size: S) => void
  children: ReactNode
  className?: string
  "data-testid"?: string
}) {
  const { split, dragging } = useSplit()
  // The separator reads this at interaction time, so the latest props are always current.
  split.current = {
    width: asPx(size),
    min: asPx(minSize),
    max: asPx(maxSize),
    setWidth: (width: number) => onSizeChange?.(width as S),
  }
  return (
    <div
      style={{
        width: collapsed ? 0 : size,
        flex: "0 0 auto",
        transition: `width ${SHELL_MOTION.durationMs}ms ${SHELL_MOTION.easingCss}`,
        // A drag must follow the pointer, not ease behind it.
        ...(dragging ? { transition: "none" } : null),
      }}
      className={cn("min-w-0 overflow-hidden", className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export function FillPanel({ children, className, ...rest }: { children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <div className={cn("min-w-0 flex-1", className)} {...rest}>
      {children}
    </div>
  )
}

/**
 * Hairline separator; the hit area is wider than the visible line. It sits ON the panel's edge rather
 * than in the flow, so the content beside the sidebar starts exactly at the sidebar's width — the console
 * does the same, and a separator that took 8px of flow would shift every row of the channel by 8px.
 * Drag with the pointer, or focus it and use the arrow keys (Home and End jump to the limits). Always
 * mounted, hidden when the sidebar is closed, as before.
 */
export function ResizeHandle({ label, hidden }: { label: string; hidden?: boolean }) {
  const { split, setDragging } = useSplit()
  const drag = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width: split.current.width }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    const { min, max, setWidth } = split.current
    setWidth(clamp(start.width + (event.clientX - start.x), min, max))
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { width, min, max, setWidth } = split.current
    const next =
      event.key === "ArrowRight" ? width + KEY_STEP : event.key === "ArrowLeft" ? width - KEY_STEP : event.key === "Home" ? min : event.key === "End" ? max : null
    if (next === null) return
    event.preventDefault()
    setWidth(clamp(next, min, max))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-hidden={hidden || undefined}
      aria-valuemin={hidden ? undefined : split.current.min}
      aria-valuemax={hidden ? undefined : split.current.max}
      aria-valuenow={hidden ? undefined : split.current.width}
      tabIndex={hidden ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      style={{ position: "absolute", left: split.current.width - 4, top: 0, bottom: 0 }}
      className={cn("group/sep z-10 w-2 cursor-col-resize outline-none", hidden && "hidden")}
    >
      <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-focus-visible/sep:bg-accent" />
    </div>
  )
}
