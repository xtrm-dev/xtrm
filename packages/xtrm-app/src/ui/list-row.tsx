import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { Row, cx } from "./primitives.tsx";

/**
 * One-line list row (2026-11-24 ruling): every list is a single reading line — identity, state,
 * title, then the rollups at the right edge. There is no column grid, so no field is dropped by
 * width and no header row has to name a track.
 *
 * Geometry is shared with the sidebar through `--x-row` (32px), so every list row lines up with the
 * sidebar's own rows instead of a table's band.
 */
export interface ListRowProps {
  selected?: boolean;
  onActivate?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Identity cluster: depth control, kind glyph, key chip, state chip. */
  leading: ReactNode;
  title: ReactNode;
  /** Rollups and the age. Order is fixed: the widest-shed item is last. */
  trailing?: ReactNode;
  /** Tree depth in rem steps, applied to the leading cluster only. */
  indentRem?: number;
  titleClassName?: string;
  /**
   * Type scale of the title. `base` (16px) is the PR and Activity reading line; the work-issue list
   * keeps its own denser `sm` (13px) scale, which is the one place the operator wants unchanged
   * (2026-11-26). Row height stays 32px in both, so the lists still line up.
   */
  scale?: "base" | "sm";
  /** Revealed on hover and keyboard focus at the row end. */
  actions?: ReactNode;
  testId?: string;
  className?: string;
}

export function ListRow({
  selected,
  onActivate,
  onDoubleClick,
  onKeyDown,
  leading,
  title,
  trailing,
  indentRem = 0,
  titleClassName,
  scale = "base",
  actions,
  testId,
  className,
}: ListRowProps) {
  return (
    <Row
      density="table"
      selected={selected}
      onActivate={onActivate}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      actions={actions}
      data-testid={testId}
      className={className}
    >
      <div
        className="flex h-full w-full min-w-0 items-center gap-2 pr-3"
        style={{ paddingLeft: `calc(0.75rem + ${indentRem}rem)`, "--row-indent": `${indentRem}rem` } as CSSProperties}
      >
        <span data-row-leading="" className="flex min-w-0 shrink-0 items-center gap-1.5">
          {leading}
        </span>
        <span className={cx("min-w-0 flex-1 truncate text-ink", scale === "base" ? "text-base" : "text-sm", titleClassName)}>{title}</span>
        {trailing && <span className="flex shrink-0 items-center gap-3 text-xs text-ink-faint">{trailing}</span>}
      </div>
    </Row>
  );
}

/**
 * The key is an address, not a state: dim mono, no fill, no tint. The status chip beside it carries
 * the only colour in the row, so a list of keys never turns into a row of competing washes.
 */
export function KeyChip({ children, title, label, className }: { children: ReactNode; title?: string; label?: string; className?: string }) {
  return (
    <span title={title} aria-label={label} className={cx("inline-flex shrink-0 items-center font-mono text-xs text-ink-muted", className)}>
      {children}
    </span>
  );
}

/**
 * A rollup pill: the glyph and its count as one object, so `42` never needs a column header to say
 * what it counts. `title` carries the words.
 */
const PILL_TONE = {
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-success/12 text-success-ink",
  danger: "bg-danger/12 text-danger",
  neutral: "bg-pressed text-ink-muted",
} as const;

export function StatPill({ icon, value, title, stat, tone = "neutral", className }: { icon: IconName; value: ReactNode; title?: string; stat?: string; tone?: keyof typeof PILL_TONE; className?: string }) {
  return (
    <span
      title={title}
      data-stat={stat ?? icon}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs tabular",
        PILL_TONE[tone],
        className,
      )}
    >
      <Icon name={icon} size="micro" className="shrink-0" />
      {value}
    </span>
  );
}
