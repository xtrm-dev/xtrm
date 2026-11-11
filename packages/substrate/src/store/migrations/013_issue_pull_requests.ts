// Issue-to-PR links (design note 11-11, XTRM-726).
//
// Additive and non-destructive: two append-only tables. `issue_pull_requests`
// is the relation record (created_from | mentioned) with the evidence source;
// `issue_pr_commits` is the T2 evidence (the PR's own commits), indexed by SHA
// so `provenance commit` and the step-27 revert check read SHA -> issue in one
// hop. `landed_sha` is deliberately not unique: a squash commit on main can
// carry trailers for several issues.
//
// The `pull_requests` live-state table belongs to slice 3 (XTRM-728); it is
// not created here.

export const version = 13;
export const name = "issue-pull-requests";

export const sql = `
CREATE TABLE issue_pull_requests (
  issue_id   TEXT    NOT NULL REFERENCES issues(id),
  repository TEXT    NOT NULL,
  number     INTEGER NOT NULL,
  relation   TEXT    NOT NULL CHECK (relation IN ('created_from','mentioned')),
  source     TEXT    NOT NULL CHECK (source IN ('provenance','explicit','trailer','title','branch','prose','backfill')),
  url        TEXT    NULL,
  actor      TEXT    NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, repository, number, relation, source)
);
CREATE INDEX ix_issue_prs_repo ON issue_pull_requests (repository, number);

CREATE TABLE issue_pr_commits (
  issue_id         TEXT    NOT NULL REFERENCES issues(id),
  repository       TEXT    NOT NULL,
  number           INTEGER NOT NULL,
  sha              TEXT    NOT NULL,
  landed_sha       TEXT    NULL,
  trailer_revision INTEGER NULL,
  PRIMARY KEY (issue_id, repository, number, sha),
  UNIQUE (repository, number, sha)
);
CREATE INDEX ix_issue_pr_commits_sha ON issue_pr_commits (sha);
CREATE INDEX ix_issue_pr_commits_landed ON issue_pr_commits (landed_sha);
`;
