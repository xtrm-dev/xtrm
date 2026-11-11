import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./primitives.tsx";

/** Indent per tree level. Disclosure chevrons sit on this grid. */
export const TREE_STEP = 20;
/** Left padding before the first level's disclosure slot. */
const TREE_PAD = 8;
/** Disclosure slot, then the gap and icon that follow it in a row's flex line. */
const CHEVRON = 20;
const GAP = 6;
const ICON = 14;
/** The guide hangs under the parent's type icon, so it reads as that row's spine. */
const GUIDE_X = TREE_PAD + CHEVRON + GAP + ICON / 2;

/**
 * One straight guide per ancestor level, hanging under the ancestor's type icon.
 * Each level steps by `step`, so the guides line up with the row's own icons.
 */
export function TreeGuides({ depth, step = TREE_STEP }: { depth: number; step?: number }) {
  if (depth < 1) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => i + 1).map((level) => (
        <span key={level} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-tree-guide" style={{ left: GUIDE_X + (level - 1) * step }} />
      ))}
    </>
  );
}

/**
 * The tree part of a row: indent, guides, and the disclosure control. Callers keep their own
 * cell classes and row content, so this works in a table cell and in a sidebar row alike.
 */
export function TreeCell({
  depth,
  hasChildren,
  expanded,
  onToggle,
  label,
  step = TREE_STEP,
  className,
  children,
}: {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Accessible name for the disclosure button, usually the issue ref. */
  label: string;
  step?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("relative", className)} style={{ paddingLeft: TREE_PAD + depth * step }}>
      <TreeGuides depth={depth} step={step} />
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint outline-none hover:bg-pressed hover:text-ink focus-visible:bg-pressed"
        >
          <Icon name="chevronDown" size="xs" className={cx("transition-transform", !expanded && "-rotate-90")} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      {children}
    </div>
  );
}
