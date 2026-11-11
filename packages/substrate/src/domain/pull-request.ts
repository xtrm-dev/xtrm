// Issue-to-PR links: the relation vocabulary and the pure read model
// (design note 11-11, XTRM-726). Storage lives in migration 013.

export const PR_LINK_RELATIONS = ["created_from", "mentioned"] as const;
export type PrLinkRelation = (typeof PR_LINK_RELATIONS)[number];

export const PR_LINK_SOURCES = [
  "provenance",
  "explicit",
  "trailer",
  "title",
  "branch",
  "prose",
  "backfill",
] as const;
export type PrLinkSource = (typeof PR_LINK_SOURCES)[number];

export interface IssuePullRequestRow {
  /** SQLite rowid: the `id` in the design's `created_at, id` tie-break. */
  id: number;
  issueId: string;
  repository: string;
  number: number;
  relation: PrLinkRelation;
  source: PrLinkSource;
  url: string | null;
  actor: string | null;
  createdAt: number;
}

export interface IssuePrCommitRow {
  issueId: string;
  repository: string;
  number: number;
  sha: string;
  landedSha: string | null;
  trailerRevision: number | null;
}

/** One PR as the read model shows it: the strongest relation, every source
 * that produced it, and the T2 commit evidence. */
export interface IssuePullRequestView {
  /** rowid of the winning row. */
  id: number;
  repository: string;
  number: number;
  relation: PrLinkRelation;
  sources: PrLinkSource[];
  /** A `mentioned` row exists even though `created_from` outranks it. */
  alsoMentioned: boolean;
  url: string | null;
  actor: string | null;
  createdAt: number;
  commits: IssuePrCommitRow[];
}

/**
 * Every `XTRM-Issue:` value in a commit message, in order and deduped.
 * `parseTrailers` returns the last value only; T2 needs all of them.
 * XTRM-727 replaces this with `parseAllTrailers` once XTRM-734 merges.
 */
export function trailerIssueRefs(message: string): string[] {
  const refs: string[] = [];
  for (const line of message.split("\n")) {
    const m = /^XTRM-Issue:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const ref = m[1]!.trim();
    if (ref !== "" && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * Collapse rows to one view per PR: `created_from` outranks `mentioned`;
 * repeated rows are already ordered by `created_at, rowid`, so the first row
 * of the winning relation supplies url/actor/createdAt.
 */
export function groupIssuePullRequests(
  rows: IssuePullRequestRow[],
  commits: IssuePrCommitRow[],
): IssuePullRequestView[] {
  const byPr = new Map<string, IssuePullRequestView>();
  for (const row of rows) {
    const key = `${row.repository}#${row.number}`;
    const existing = byPr.get(key);
    if (existing === undefined) {
      byPr.set(key, {
        id: row.id,
        repository: row.repository,
        number: row.number,
        relation: row.relation,
        sources: [row.source],
        alsoMentioned: row.relation === "mentioned",
        url: row.url,
        actor: row.actor,
        createdAt: row.createdAt,
        commits: [],
      });
      continue;
    }
    if (row.relation === "created_from" && existing.relation === "mentioned") {
      // Re-place the view at this row's position: the input is ordered by
      // created_at, rowid, and the final sort is a stable rank sort.
      byPr.delete(key);
      byPr.set(key, {
        ...existing,
        relation: "created_from",
        id: row.id,
        sources: [row.source],
        url: row.url,
        actor: row.actor,
        createdAt: row.createdAt,
      });
      continue;
    }
    if (row.relation === "mentioned" && existing.relation === "created_from") {
      existing.alsoMentioned = true;
      continue;
    }
    if (!existing.sources.includes(row.source)) existing.sources.push(row.source);
    if (existing.url === null && row.url !== null) existing.url = row.url;
  }
  for (const commit of commits) {
    const view = byPr.get(`${commit.repository}#${commit.number}`);
    if (view !== undefined) view.commits.push(commit);
  }
  for (const view of byPr.values()) {
    view.commits.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  }
  // The rows arrive ordered by created_at, rowid; the Map keeps that order,
  // so the stable rank sort leaves the design tie-break intact. Sorting by
  // createdAt/id again here would mask a wrong SQL order in tests.
  const rank = (relation: PrLinkRelation): number => (relation === "created_from" ? 0 : 1);
  return [...byPr.values()].sort((a, b) => rank(a.relation) - rank(b.relation));
}
