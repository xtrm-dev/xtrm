// Claims + workspace writer leases for Phase 3 (PRD §§17, 18, 44).
// Append-only; never edit 001-003 after landing.
//
// Liveness is derived (released_at IS NULL AND expires_at > now), never a
// stored flag. The partial unique indexes give exactly-one-open-row as a
// backstop behind the service's serialized check-then-insert: reclaiming an
// expired row closes it in the same transaction that opens the next
// generation, so the slot is never double-held.

export const version = 4;
export const name = "claims-workspace-leases";

export const sql = `
CREATE TABLE issue_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  issue_revision INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  holder TEXT NOT NULL,
  activation_id TEXT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER NULL,
  generation INTEGER NOT NULL,
  UNIQUE (issue_id, generation)
);
CREATE UNIQUE INDEX ux_open_claim ON issue_claims (issue_id) WHERE released_at IS NULL;
CREATE INDEX ix_claims_issue ON issue_claims (issue_id, id);

CREATE TABLE workspace_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL,
  repository_root TEXT NULL,
  branch TEXT NULL,
  holder TEXT NOT NULL,
  activation_id TEXT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER NULL,
  generation INTEGER NOT NULL,
  UNIQUE (workspace, generation)
);
CREATE UNIQUE INDEX ux_open_writer_lease ON workspace_leases (workspace) WHERE released_at IS NULL;
CREATE INDEX ix_leases_workspace ON workspace_leases (workspace, id);
`;
