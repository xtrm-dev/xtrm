import { createRequire } from "node:module";
import { migrate } from "./migrations/runner.ts";
import type { SubstrateDatabase } from "./database.ts";

function isBun(): boolean {
  return (globalThis as { Bun?: unknown }).Bun !== undefined;
}

// Bun exposes the SQLite driver as "bun:sqlite" (export name Database);
// Node exposes it as "node:sqlite" (export name DatabaseSync). Both satisfy
// SubstrateDatabase structurally (exec/prepare/get/all/run/close with the
// same binding and result shapes). Selection is lazy and conditional so a
// Bun-hosted process never resolves "node:sqlite" (Bun 1.3 reports
// "No such built-in module" for it) and Node never touches "bun:sqlite".
function loadDriver(): new (path: string) => SubstrateDatabase {
  const require = createRequire(import.meta.url);
  if (isBun()) {
    return (require("bun:sqlite") as { Database: new (path: string) => SubstrateDatabase }).Database;
  }
  return (require("node:sqlite") as { DatabaseSync: new (path: string) => SubstrateDatabase }).DatabaseSync;
}

// Canonical store opener: SQLite/WAL, fail-closed on corrupt schema or
// unknown migration state (PRD §§7, 46). Committed transactions survive
// restart via WAL (PRD §47).
export function openSubstrate(dbPath: string): SubstrateDatabase {
  const db = new (loadDriver())(dbPath);
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
