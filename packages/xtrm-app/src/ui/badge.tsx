import type { ComponentProps, ReactNode } from "react";
import { cx } from "./primitives.tsx";

/** Semantic weight, same five values the issue table already uses for status chips. */
export type BadgeTone = "accent" | "active" | "danger" | "success" | "neutral" | "muted" | "inverse";

/**
 * `tint` is the quiet chip: a 10–12 % wash with the tone's ink. `solid` is the status chip after the
 * 2026-11-24 treatment ruling: the tone is the background and the ink is pure white, so a state reads
 * from across the room and never changes meaning between themes (one tone set, see `--x-chip-*`).
 */
export type BadgeVariant = "tint" | "solid";

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

/** Solid fills carry white ink. The five tones are the same values in light and dark. */
const SOLID: Record<BadgeTone, string> = {
  accent: "bg-chip-accent text-white",
  active: "bg-chip-attention text-white",
  danger: "bg-chip-danger text-white",
  success: "bg-chip-success text-white",
  neutral: "bg-chip-neutral text-white",
  muted: "bg-chip-neutral text-white",
  inverse: "bg-strip-chip text-strip-chip-ink",
};

const SIZE = {
  /** Dense table cells and footer rows. */
  xs: "h-4 px-1 text-2xs leading-none",
  /** Default: a status next to a title, a count next to a label. */
  sm: "h-[1.125rem] px-1.5 text-xs leading-none",
} as const;

export interface BadgeProps extends Omit<ComponentProps<"span">, "children"> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: keyof typeof SIZE;
  /** Tabular mono for values that must line up (latency, counts, versions). */
  mono?: boolean;
  /**
   * Opt in to shrinking. A badge is `shrink-0` by default so a chip never compresses in a toolbar,
   * a table cell or a list gutter; inside a constrained, wrapping container that default is the
   * wrong answer, because the chip then paints over its neighbours instead of truncating. Pass
   * this when the container is the one that must win, and pair it with `truncate`/`max-w-full`.
   */
  shrink?: boolean;
  title?: string;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", variant = "tint", size = "sm", mono, shrink, className, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cx(
        "inline-flex items-center justify-center gap-1 rounded-full font-medium whitespace-nowrap tabular",
        shrink ? "min-w-0 shrink" : "shrink-0",
        variant === "solid" ? SOLID[tone] : TONE[tone],
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
