import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The fold control of a long message (XTRM-1055): one control and one wording for the operator's bubble
 * and the intercom card. It lives inside the bubble or card, under the clipped content and its fade,
 * within the padding, so it never leaves the box it folds. "Show more" / "Show less" at any width.
 */
export function FoldToggle({
  expanded,
  onToggle,
  controls,
  className,
}: {
  expanded: boolean
  onToggle: () => void
  controls?: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-fold=""
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 rounded-sm text-xs leading-4 whitespace-nowrap text-ink-muted transition-colors hover:text-ink",
        className,
      )}
    >
      {expanded ? "Show less" : "Show more"}
      <ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
    </button>
  )
}
