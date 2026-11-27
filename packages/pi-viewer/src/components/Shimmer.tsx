import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A label with the stepped shimmer (`.xtrm-shimmer`). The animation is paused while the label is
 * off-screen, so a long thread with many live rows costs nothing. Presence reuses this component.
 */
export function Shimmer({
  children,
  active = true,
  className,
}: {
  children: ReactNode
  active?: boolean
  className?: string
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const node = ref.current
    if (!node || !active || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setVisible(entry.isIntersecting)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [active])

  return (
    <span
      ref={ref}
      data-paused={active && !visible ? "true" : undefined}
      className={cn(active ? "xtrm-shimmer" : "text-ink-muted", className)}
    >
      {children}
    </span>
  )
}
