// Board read-model indices (XTRM-393). Append-only; never edit 001-012 after
// landing.
//
// The bounded board projection filters issues by project plus lifecycle/kind/
// title, orders by (human_number, id), and loads blockers and children by edge
// endpoint. Before this migration the only issue-side index was the UNIQUE
// (project_id, human_number) autoindex, so a lifecycle-filtered or
// readiness-classifying scan fell back to a full project scan.
//
// `issues(project_id, human_number)` already exists as an autoindex, so the
// pagination order needs no new index; these cover the filter and edge
// lookups. Readiness is derived, never stored, so it has no index by design.

export const version = 13;
export const name = "board-read-indices";

export const sql = `
CREATE INDEX ix_issues_project_lifecycle ON issues (project_id, lifecycle_state, human_number);
CREATE INDEX ix_issues_project_updated ON issues (project_id, updated_at, human_number);
CREATE INDEX ix_edges_blocks_to ON issue_edges (to_issue, kind, active);
CREATE INDEX ix_edges_children_from ON issue_edges (from_issue, kind, active);
`;
