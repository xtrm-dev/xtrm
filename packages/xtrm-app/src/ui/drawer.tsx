import type { ReactNode } from "react";
import { cx } from "./primitives.tsx";

/** Titled section inside the drawer. */
export function InspectorSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border-muted px-5 py-4 first:border-t-0">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium text-ink-faint">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label/value pairs; values keep their own ink. */
export function Fields({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
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
