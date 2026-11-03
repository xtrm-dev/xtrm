import type { ReactNode } from "react";
import { GithubMark } from "./github-mark.tsx";
import { cx } from "./primitives.tsx";

/** GitHub's own primary-button look, so "Open on GitHub" reads as an affordance rather than a link. */
export function GithubPill({ href, children = "Open on GitHub", className }: { href: string; children?: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid="github-pill"
      className={cx(
        "inline-flex h-8 items-center gap-2 rounded-full bg-github px-3 text-xs font-medium text-github-ink outline-none transition-colors hover:bg-github-hover focus-visible:ring-2 focus-visible:ring-accent/40",
        className,
      )}
    >
      <GithubMark size={14} />
      {children}
    </a>
  );
}
