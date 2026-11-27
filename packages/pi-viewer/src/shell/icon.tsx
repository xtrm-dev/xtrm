import { Check, CheckCheck, ChevronDown, ChevronUp, CircleX, Copy, Folder, Layers, LoaderCircle, Monitor, Reply, MousePointer2, Moon, MoveHorizontal, PanelLeft, Server, Sun, type LucideIcon } from "lucide-react"

/**
 * The console's icon component, copied from packages/xtrm-app/src/ui/icon.tsx (XTRM-1044).
 * Copied, not imported: that file resolves `lucide-react` from the xtrm-app package, which has no
 * node_modules in this worktree, and the workspace has no root to hoist one. The registry holds only
 * the names the viewer shell uses; the names, glyphs, size ladder and stroke rule are the console's.
 */
const registry = {
  check: Check,
  /** Delivery marks on the operator's newest message (operator, 2026-11-26): lucide, the console's set. */
  checkCheck: CheckCheck,
  circleX: CircleX,
  loader: LoaderCircle,
  chevronDown: ChevronDown,
  copy: Copy,
  /** The console registers lucide Folder too (xtrm-app src/ui/icon.tsx). */
  folder: Folder,
  /** The sidebar's host glyph (XTRM-1155): this machine, and another host. */
  monitor: Monitor,
  server: Server,
  reply: Reply,
  chevronUp: ChevronUp,
  moon: Moon,
  /** Not in the console registry: the chat-width control (XTRM-1042) is the viewer's own. */
  width: MoveHorizontal,
  sun: Sun,
  sidebar: PanelLeft,
  agents: MousePointer2,
  work: Layers,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof registry

/**
 * The glyph ladder in rem, the refactored console's (XTRM-1044): micro 12 inline marks, text 13 hover actions,
 * xs 14 rows and chevrons, sm and nav 16 chrome, md 18, lg 20. Main's console still shows 13px chrome.
 */
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
