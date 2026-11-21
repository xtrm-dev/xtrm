import type { ReactNode } from "react";
import { cx } from "./primitives.tsx";

/**
 * The one section header in the console (XTRM-934, epic XTRM-933).
 *
 * Five idioms rendered this same concept before: an uppercase `tracking-wide` eyebrow, a bordered
 * panel title, a mono day caption, a bare `text-xs` heading, and the drawer's `px-5 py-4`
 * `InspectorSection`. They differed in gutter (px-1.5 / px-2 / px-3 / px-5), height (auto / h-8 /
 * h-9) and casing, so two stacked lists on one page started their text at two different x
 * positions. A section header is one concept: name, optional count, optional right-side action.
 *
 * Inset names the gutter it inherits, so a header always lines up with its own rows:
 * - `list`   — `h-8 px-3`, the same box as a list `Row` (see Row density="list").
 * - `drawer` — `h-7 px-0`; the inspector section owns the `px-5 py-4` frame.
 * - `none`   — no height, no gutter; for a header placed inside an existing padded box.
 */
export type SectionInset = "list" | "drawer" | "none";

export function SectionHeader({
  title,
  count,
  aside,
  inset = "list",
  level = 2,
  mono,
  sticky,
  wrap,
  className,
}: {
  title: ReactNode;
  count?: ReactNode;
  aside?: ReactNode;
  inset?: SectionInset;
  /**
   * Heading level follows the outline, not the styling: page sections are h2, a group inside a
   * section is h3, an owner inside a group is h4. The type is identical at every level; only the
   * document outline changes, so a screen reader hears the nesting the layout already shows.
   */
  level?: 2 | 3 | 4;
  /** The timeline's day caption: dates stay mono, but on the same box as every other header. */
  mono?: boolean;
  sticky?: boolean;
  /** Let a long aside fall to a second line instead of clipping it; the box grows, the gutter does not. */
  wrap?: boolean;
  className?: string;
}) {
  const Heading = level === 2 ? "h2" : level === 3 ? "h3" : "h4";
  return (
    <div
      className={cx(
        "flex shrink-0 items-center gap-2",
        inset === "list" && (wrap ? "min-h-8 flex-wrap px-3 py-1" : "h-8 px-3"),
        inset === "drawer" && "h-7",
        sticky && "sticky top-0 z-10 bg-surface",
        className,
      )}
    >
      <Heading className={cx("min-w-0 truncate text-xs font-medium text-ink-faint", mono && "font-mono uppercase")}>
        {title}
      </Heading>
      {count !== undefined && count !== null && <span className="shrink-0 text-xs text-ink-faint tabular">{count}</span>}
      {aside && <div className="ml-auto flex shrink-0 items-center gap-1">{aside}</div>}
    </div>
  );
}

/**
 * A titled section with its own frame: one hairline above, `px-5 py-4` padding, header inset
 * `drawer`. This is the drawer body's unit, and the unit a page-level detail view uses when it
 * wants the same rhythm.
 */
export function Section({
  title,
  count,
  aside,
  level = 3,
  className,
  children,
}: {
  title: ReactNode;
  count?: ReactNode;
  aside?: ReactNode;
  level?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("flex flex-col gap-2 border-t border-border-muted px-5 py-4 first:border-t-0", className)}>
      <SectionHeader title={title} count={count} aside={aside} inset="drawer" level={level} />
      {children}
    </section>
  );
}

/**
 * A titled list: the header plus its rows, separated from the next block by one hairline.
 * `bordered` is on by default because a stack of lists reads as one continuous table; pass
 * `bordered={false}` when the parent already draws the separator.
 */
export function ListSection({
  title,
  count,
  aside,
  bordered = true,
  className,
  children,
}: {
  title: string;
  count?: ReactNode;
  aside?: ReactNode;
  bordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col", bordered && "border-b border-border-muted", className)}>
      <SectionHeader title={title} count={count} aside={aside} />
      {children}
    </section>
  );
}
