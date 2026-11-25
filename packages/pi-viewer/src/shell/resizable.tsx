// Shell adapter over motion-panels, copied from packages/xtrm-app/src/ui/resizable.tsx (XTRM-1044).
// The version is pinned exactly, as the console pins it (0.5.2).
import { Group, Panel, Separator } from "motion-panels/react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function ResizableGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Group orientation="horizontal" className={cn("flex min-w-0 flex-1", className)}>
      {children}
    </Group>
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
  return (
    <Panel size={size} minSize={minSize} maxSize={maxSize} collapsed={collapsed} keepMounted onSizeChange={onSizeChange} className={cn("min-w-0", className)} {...rest}>
      {children}
    </Panel>
  )
}

export function FillPanel({ children, className, ...rest }: { children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <Panel className={cn("min-w-0", className)} {...rest}>
      {children}
    </Panel>
  )
}

/** Hairline separator; the hit area is wider than the visible line. Always mounted, hidden when the sidebar is closed. */
export function ResizeHandle({ label, hidden }: { label: string; hidden?: boolean }) {
  return (
    <Separator
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : 0}
      className={cn("group/sep relative z-10 w-2 shrink-0 cursor-col-resize outline-none", hidden && "hidden")}
    >
      <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/sep:bg-border-strong group-focus-visible/sep:bg-accent" />
    </Separator>
  )
}
