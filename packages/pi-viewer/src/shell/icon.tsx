import { ChevronDown, ChevronUp, Layers, MousePointer2, Moon, PanelLeft, Sun, type LucideIcon } from "lucide-react"

/**
 * The console's icon component, copied from packages/xtrm-app/src/ui/icon.tsx (XTRM-1044).
 * Copied, not imported: that file resolves `lucide-react` from the xtrm-app package, which has no
 * node_modules in this worktree, and the workspace has no root to hoist one. The registry holds only
 * the names the viewer shell uses; the names, glyphs, size ladder and stroke rule are the console's.
 */
const registry = {
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  moon: Moon,
  sun: Sun,
  sidebar: PanelLeft,
  agents: MousePointer2,
  work: Layers,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof registry

/** The glyph ladder in rem (console icon.tsx SIZE_CLASS): `text` is 13px, `xs` 14px, `nav` 16px at a 16px root. */
const SIZE_CLASS = {
  micro: "size-[0.75rem]",
  text: "size-[0.8125rem]",
  xs: "size-[0.875rem]",
  sm: "size-4",
  nav: "size-4",
  md: "size-[1.125rem]",
  lg: "size-5",
} as const

export type IconSize = keyof typeof SIZE_CLASS

const PX = { micro: 12, text: 13, xs: 14, sm: 16, nav: 16, md: 18, lg: 20 } as const satisfies Record<IconSize, number>

/** Lucide ships 2; the console reads better at 2.25 except at the two smallest sizes (console icon.tsx defaultStroke). */
const defaultStroke = (size: IconSize) => (size === "text" || size === "micro" ? 2 : 2.25)

export function Icon({
  name,
  size = "sm",
  strokeWidth,
  className,
}: {
  name: IconName
  size?: IconSize
  strokeWidth?: number
  className?: string
}) {
  const Comp = registry[name]
  return (
    <Comp
      size={PX[size]}
      strokeWidth={strokeWidth ?? defaultStroke(size)}
      className={className ? `${SIZE_CLASS[size]} ${className}` : SIZE_CLASS[size]}
      aria-hidden
    />
  )
}
