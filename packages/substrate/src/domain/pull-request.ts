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

export function strongestRelation(a: PrLinkRelation, b: PrLinkRelation): PrLinkRelation {
  return a === "created_from" || b === "created_from" ? "created_from" : "mentioned";
}

/**
 * Every `XTRM-Issue:` value in a commit message, in order and deduped.
 * `parseTrailers` returns the last value only; T2 needs all of them.
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
      existing.relation = "created_from";
      existing.sources = [row.source];
      existing.url = row.url;
      existing.actor = row.actor;
      existing.createdAt = row.createdAt;
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
  return [...byPr.values()].sort(
    (a, b) => a.createdAt - b.createdAt || `${a.repository}#${a.number}`.localeCompare(`${b.repository}#${b.number}`),
  );
}
