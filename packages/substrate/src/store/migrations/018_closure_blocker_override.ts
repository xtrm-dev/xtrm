// Deliberate close past an open blocker (XTRM-959).
//
// Additive and non-destructive: both columns are nullable/defaulted, so every
// Closure row written before this migration reads as "no override" rather than
// as a placeholder record (ADR §98). The pair answers two questions a forced
// close must keep: WHY the dependency stopped binding, and WHICH blockers were
// still open when it was written. The blockers are stored as human refs, since
// those are what a reader can look up after the ids have been forgotten.

export const version = 18;
export const name = "closure-blocker-override";

export const sql = `
ALTER TABLE issue_closures ADD COLUMN blocker_override_reason TEXT NULL;
ALTER TABLE issue_closures ADD COLUMN blocker_override_refs_json TEXT NOT NULL DEFAULT '[]';
`;
