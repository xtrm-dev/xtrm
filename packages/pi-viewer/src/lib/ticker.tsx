import { useEffect, useRef } from "react"

import { formatElapsed } from "./elapsed.ts"

/**
 * Elapsed time since `start` (epoch ms), written into one text node once a second.
 * React renders the span once; the interval mutates the node, so a running timer never re-renders
 * its parent. Ticking pauses while the tab is hidden.
 */
export function Elapsed({
  start,
  prefix = "",
  className,
}: {
  start: number
  prefix?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const write = () => {
      node.textContent = `${prefix}${formatElapsed(Date.now() - start)}`
    }
    write()
    const timer = window.setInterval(() => {
      if (!document.hidden) write()
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [start, prefix])

  return <span ref={ref} className={className ? `tabular ${className}` : "tabular"} />
}
