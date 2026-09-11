import { createRequire } from "node:module";
import { migrate } from "./migrations/runner.ts";
import type { SQLInputValue, SubstrateDatabase, SubstrateStatement } from "./database.ts";

type RuntimeStatement = {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
};

type RuntimeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): RuntimeStatement;
  close(): void;
};

// Bun exposes the SQLite driver as "bun:sqlite" (export name Database);
// Node exposes it as "node:sqlite" (export name DatabaseSync). Selection is
// lazy and conditional so Bun never resolves its missing "node:sqlite"
// built-in and Node never touches "bun:sqlite".
function loadDriver(): new (path: string) => RuntimeDatabase {
  const require = createRequire(import.meta.url);
  if ((globalThis as { Bun?: unknown }).Bun !== undefined) {
    return (require("bun:sqlite") as { Database: new (path: string) => RuntimeDatabase }).Database;
  }
  return (require("node:sqlite") as { DatabaseSync: new (path: string) => RuntimeDatabase }).DatabaseSync;
}

// bun:sqlite binds undefined as NULL while node:sqlite rejects it. Normalize
// once at the adapter seam so both runtimes expose the same statement behavior.
function adaptDatabase(inner: RuntimeDatabase): SubstrateDatabase {
  const adaptStatement = (statement: RuntimeStatement): SubstrateStatement => {
    const params = (values: unknown[]): SQLInputValue[] => values.map((value) => value === undefined ? null : value) as SQLInputValue[];
    return {
      get: (...values) => statement.get(...params(values)),
      all: (...values) => statement.all(...params(values)),
      run: (...values) => statement.run(...params(values)),
    };
  };
  return {
    exec: (sql) => inner.exec(sql),
    prepare: (sql) => adaptStatement(inner.prepare(sql)),
    close: () => inner.close(),
  };
}

// Canonical store opener: SQLite/WAL, fail-closed on corrupt schema or
// unknown migration state (PRD §§7, 46). Committed transactions survive
// restart via WAL (PRD §47).
export function openSubstrate(dbPath: string): SubstrateDatabase {
  const db = adaptDatabase(new (loadDriver())(dbPath));
  db.exec("PRAGMA journal_mode = WAL");
  // Concurrent claim/lease writers serialize on BEGIN IMMEDIATE; wait for
  // the holder instead of failing fast so exactly-one-winner races resolve
  // by check-then-insert rather than SQLITE_BUSY (PRD §17, C15).
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}
