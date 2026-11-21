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
 * Label/value pairs; values keep their own ink (XTRM-934).
 *
 * The grid was re-implemented five times with five label widths (3.5rem / 6.5rem / 7.5rem /
 * 10rem / auto) and two value sizes, so the same drawer and the same page disagreed about where a
 * value starts. One implementation, two knobs: `labelWidth` for the column, `size` for the step.
 * Pass rem only — a px width does not follow the operator's root size.
 */
export function Fields({
  rows,
  labelWidth = "7.5rem",
  size = "sm",
}: {
  rows: Array<[string, ReactNode]>;
  /** rem length of the label column; timeline rows use 3.5rem, the drawer 7.5rem. */
  labelWidth?: string;
  /** Value step: `sm` is body copy, `xs` is dense metadata (timeline, integration facts). */
  size?: "xs" | "sm";
}) {
  return (
    <dl
      className={cx("grid gap-x-3 gap-y-1.5", size === "xs" ? "text-xs" : "text-sm")}
      style={{ gridTemplateColumns: `${labelWidth} 1fr` }}
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
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
