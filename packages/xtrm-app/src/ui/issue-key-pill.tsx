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

/** `XTRM-301` → `{ prefix: "XTRM-", number: "301" }`; a ref without a trailing counter stays whole. */
export function splitIssueRef(ref: string): { prefix: string; number: string } {
  const match = /^(.*?-)(\d+)$/.exec(ref);
  return match ? { prefix: match[1]!, number: match[2]! } : { prefix: "", number: ref };
}

/**
 * The issue key as quiet text, for the issue list only (2026-11-27 follow-up, XTRM-1136): the pill's
 * border and the repeated project prefix made the list noisy on long project names. The whole key is
 * one muted ink; the short ref drops its prefix and keeps only its number, in semibold, after a `/`,
 * so `XTRM-300.1 | XTRM-301` reads `XTRM-300.1 / 301`. A root issue reads `XTRM-300` with the number
 * in the same weight. The tooltip and the accessible name still carry both full identifiers, and the
 * data attributes match `IssueKeyPill`, so callers and tests address the key the same way.
 */
export function IssueKeyText({
  locator,
  humanRef,
  className,
  title,
}: {
  locator: string | null | undefined;
  humanRef: string;
  className?: string;
  title?: string;
}) {
  const detailed = locator != null && locator !== humanRef ? locator : null;
  const { prefix, number } = splitIssueRef(humanRef);
  return (
    <span
      className={cx("inline-flex min-w-0 items-baseline gap-1 font-mono text-xs leading-none text-ink-muted", className)}
      data-issue-key={humanRef}
      data-locator={detailed}
      title={title ?? (detailed === null ? humanRef : `${detailed} · ${humanRef}`)}
      aria-label={detailed === null ? `issue ${humanRef}` : `issue ${detailed}, ${humanRef}`}
    >
      {detailed !== null ? (
        <>
          <span data-issue-key-locator className="min-w-0 truncate">
            {detailed}
          </span>
          <span aria-hidden className="shrink-0">
            /
          </span>
          <span data-issue-key-number className="shrink-0 font-semibold">
            {number}
          </span>
        </>
      ) : (
        <span className="shrink-0">
          {prefix}
          <span data-issue-key-number className="font-semibold">
            {number}
          </span>
        </span>
      )}
    </span>
  );
}
