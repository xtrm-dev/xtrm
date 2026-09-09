// Checkout-to-project links for cwd-aware resolution (bead xtrm-7wc.5.6).
// DB-side mapping only: `sb project link` binds the checkout's git root to
// a project id with zero repo writes (no link file, no .gitignore
// coordination). Fresh clones re-link explicitly. Re-linking replaces the
// row; unlinking deletes it. Resolution precedence lives in
// IssueService.resolveProject, not here.

export const version = 7;
export const name = "checkout-links";

export const sql = `
CREATE TABLE checkout_links (
  git_root TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  linked_at INTEGER NOT NULL
);
`;
