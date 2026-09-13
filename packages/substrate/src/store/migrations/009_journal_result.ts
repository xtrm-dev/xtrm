// Bounded result payload for the Journal (ADR §§29, 39, bead XTRM-252.5/J1).
//
// `result` is the ninth canonical kind. It carries a durable execution outcome
// that may exist with zero Git commits (Specialists, reviewers, validators,
// non-code workers). The payload is bounded on purpose: arbitrary raw model
// output stays in runtime storage and is referenced, never dumped into the
// Journal.
//
// Additive and non-destructive: ADD COLUMN leaves existing rows untouched and
// every prior row reads with result_json NULL. A result row is written once at
// append time and never updated, matching the append-only journal rule; there
// is deliberately no UPDATE path for result_json (unlike semantic_json, which
// a post-commit summarizer enriches).
//
// Backward compatibility: there is no CHECK constraint on `kind` in any
// migration, so a new-kind row is readable-compatible with this schema. An old
// binary that predates `result` fails closed on it (JournalService.toEntry),
// and an old binary that predates this migration fails closed on the unknown
// schema version (migration runner).

export const version = 9;
export const name = "journal-result-payload";

export const sql = `
ALTER TABLE issue_journal ADD COLUMN result_json TEXT NULL;
`;
