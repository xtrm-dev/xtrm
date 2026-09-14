// Shared ExecutionContext envelope persistence (bead XTRM-252.6/X1).
//
// Additive and non-destructive: ADD COLUMN leaves existing rows untouched;
// every prior row reads with execution_context_json NULL, which services
// project to a legacy-derived v1 envelope (or absent when nothing is
// known). No backfill: inventing identity for old rows is exactly the
// fabrication ADR §98 forbids.

export const version = 10;
export const name = "execution-context-envelope";

export const sql = `
ALTER TABLE execution_bindings ADD COLUMN execution_context_json TEXT NULL;
ALTER TABLE issue_journal ADD COLUMN execution_context_json TEXT NULL;
`;
