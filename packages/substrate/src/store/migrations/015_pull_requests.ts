// Live PR state for the reconciler (design note 11-11, XTRM-728).
//
// The link row says "this PR is this issue's work (or mentions it)"; this
// table says what the PR itself is doing now. The host inserts at open, the
// reconciler owns every later change. `etag`/`last_modified` are the
// conditional-request cache; `last_synced_at` records the last successful read.

export const version = 15;
export const name = "pull-requests";

export const sql = `
CREATE TABLE pull_requests (
  repository       TEXT    NOT NULL,
  number           INTEGER NOT NULL,
  state            TEXT    NOT NULL CHECK (state IN ('open','merged','closed')),
  draft            INTEGER NOT NULL DEFAULT 0,
  head_sha         TEXT    NULL,
  merge_commit_sha TEXT    NULL,
  title            TEXT    NULL,
  url              TEXT    NULL,
  base_ref         TEXT    NULL,
  merged_at        INTEGER NULL,
  closed_at        INTEGER NULL,
  etag             TEXT    NULL,
  last_modified    TEXT    NULL,
  last_synced_at   INTEGER NOT NULL,
  PRIMARY KEY (repository, number)
);
CREATE INDEX ix_pull_requests_state ON pull_requests (state);
`;
