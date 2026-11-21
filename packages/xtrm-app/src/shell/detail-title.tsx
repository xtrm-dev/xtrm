import type { ReactNode } from "react";

/**
 * The one entity title in the console: eyebrow, key chip, name, link, meta rows.
 *
 * Panel titles are `text-base`; the issue page sets its own step on `InlineTitle`, so nothing
 * here changes a page title's size. `lead` puts a key chip before the name (the PR drawer's
 * `PR #212`), `aside` a link after it, `meta` rows underneath; the research panels pass only an
 * eyebrow, which keeps their markup exactly as it was.
 */
export function DetailTitle({
  eyebrow,
  lead,
  aside,
  meta,
  children,
}: {
  eyebrow?: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
      {eyebrow && <div className="flex items-center gap-2 text-xs text-ink-faint">{eyebrow}</div>}
      <div className="flex items-start gap-3">
        {lead ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
            {lead}
            <h2 className="min-w-0 text-base leading-snug font-medium text-pretty text-ink">{children}</h2>
          </div>
        ) : (
          <h2 className="min-w-0 flex-1 text-base leading-snug font-medium text-pretty text-ink">{children}</h2>
        )}
        {aside}
      </div>
      {meta}
    </div>
  );
}
