import { cx } from "./primitives.tsx";

/**
 * The Substrate issue key as a bordered pill (2026-11-25 ruling: neutral, no accent).
 *
 * A child issue carries two identifiers — the locator (`XTRM-1019.1`, the position in
 * the tree) and the short ref (`XTRM-1020`, the flat counter). The pill wraps the pair
 * and a hairline divides them from border to border: `XTRM-1019.1 | XTRM-1020`. A root
 * issue has one identifier, so the pill wraps it alone and no hairline is drawn.
 *
 * The component is presentational: the caller owns the click, so it composes inside a
 * button, a chip or a breadcrumb without nesting controls. Colours are the Jira chip's
 * neutral grammar — the accent belongs to interactive affordances, not to an identifier.
 */
export function IssueKeyPill({
  locator,
  humanRef,
  className,
  title,
  label,
}: {
  /** The detailed locator (`XTRM-1019.1`); equal to `humanRef` on a root issue. */
  locator: string | null | undefined;
  /** The short ref (`XTRM-1020`), always present. */
  humanRef: string;
  className?: string;
  title?: string;
  /** What the identifier names, for the tooltip: "issue", "PR", … */
  label?: string;
}) {
  const detailed = locator != null && locator !== humanRef ? locator : null;
  const tip = title ?? (detailed === null ? humanRef : `${detailed} · ${humanRef}`);
  const name = label ?? "issue";
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-0 max-w-full items-stretch overflow-hidden rounded-md border border-border-muted font-mono text-xs leading-none text-ink-muted transition-colors hover:border-border hover:text-ink",
        className,
      )}
      data-issue-key={humanRef}
      data-locator={detailed}
      title={tip}
      aria-label={detailed === null ? `${name} ${humanRef}` : `${name} ${detailed}, ${humanRef}`}
    >
      {detailed !== null && (
        <>
          <span data-issue-key-locator className="flex min-w-0 items-center truncate px-1.5 text-ink-muted">
            {detailed}
          </span>
          <span aria-hidden className="w-px shrink-0 self-stretch bg-border-muted" />
        </>
      )}
      <span className="flex shrink-0 items-center px-1.5 text-ink">{humanRef}</span>
    </span>
  );
}
