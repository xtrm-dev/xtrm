// First-class Closure records (bead XTRM-252.7/C1, ADR §96).
//
// Additive and non-destructive: CREATE TABLE leaves every existing row
// untouched. `issue_closures` holds one immutable row per successful
// terminal close (never UPDATEd or DELETEd — reopening adds a reopen
// event, never mutates the row, ADR §45). `closure_attempts` holds every
// close/reopen/cancel attempt including failures (ADR §47), so a later
// success never rewrites the failed attempts away.

export const version = 11;
export const name = "issue-closure";

export const sql = `
CREATE TABLE issue_closures (
  closure_id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  issue_revision INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  terminal_state TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  execution_context_json TEXT NULL,
  validation_refs_json TEXT NOT NULL DEFAULT '[]',
  journal_result_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'sb',
  legacy_state TEXT NULL,
  closed_at INTEGER NOT NULL
);
CREATE INDEX ix_closures_issue ON issue_closures (issue_id, closed_at);

CREATE TABLE closure_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  outcome TEXT NULL,
  reason TEXT NULL,
  error TEXT NULL,
  closure_id TEXT NULL REFERENCES issue_closures(closure_id),
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_closure_attempts_issue ON closure_attempts (issue_id, id);
`;
