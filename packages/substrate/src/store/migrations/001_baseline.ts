// Baseline schema for Phase 1 (PRD §44 subset). Later phases APPEND new
// migration files; this file is never edited after landing.

export const version = 1;
export const name = "baseline-domain-kernel";

export const sql = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  human_number INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 0,
  scrutiny TEXT NOT NULL DEFAULT '',
  current_revision INTEGER NOT NULL DEFAULT 1,
  current_contract_hash TEXT NOT NULL,
  defer_until INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, human_number)
);

CREATE TABLE issue_revisions (
  issue_id TEXT NOT NULL REFERENCES issues(id),
  revision INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  context_refs_json TEXT NOT NULL DEFAULT '[]',
  ownership_json TEXT NULL,
  authored_by TEXT NOT NULL,
  source_json TEXT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue_id, revision)
);

CREATE TABLE issue_aliases (
  alias TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE issue_locator_history (
  project_id TEXT NOT NULL,
  locator TEXT NOT NULL,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, locator)
);

CREATE TABLE issue_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_issue TEXT NOT NULL REFERENCES issues(id),
  to_issue TEXT NOT NULL REFERENCES issues(id),
  kind TEXT NOT NULL,
  child_slot INTEGER NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_active_parent ON issue_edges (to_issue)
  WHERE kind = 'parent_child' AND active = 1;
CREATE UNIQUE INDEX ux_parent_slot ON issue_edges (from_issue, child_slot)
  WHERE kind = 'parent_child';

CREATE TABLE issue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_events_issue ON issue_events (issue_id, id);

-- Key namespaces (bead constraint): human-reference counters, child_slot
-- allocation, and idempotency keys live in distinct namespaces that never
-- collide; keys are never reused across domains.
CREATE TABLE seq_counters (
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  next_val INTEGER NOT NULL,
  PRIMARY KEY (namespace, name)
);

CREATE TABLE idempotency_keys (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);
`;
