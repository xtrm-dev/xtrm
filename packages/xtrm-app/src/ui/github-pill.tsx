import type { ReactNode } from "react";
import { GithubMark } from "./github-mark.tsx";
import { cx } from "./primitives.tsx";

const SIZE = {
  /** Header affordance: sits on the title line without crowding it. */
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-2 px-3 text-xs",
} as const;

const MARK = { sm: "micro", md: "xs" } as const;

/**
 * GitHub's own primary-button look, so "Open on GitHub" reads as an affordance rather than a link.
 * `variant="ghost"` is the header form (§2 Restraint): a filled pill is a chip background in a
 * header, so the PR inspector header asks for the ghost wash instead.
 */
export function GithubPill({
  href,
  children = "Open on GitHub",
  size = "md",
  variant = "solid",
  className,
}: {
  href: string;
  children?: ReactNode;
  size?: keyof typeof SIZE;
  variant?: "solid" | "ghost";
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid="github-pill"
      className={cx(
        variant === "ghost"
          ? "inline-flex shrink-0 items-center rounded-md text-ink-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover"
          : "inline-flex shrink-0 items-center rounded-full bg-github font-medium text-github-ink outline-none transition-colors hover:bg-github-hover focus-visible:ring-2 focus-visible:ring-accent/40",
        SIZE[size],
        className,
      )}
    >
      <GithubMark size={MARK[size]} />
      {children}
    </a>
  );
}
