// Shell adapter over motion-panels (shell architecture §2.1).
// This is the only module allowed to import motion-panels; the version is pinned exactly.
import { Group, Panel, Separator } from "motion-panels/react";
import type { ReactNode } from "react";
import { cx } from "./primitives.tsx";

export function ResizableGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Group orientation="horizontal" className={cx("flex min-w-0 flex-1", className)}>
      {children}
    </Group>
  );
}

export function ResizablePanel<S extends number | `${number}%`>({
  size,
  minSize,
  maxSize,
  onSizeChange,
  collapsed,
  children,
  className,
  ...rest
}: {
  collapsed?: boolean;
  size: S;
  minSize: number | `${number}%`;
  maxSize: number | `${number}%`;
  onSizeChange?: (size: S) => void;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <Panel size={size} minSize={minSize} maxSize={maxSize} collapsed={collapsed} keepMounted onSizeChange={onSizeChange} className={cx("min-w-0", className)} {...rest}>
      {children}
    </Panel>
  );
}

export function FillPanel({ children, className, ...rest }: { children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <Panel className={cx("min-w-0", className)} {...rest}>
      {children}
    </Panel>
  );
}

/** Hairline separator; the hit area is wider than the visible line.
 * Always mounted (even when hidden) so Group children keys stay stable across
 * open/close and no reorder FLIP pass runs — sidebar, main, and inspector
 * size animations start in the same commit. */
export function ResizeHandle({ label, hidden }: { label: string; hidden?: boolean }) {
  return (
    <Separator
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : 0}
      className={cx("group/sep relative z-10 w-2 shrink-0 cursor-col-resize outline-none", hidden && "hidden")}
    >
      <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/sep:bg-border-strong group-focus-visible/sep:bg-accent" />
    </Separator>
  );
}
