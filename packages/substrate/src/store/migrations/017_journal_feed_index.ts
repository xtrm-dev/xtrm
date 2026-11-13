// Project-wide Journal feed (XTRM-764).
//
// `sb journal feed --project` reads one page across every Issue of a project,
// newest first, ordered by `(created_at, id)`. The existing indexes are
// issue-scoped (`ix_journal_issue_seq`, `ix_journal_kind`), so a project read
// would sort the whole table. This index makes the page a bounded range scan in
// the order the feed serves, and keeps the cursor comparison a range predicate
// rather than a sort.
//
// Additive and non-destructive: an index only, no column and no row changes.

export const version = 17;
export const name = "journal-feed-index";

export const sql = `
CREATE INDEX ix_journal_created ON issue_journal (created_at, id);
`;
