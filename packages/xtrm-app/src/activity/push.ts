// GitHub push source (XTRM-757 revision, operator reversal 2026-11-26): a push
// event replaces the local git log. A push is shared activity; a local commit
// that was never pushed is not, and a pushed commit carries the same subject,
// so keeping both sources would only duplicate the row.
//
// The row stays `source: "github"`: the source axis records where the fact came
// from, and a push is a GitHub fact, so a fourth chip would repeat `github`.

import type { RepoEvent } from "../adapters/types.ts";
import type { ActivityRow } from "./types.ts";

/** A row needs a real timestamp: an unparsable date means no row, never "now". */
function parseAt(value: string): number | null {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function pushRow(event: RepoEvent): ActivityRow | null {
  const at = parseAt(event.createdAt);
  if (at === null) return null;
  const commits = event.commitCount;
  // A push is ONE event, even when it carries many commits. Reporting its head
  // commit subject would read as a single-commit row, so a multi-commit push
  // names the count and the branch in the line itself and carries no branch
  // ref (the branch is already in the sentence).
  const multi = commits !== null && commits > 1;
  const branch = event.branch;
  const changed = event.additions === null && event.deletions === null ? null : `+${event.additions ?? 0} −${event.deletions ?? 0}`;
  return {
    id: `github:push:${event.id}`,
    source: "github",
    kind: "push",
    actor: event.actor,
    verb: multi ? (branch === null ? `pushed ${commits} commits` : `pushed ${commits} commits to`) : "pushed",
    // Single commit: its subject, or the count when GitHub sends no title.
    // Multi-commit: the branch, because there is no single subject to name.
    object: multi
      ? (branch ?? "a branch")
      : event.title?.trim() || (commits === null ? "a push" : `${commits} commit${commits === 1 ? "" : "s"}`),
    // The branch is the reference a reader can act on. The event URL is not a
    // ref: the surface renders non-issue refs as truncated mono text, and a
    // truncated commit URL identifies nothing, so the URL rides the meta line.
    refs: multi || branch === null ? [] : [{ kind: "branch", ref: branch }],
    at,
    meta: [
      ...(commits === null ? [] : [["commits", String(commits)] as [string, string]]),
      ...(event.changedFiles === null ? [] : [["files", String(event.changedFiles)] as [string, string]]),
      ...(changed === null ? [] : [["changes", changed] as [string, string]]),
      ...(event.url === null ? [] : [["commit", event.url] as [string, string]]),
    ],
    body: event.body,
  };
}

/** Push rows of an event page, oldest-and-other kinds dropped. */
export function pushRows(events: readonly RepoEvent[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    if (event.kind !== "push") continue;
    const row = pushRow(event);
    if (row !== null) rows.push(row);
  }
  return rows;
}
