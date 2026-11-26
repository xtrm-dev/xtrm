// Mixed Activity feed (XTRM-757): one row grammar over its sources.
//
// The operator reversed the earlier ruling on 2026-11-26: GitHub pushes replace
// the LOCAL git log. A push is shared activity, a local commit that was never
// pushed is not, and a pushed commit carries the same subject, so the two
// sources would only duplicate the row. Push rows are `source: "github"` with
// `kind: "push"` because the source axis records where the fact came from.
//
// Row identity is per source and stable: the journal entry id, `owner/repo#n`
// for a GitHub object, `github:push:<event id>` for a push.

export type ActivitySource = "substrate" | "github" | "jira";

/**
 * Sources that exist today. Jira stays absent from the filter row until it is
 * connected. `git` stays in the union but is retired: no loader produces it
 * since the push ruling, and the activity surface still maps its chip.
 */
export const LIVE_ACTIVITY_SOURCES: readonly ActivitySource[] = ["substrate", "github"];

export type ActivityRefKind = "issue" | "pr" | "gh-issue" | "commit" | "branch" | "path";

export interface ActivityRef {
  kind: ActivityRefKind;
  ref: string;
}

export interface ActivityRow {
  /** `${source}:${identity}` — unique across the merged feed. */
  id: string;
  source: ActivitySource;
  /** Machine kind: `journal.note`, `pr.opened`, `commit`, `issue.closed`, … */
  kind: string;
  /** Who acted; null when the source recorded no actor (never invented). */
  actor: string | null;
  /** What they did, already phrased for the row: "noted", "opened", "pushed to". */
  verb: string;
  /** The object in bold: the issue ref, the PR title, the commit subject. */
  object: string;
  refs: ActivityRef[];
  /** Epoch milliseconds. */
  at: number;
  /** Expansion meta line, in order. Empty for sources without extra facts. */
  meta: Array<[string, string]>;
  /** Expansion body; null when the event carries no text. */
  body: string | null;
}

export interface ActivityPage {
  source: ActivitySource;
  rows: ActivityRow[];
  /** Pass back to read more from this source; null when it is exhausted. */
  cursor: string | null;
  /** Set when this source failed: the rows array is then empty, never partial. */
  error?: string;
}

/** A page of rows plus the failure state the surface renders inline. */
export interface ActivitySourceState {
  source: ActivitySource;
  rows: ActivityRow[];
  cursor: string | null;
  /** Present when the read failed; the surface shows it in place of the rows. */
  error: string | null;
  /** True when the source has not been asked yet. */
  pending: boolean;
}
