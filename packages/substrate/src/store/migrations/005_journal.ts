// Journal tables for Phase 5 (PRD §§20, 44). Append-only; never edit
// 001-004 after landing. Sequence is per-issue, monotonic, never reused;
// the partial read cursor (§20.5) is a sequence number.

export const version = 5;
export const name = "issue-journal";

export const sql = `
CREATE TABLE issue_journal (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  issue_revision INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  run_id TEXT NULL,
  participant_id TEXT NULL,
  activation_id TEXT NULL,
  session_id TEXT NULL,
  kind TEXT NOT NULL,
  mechanical_json TEXT NULL,
  semantic_json TEXT NULL,
  refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE (issue_id, sequence)
);
CREATE INDEX ix_journal_issue_seq ON issue_journal (issue_id, sequence);
CREATE INDEX ix_journal_kind ON issue_journal (issue_id, kind, sequence);
`;
