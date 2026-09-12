// Repository-level binding (ADR sbcloseout4 §§13-15, bead XTRM-252.1).
//
// `checkout_links` (migration 007) maps a checkout path to a Project. That is
// a local alias: a moved checkout, a linked worktree or a second clone loses
// it, and it says nothing about which repository the Project represents. This
// migration adds the canonical authority: one row per normalized repository
// identity (`repository_key`, unique), carrying the Project it is bound to.
//
// Non-destructive demotion of `checkout_links`: the table and its rows are
// left untouched. It stays a local cache/alias that resolution may read; it is
// no longer the primary authority. Nothing is backfilled here on purpose: a
// repository_key can only be derived from an observed canonical remote or Git
// common root, and inventing one from a path is exactly the fabrication ADR
// §98 forbids. The binding service (`RepositoryService.bindRepository`) fills
// both tables when a repository is initialized.
//
// Unknown values are stored absent, never invented (ADR §98): `canonical_remote`
// is NULL for a remote-less repository and `base_branch` is NULL when detection
// is inconclusive.

export const version = 8;
export const name = "repository-bindings";

export const sql = `
CREATE TABLE repository_bindings (
  repository_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  base_branch TEXT NULL,
  canonical_remote TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX repository_bindings_project_idx ON repository_bindings (project_id);
`;
