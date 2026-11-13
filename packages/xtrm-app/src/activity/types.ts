// Mixed Activity feed (XTRM-757): one row grammar over three sources.
//
// The operator ruling (XTRM-757 journal seq 3) fixed the sources: Substrate
// journal entries, GitHub pull requests/issues/reviews/comments, and the LOCAL
// git log of the repository on disk. GitHub never supplies commits, so no row
// can appear twice and there is no dedupe-by-sha layer.
//
// Row identity is per source and stable: the journal entry id, `owner/repo#n`
// for a GitHub object, the sha for a commit.

export type ActivitySource = "substrate" | "github" | "git" | "jira";

/** Sources that exist today. Jira stays absent from the filter row until it is connected. */
export const LIVE_ACTIVITY_SOURCES: readonly ActivitySource[] = ["substrate", "github", "git"];

export type ActivityRefKind = "issue" | "pr" | "commit" | "branch" | "path";

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
