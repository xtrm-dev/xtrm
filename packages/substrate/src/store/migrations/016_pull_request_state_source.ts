// Where a `pull_requests.state` value came from (XTRM-754).
//
// The host writes a row at PR open, before any GitHub read, so its state is an
// ASSUMPTION ('assumed'); the reconciler (728) writes what it OBSERVED
// ('observed'). Without this marker a late attach of an already-merged PR is
// indistinguishable from a real observation. NULL means "written before this
// column existed" and is treated as unknown.

export const version = 16;
export const name = "pull-request-state-source";

export const sql = `
ALTER TABLE pull_requests ADD COLUMN state_source TEXT NULL
  CHECK (state_source IS NULL OR state_source IN ('assumed','observed'));
`;
