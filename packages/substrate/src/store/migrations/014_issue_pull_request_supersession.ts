// Issue-to-PR supersession (design note 11-11, XTRM-727).
//
// Unlink never deletes evidence: it sets `superseded_at`, and every read
// filters it out. Append-only stays true: rows are added, never rewritten
// except this one host-owned finalization.

export const version = 14;
export const name = "issue-pull-request-supersession";

export const sql = `
ALTER TABLE issue_pull_requests ADD COLUMN superseded_at INTEGER NULL;
CREATE INDEX ix_issue_prs_live ON issue_pull_requests (issue_id, superseded_at);
`;
