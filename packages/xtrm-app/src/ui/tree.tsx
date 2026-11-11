import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./primitives.tsx";

/** Indent per tree level. Disclosure chevrons sit on this grid, so the guides align with them. */
export const TREE_STEP = 20;
/** Left padding before the first level's chevron. */
const TREE_PAD = 8;
/** Reach of the horizontal elbow that joins a child row to its parent's spine. */
const ELBOW = 6;

/**
 * Guides for one nested row: a spine per ancestor level, then the current level's spine
 * plus the elbow that points at the row. The current spine stops at mid-row when the row
 * is its parent's last child, which is what makes the tree readable at 32px.
 */
export function TreeGuides({ depth, last, step = TREE_STEP }: { depth: number; last?: boolean; step?: number }) {
  if (depth < 1) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => i + 1).map((level) => {
        const own = level === depth;
        const stop = own && last;
        return (
          <span
            key={level}
            aria-hidden
            className="pointer-events-none absolute w-px bg-tree-guide"
            style={{ left: level * step - step / 2, top: stop ? "50%" : 0, bottom: stop ? "50%" : 0 }}
          />
        );
      })}
      <span aria-hidden className="pointer-events-none absolute h-px bg-tree-guide" style={{ left: depth * step - step / 2, top: "50%", width: ELBOW }} />
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
  last,
  label,
  step = TREE_STEP,
  className,
  children,
}: {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** The row is the last child of its parent: its own spine stops at mid-row. */
  last?: boolean;
  /** Accessible name for the disclosure button, usually the issue ref. */
  label: string;
  step?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("relative", className)} style={{ paddingLeft: TREE_PAD + depth * step }}>
      <TreeGuides depth={depth} last={last} step={step} />
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
