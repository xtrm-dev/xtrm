import type { ComponentProps, ReactNode } from "react";
import { cx } from "./primitives.tsx";

/** Semantic weight, same five values the issue table already uses for status chips. */
export type BadgeTone = "accent" | "active" | "danger" | "success" | "neutral" | "muted" | "inverse";

/**
 * Ink and soft fills only: the surface stays monochrome and a badge borrows colour from the tone
 * it names (§15.1). Text is a step smaller than body copy so a badge never competes with a label.
 */
const TONE: Record<BadgeTone, string> = {
  accent: "bg-accent-soft text-accent-ink",
  active: "bg-accent-soft text-ink",
  danger: "bg-danger/12 text-danger",
  /** GitHub-style Open chip: the word is the state, the tone reinforces it (§3.2). */
  success: "bg-success/12 text-success-ink",
  neutral: "bg-pressed text-ink-muted",
  muted: "bg-hover text-ink-faint",
  /** On the sidebar strip and its drop-up: follows that surface through the --x-strip-* tokens. */
  inverse: "bg-strip-chip text-strip-chip-ink",
};

const SIZE = {
  /** Dense table cells and footer rows. */
  xs: "h-4 px-1 text-[0.62rem] leading-none",
  /** Default: a status next to a title, a count next to a label. */
  sm: "h-[1.125rem] px-1.5 text-[0.68rem] leading-none",
} as const;

export interface BadgeProps extends Omit<ComponentProps<"span">, "children"> {
  tone?: BadgeTone;
  size?: keyof typeof SIZE;
  /** Tabular mono for values that must line up (latency, counts, versions). */
  mono?: boolean;
  title?: string;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", size = "sm", mono, className, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded font-medium whitespace-nowrap tabular-nums",
        TONE[tone],
        SIZE[size],
        mono && "font-mono",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
