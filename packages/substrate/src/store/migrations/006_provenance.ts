// Provenance tables for Phase 8 (PRD §§26-29, 44). Append-only; never edit
// 001-005 after landing. Bindings and receipts are immutable once written:
// post-commit fills the receipt's commit SHA, post-rewrite supersedes the
// old SHA row and inserts the new one — rows are never updated in place
// except for those two host-owned finalizations.

export const version = 6;
export const name = "execution-provenance";

export const sql = `
CREATE TABLE execution_bindings (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  issue_revision INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  resolved_context_hash TEXT NOT NULL,
  claim_id INTEGER NULL,
  participant_id TEXT NULL,
  activation_id TEXT NULL,
  attempt_id TEXT NULL,
  session_id TEXT NULL,
  workspace TEXT NOT NULL,
  base_commit TEXT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_bindings_issue ON execution_bindings (issue_id, created_at);

CREATE TABLE work_receipts (
  id TEXT PRIMARY KEY,
  execution_binding_id TEXT NOT NULL REFERENCES execution_bindings(id),
  issue_id TEXT NOT NULL REFERENCES issues(id),
  issue_revision INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  journal_checkpoint_id TEXT NULL,
  validation_refs_json TEXT NOT NULL DEFAULT '[]',
  commit_sha TEXT NULL,
  created_at INTEGER NOT NULL,
  finalized_at INTEGER NULL
);
CREATE INDEX ix_receipts_binding ON work_receipts (execution_binding_id, created_at);
CREATE INDEX ix_receipts_issue ON work_receipts (issue_id, created_at);

CREATE TABLE artifact_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id TEXT NOT NULL REFERENCES work_receipts(id),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  provider TEXT NULL,
  created_at INTEGER NOT NULL,
  superseded_at INTEGER NULL,
  UNIQUE (receipt_id, kind, value)
);
CREATE INDEX ix_artifacts_receipt ON artifact_bindings (receipt_id, kind);
CREATE INDEX ix_artifacts_value ON artifact_bindings (kind, value);
`;
