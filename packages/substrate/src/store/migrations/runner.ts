import { createHash } from "node:crypto";
import type { DatabaseSync } from "../database.ts";
import { version as v1, name as n1, sql as sql1 } from "./001_baseline.ts";
import { version as v2, name as n2, sql as sql2 } from "./002_projections_sync.ts";
import { version as v3, name as n3, sql as sql3 } from "./003_readiness.ts";
import { version as v4, name as n4, sql as sql4 } from "./004_claims_leases.ts";
import { version as v5, name as n5, sql as sql5 } from "./005_journal.ts";
import { version as v6, name as n6, sql as sql6 } from "./006_provenance.ts";
import { version as v7, name as n7, sql as sql7 } from "./007_checkout_links.ts";
import { version as v8, name as n8, sql as sql8 } from "./008_repository_bindings.ts";
import { version as v9, name as n9, sql as sql9 } from "./009_journal_result.ts";
import { version as v10, name as n10, sql as sql10 } from "./010_execution_context.ts";
import { version as v11, name as n11, sql as sql11 } from "./011_closure.ts";
import { version as v12, name as n12, sql as sql12 } from "./012_drop_workspace_leases.ts";
import { version as v13, name as n13, sql as sql13 } from "./013_issue_pull_requests.ts";
import { version as v14, name as n14, sql as sql14 } from "./014_issue_pull_request_supersession.ts";
import { version as v15, name as n15, sql as sql15 } from "./015_pull_requests.ts";
import { version as v16, name as n16, sql as sql16 } from "./016_pull_request_state_source.ts";
import { version as v17, name as n17, sql as sql17 } from "./017_journal_feed_index.ts";

// Append-only migration runner. Landed migrations are never edited: a
// checksum mismatch or an unknown DB version fails closed (PRD §46).

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: v1, name: n1, sql: sql1 },
  { version: v2, name: n2, sql: sql2 },
  { version: v3, name: n3, sql: sql3 },
  { version: v4, name: n4, sql: sql4 },
  { version: v5, name: n5, sql: sql5 },
  { version: v6, name: n6, sql: sql6 },
  { version: v7, name: n7, sql: sql7 },
  { version: v8, name: n8, sql: sql8 },
  { version: v9, name: n9, sql: sql9 },
  { version: v10, name: n10, sql: sql10 },
  { version: v11, name: n11, sql: sql11 },
  { version: v12, name: n12, sql: sql12 },
  { version: v13, name: n13, sql: sql13 },
  { version: v14, name: n14, sql: sql14 },
  { version: v15, name: n15, sql: sql15 },
  { version: v16, name: n16, sql: sql16 },
  { version: v17, name: n17, sql: sql17 },
];

const REQUIRED_TABLES = [
  "projects",
  "issues",
  "issue_revisions",
  "issue_aliases",
  "issue_locator_history",
  "issue_edges",
  "readiness_attestations",
  "issue_claims",
  "issue_events",
  "issue_journal",
  "execution_bindings",
  "checkout_links",
  "repository_bindings",
  "issue_closures",
  "closure_attempts",
  "work_receipts",
  "artifact_bindings",
  "seq_counters",
  "idempotency_keys",
  "external_bindings",
  "integration_inbox",
  "projection_outbox",
  "issue_pull_requests",
  "issue_pr_commits",
];

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export function migrate(db: DatabaseSync): number[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );
  const applied = new Map<number, { name: string; checksum: string }>();
  for (const row of db
    .prepare("SELECT version, name, checksum FROM schema_migrations")
    .all() as Array<{ version: number; name: string; checksum: string }>) {
    applied.set(row.version, { name: row.name, checksum: row.checksum });
  }
  const known = new Map(MIGRATIONS.map((m) => [m.version, m]));
  for (const v of applied.keys()) {
    if (!known.has(v)) throw new Error(`fail-closed: unknown migration version ${v} in database`);
  }
  const done: number[] = [];
  for (const m of MIGRATIONS) {
    const row = applied.get(m.version);
    if (row) {
      if (row.checksum !== checksum(m.sql)) {
        throw new Error(`fail-closed: landed migration ${m.version} was modified`);
      }
      done.push(m.version);
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
        m.version,
        m.name,
        checksum(m.sql),
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already failed */
      }
      throw err;
    }
    done.push(m.version);
  }
  assertSchemaHealthy(db);
  return done;
}

// A database that claims to be migrated but is missing tables is corrupt:
// refuse startup and mutation rather than guessing (PRD §46).
export function assertSchemaHealthy(db: DatabaseSync): void {
  const have = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((r) => r.name),
  );
  const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
  if (missing.length > 0) throw new Error(`fail-closed: corrupt schema, missing tables: ${missing.join(", ")}`);
}
