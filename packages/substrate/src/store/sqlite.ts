import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations/runner.ts";

// Canonical store opener: SQLite/WAL, fail-closed on corrupt schema or
// unknown migration state (PRD §§7, 46). Committed transactions survive
// restart via WAL (PRD §47).
export function openSubstrate(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
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
