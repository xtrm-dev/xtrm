// Board read-model indices (XTRM-393). Append-only; never edit 001-012 after
// landing.
//
// Only the two edge indices are here, because only they were chosen by the
// planner. Measured with EXPLAIN QUERY PLAN on a 20,000-issue project after
// ANALYZE:
//
//   SELECT ... FROM issues WHERE project_id = ? ORDER BY human_number, id LIMIT ?
//     -> SEARCH i USING INDEX sqlite_autoindex_issues_2 (project_id=?)
//
// The UNIQUE (project_id, human_number) autoindex from migration 001 already
// serves the board's filter AND its ordering with an early LIMIT exit, so an
// issues-side index buys nothing: two candidates were measured and neither was
// ever selected, at any filter or selectivity (including a single-value
// lifecycle filter on 2,000 of 20,000 rows, where an index on
// (project_id, lifecycle_state, human_number) most plausibly would have won).
// They are deliberately absent rather than added speculatively, because an
// unused index costs write amplification on every issue insert and update:
//
//   ix_issues_project_lifecycle  -> never selected; dropped from this migration
//   ix_issues_project_updated    -> no query orders by or filters on
//                                   issues.updated_at, so it had no reader
//
// The edge indices ARE load-bearing and are covering: the batch loaders read
// blockers and children by endpoint, and the root-only board filter
// (`NOT EXISTS` a parent_child edge) also resolves through
// ix_edges_blocks_to, whose (to_issue, kind, active) prefix covers it.
//
// Readiness is derived, never stored, so it has no index by design.

export const version = 13;
export const name = "board-read-indices";

export const sql = `
CREATE INDEX ix_edges_blocks_to ON issue_edges (to_issue, kind, active);
CREATE INDEX ix_edges_children_from ON issue_edges (from_issue, kind, active);
`;
