// Dispatcher identity on the execution binding (XTRM-839, advisor D8).
//
// Additive and non-destructive: ADD COLUMN leaves every existing row
// untouched. Both columns are nullable and stay NULL for every binding
// written before this migration, and for every later dispatch that does not
// name a dispatcher. No backfill and no default: a dispatcher that was never
// recorded reads as absent, never as a placeholder (ADR §98).
//
// dispatcher_participant_id: who dispatched the execution (a holder label).
// dispatcher_session_id:     the xtrm session the dispatcher ran in.
// Both are observed labels, like participant_id/session_id on the same row.

export const version = 17;
export const name = "dispatcher-identity";

export const sql = `
ALTER TABLE execution_bindings ADD COLUMN dispatcher_participant_id TEXT NULL;
ALTER TABLE execution_bindings ADD COLUMN dispatcher_session_id TEXT NULL;
`;
