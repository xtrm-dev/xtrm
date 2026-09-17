// Withdraw the Substrate workspace writer lease (bead XTRM-414).
//
// Forward-only removal: the lease API is deleted and workspace exclusion is
// owned by the specialists activation layer
// (specialists/src/activation/workspace-lease.ts), so the table, its partial
// unique index and its workspace index go away. No other table is touched.
// No data migration: workspace_leases held 0 rows on the live board at
// removal time, and acquisition was unreachable from any production path.

export const version = 12;
export const name = "drop-workspace-leases";

export const sql = `
DROP INDEX IF EXISTS ux_open_writer_lease;
DROP INDEX IF EXISTS ix_leases_workspace;
DROP TABLE IF EXISTS workspace_leases;
`;
