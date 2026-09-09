// Projections + sync tables for Phase 10 (PRD §§31-34). Appended, never edits 001.

export const version = 2;
export const name = "projections-sync";

export const sql = `
CREATE TABLE external_bindings (
  issue_id TEXT NOT NULL REFERENCES issues(id),
  provider TEXT NOT NULL,
  remote_scope TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  remote_key TEXT NULL,
  url TEXT NULL,
  mode TEXT NOT NULL,
  last_pushed_revision INTEGER NULL,
  last_seen_remote_version TEXT NULL,
  mapped_content_hash TEXT NULL,
  sync_state TEXT NOT NULL DEFAULT 'in_sync',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, provider, remote_scope, remote_id)
);

CREATE TABLE integration_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  seen_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  processed_at INTEGER NULL,
  UNIQUE (provider, idempotency_key)
);

CREATE TABLE projection_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  provider TEXT NOT NULL,
  remote_scope TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  mapped_content_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_outbox_drain ON projection_outbox (status, next_retry_at);
`;
