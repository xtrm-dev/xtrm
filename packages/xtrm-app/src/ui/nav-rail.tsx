import type { ReactNode } from "react";
import { Row, cx } from "./primitives.tsx";

/**
 * Nested sidebar rows on a rail (§4.1 NavRail). The rail is one 1px hairline whose x equals the
 * centre of the parent row's icon, so a child label aligns with the parent label; children carry no
 * icons. The active child is marked on the rail with a 2px accent bar that replaces the hairline at
 * that row, and the marker is decorative: ink and weight also carry the state.
 */
export function NavRail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="ml-[var(--x-rail-indent)] flex flex-col gap-px border-l border-border-muted">
      {children}
    </div>
  );
}

/** One child row of a NavRail: label at the aligned column, optional count, no icon. */
export function NavRailItem({
  label,
  count,
  selected,
  deferred,
  onActivate,
}: {
  label: string;
  count?: number | null;
  selected?: boolean;
  deferred?: boolean;
  onActivate?: () => void;
}) {
  return (
    <Row
      density="sidebar"
      selected={selected}
      // Deferred is a fact for the surface, not a colour: ink-faint is 2.74:1 on the light sidebar
      // and 2.93:1 on the dark one, below the 4.5:1 minimum for 13px text (lead ruling, 2026-11-18).
      data-deferred={deferred || undefined}
      // A nav child is a destination, so it names the page; Row's own default is aria-current="true".
      aria-current={selected ? "page" : undefined}
      onActivate={onActivate}
      className={cx(
        // `text-sm` is the token the parent row inherits (0.8125rem): the same class, not a copy of
        // its current px value, so a root font size other than 16px cannot make the child larger
        // than its parent (XTRM-897).
        "h-7 pl-[var(--x-rail-gutter)] text-sm font-medium",
        // The marker sits at -left-px, so it covers the rail's own border on this row only.
        selected
          ? "bg-hover font-semibold text-ink before:absolute before:-left-px before:inset-y-1.5 before:w-[var(--x-rail-marker)] before:rounded-full before:bg-accent"
          : "text-ink-muted",
      )}
    >
      <span className="truncate">{label}</span>
      {count != null && <span className="ml-auto shrink-0 text-xs text-ink-faint tabular">{count}</span>}
    </Row>
  );
}
