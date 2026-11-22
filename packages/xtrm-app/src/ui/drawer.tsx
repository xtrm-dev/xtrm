import type { ReactNode } from "react";
import { cx } from "./primitives.tsx";
import { Section } from "./section.tsx";

/**
 * Titled section inside the drawer. `Section` is the component; this name is the one 55 call sites
 * already read, so it stays as an alias instead of a rename sweep.
 */
export function InspectorSection({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <Section title={title} aside={aside}>
      {children}
    </Section>
  );
}

/**
 * The label-column ladder (XTRM-971). One step per surface class, declared once and imported by
 * every grid, so a column is a decision with a reason instead of a hand-picked number.
 *
 * Each step is the narrowest that fits the widest label its class actually renders, measured in the
 * app at a 16px root (worst label, then the slack the step leaves). Import these; do not restate the
 * literal. The values are `rem`, so they follow the operator's root size;
 * `packages/xtrm-app/src/ui/units.test.ts` refuses either a two-column label grid written as a class
 * or a literal `labelWidth`, which is what keeps this set closed instead of aspirational.
 *
 * The gutter is not a knob: every grid uses `gap-x-3` (0.75rem), the value that `Fields` hardcodes,
 * and the agent sidebar is the one exception at `gap-x-2`. A gutter that drifts per call site starts
 * the same nominal column 4px apart, which is the defect this ladder replaced.
 */

/** Rows whose values are one short token (`value`, the timeline's `at`/`kind`). Worst label 31px. */
export const DENSE_LABEL_COLUMN = "3.5rem";

/** The agent sidebar's session rows, whose labels are one word. Worst label 49px. */
export const SIDEBAR_LABEL_COLUMN = "4.5rem";

/** The issue body in the canvas (details and provenance). Worst label 82px. */
export const PART_LABEL_COLUMN = "6.5rem";

/** Drawer and inspector bodies. Worst label 105px, so the step leaves 15px of slack. */
export const DRAWER_LABEL_COLUMN = "7.5rem";

/**
 * Page bodies. These choose the step for value room, not for label fit: the widest page label is
 * 84px, and the extra column is what a page has that a 320px drawer does not.
 */
export const PAGE_LABEL_COLUMN = "10rem";

/**
 * Label/value pairs; values keep their own ink (XTRM-934).
 *
 * The grid was re-implemented five times with five label widths and two value sizes, so the same
 * drawer and the same page disagreed about where a value starts. One implementation, two knobs:
 * `labelWidth` for the column — always a step from the ladder above — and `size` for the value
 * step. The default is `DRAWER_LABEL_COLUMN` because most call sites are drawer bodies; a page
 * body passes `PAGE_LABEL_COLUMN` rather than its own number.
 */
export function Fields({
  rows,
  labelWidth = DRAWER_LABEL_COLUMN,
  size = "sm",
}: {
  rows: Array<[ReactNode, ReactNode]>;
  /** A step from the ladder above; never a literal. */
  labelWidth?: `${number}rem` | `${number}ch`;
  /** Value step: `sm` is body copy, `xs` is dense metadata (timeline, integration facts). */
  size?: "xs" | "sm";
}) {
  return (
    <dl
      className={cx("grid gap-x-3 gap-y-1.5", size === "xs" ? "text-xs" : "text-sm")}
      style={{ gridTemplateColumns: `${labelWidth} 1fr` }}
    >
      {rows.map(([k, v], index) => (
        <div key={index} className="contents">
          <dt className="text-ink-faint">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Canonical drawer frame (§7). Presentational: the shell owns state and placement.
 * `variant` only changes edge treatment; geometry comes from the shell container.
 */
export function Drawer({
  variant,
  header,
  children,
  label,
}: {
  variant: "overlay" | "column" | "maximized";
  header: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <aside
      aria-label={label}
      data-testid="inspector-drawer"
      data-variant={variant}
      className={cx(
        // Border, radius and shadow belong to the inspector dock that hosts the drawer.
        "flex h-full min-w-0 flex-col bg-raised",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">{header}</div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className={cx(variant === "maximized" && "mx-auto w-full max-w-4xl py-4")}>{children}</div>
      </div>
    </aside>
  );
}
