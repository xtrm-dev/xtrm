import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { version as v1, name as n1, sql as sql1 } from "./001_baseline.ts";

// Append-only migration runner. Landed migrations are never edited: a
// checksum mismatch or an unknown DB version fails closed (PRD §46).

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [{ version: v1, name: n1, sql: sql1 }];

const REQUIRED_TABLES = [
  "projects",
  "issues",
  "issue_revisions",
  "issue_aliases",
  "issue_locator_history",
  "issue_edges",
  "issue_events",
  "seq_counters",
  "idempotency_keys",
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
