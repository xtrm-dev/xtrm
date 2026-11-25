import { useEffect, useRef } from "react"

/**
 * Placeholder for the restyle's `src/lib/ticker.tsx` (XTRM-1034), same API: one span whose text
 * node ticks once a second without a React re-render, paused while the document is hidden.
 * Swap the import when the restyle lands.
 */

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function Elapsed({ start, prefix = "", className }: { start: number; prefix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const tick = () => {
      if (ref.current && !document.hidden) ref.current.textContent = `${prefix}${formatElapsed(Date.now() - start)}`
    }
    tick()
    const timer = window.setInterval(tick, 1_000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [start, prefix])
  return (
    <span ref={ref} className={className ?? "tabular-nums"}>
      {`${prefix}${formatElapsed(Date.now() - start)}`}
    </span>
  )
}
