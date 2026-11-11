// Read model for issue-to-PR links (design note 11-11, XTRM-726).
// Slice 1 is read-only: writers arrive in XTRM-727.

import type { DatabaseSync } from "../store/database.ts";
import {
  groupIssuePullRequests,
  type IssuePrCommitRow,
  type IssuePullRequestRow,
  type IssuePullRequestView,
  type PrLinkRelation,
  type PrLinkSource,
} from "../domain/pull-request.ts";

interface PullRow {
  id: number;
  issue_id: string;
  repository: string;
  number: number;
  relation: string;
  source: string;
  url: string | null;
  actor: string | null;
  created_at: number;
}

interface CommitRow {
  issue_id: string;
  repository: string;
  number: number;
  sha: string;
  landed_sha: string | null;
  trailer_revision: number | null;
}

function all<T>(db: DatabaseSync, sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export class PullRequestService {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** Every PR linked to the issue: `created_from` first, then `created_at`,
   * with `rowid` as the tie-break the design requires. */
  listForIssue(issueId: string): IssuePullRequestView[] {
    const rows = all<PullRow>(
      this.db,
      `SELECT rowid AS id, issue_id, repository, number, relation, source, url, actor, created_at
         FROM issue_pull_requests WHERE issue_id = ? ORDER BY created_at, rowid`,
      issueId,
    ).map(
      (r): IssuePullRequestRow => ({
        id: r.id,
        issueId: r.issue_id,
        repository: r.repository,
        number: r.number,
        relation: r.relation as PrLinkRelation,
        source: r.source as PrLinkSource,
        url: r.url,
        actor: r.actor,
        createdAt: r.created_at,
      }),
    );
    const commits = all<CommitRow>(
      this.db,
      `SELECT issue_id, repository, number, sha, landed_sha, trailer_revision
         FROM issue_pr_commits WHERE issue_id = ? ORDER BY sha`,
      issueId,
    ).map(
      (r): IssuePrCommitRow => ({
        issueId: r.issue_id,
        repository: r.repository,
        number: r.number,
        sha: r.sha,
        landedSha: r.landed_sha,
        trailerRevision: r.trailer_revision,
      }),
    );
    return groupIssuePullRequests(rows, commits);
  }
}
