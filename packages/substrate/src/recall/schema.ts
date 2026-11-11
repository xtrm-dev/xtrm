// Recall index schema: one SQLite file, FTS5 over scrubbed journal text, and
// a plain metadata table the filters and the fixed rerank read (CORE-2595).

import { existsSync } from "node:fs";
import type { SubstrateDatabase } from "../store/database.ts";
import { openReadOnlySqlite } from "../store/sqlite.ts";
import { RECALL_SCHEMA_VERSION, STALE_AFTER_MS } from "./constants.ts";
import { SCRUB_VERSION } from "./scrub.ts";
import type { RecallIndexStatus } from "./types.ts";

export const INDEX_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  doc_id         INTEGER PRIMARY KEY,
  source         TEXT    NOT NULL,
  project_id     TEXT    NOT NULL DEFAULT '',
  project_name   TEXT    NOT NULL DEFAULT '',
  project_prefix TEXT    NOT NULL DEFAULT '',
  ref            TEXT    NOT NULL,
  seq            INTEGER NOT NULL DEFAULT -1,
  kind           TEXT    NOT NULL DEFAULT '',
  participant    TEXT,
  ts             INTEGER NOT NULL,
  authority      INTEGER NOT NULL DEFAULT 0,
  superseded_by  INTEGER,
  scrub_version  TEXT    NOT NULL,
  UNIQUE (source, ref, seq)
);
CREATE INDEX IF NOT EXISTS meta_ts      ON meta(ts);
CREATE INDEX IF NOT EXISTS meta_project ON meta(project_id);
CREATE INDEX IF NOT EXISTS meta_ref     ON meta(ref);

CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
  body,
  title,
  head,
  tokenize="porter unicode61 tokenchars '-_'"
);

CREATE TABLE IF NOT EXISTS index_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version TEXT    NOT NULL,
  scrub_version  TEXT    NOT NULL,
  built_at       INTEGER NOT NULL,
  watermark_ts   INTEGER NOT NULL,
  doc_count      INTEGER NOT NULL
);
`;

export interface IndexStateRow {
  schema_version: string;
  scrub_version: string;
  built_at: number;
  watermark_ts: number;
  doc_count: number;
}

export function ensureIndexSchema(db: SubstrateDatabase): void {
  db.exec(INDEX_DDL);
}

export function readIndexState(db: SubstrateDatabase): IndexStateRow | null {
  const row = db.prepare(
    "SELECT schema_version, scrub_version, built_at, watermark_ts, doc_count FROM index_state WHERE id = 1",
  ).get();
  if (!row) return null;
  return {
    schema_version: String(row["schema_version"]),
    scrub_version: String(row["scrub_version"]),
    built_at: Number(row["built_at"]),
    watermark_ts: Number(row["watermark_ts"]),
    doc_count: Number(row["doc_count"]),
  };
}

export function isCompatibleState(state: IndexStateRow | null): boolean {
  return state !== null && state.schema_version === RECALL_SCHEMA_VERSION && state.scrub_version === SCRUB_VERSION;
}

function missingStatus(path: string): RecallIndexStatus {
  return {
    path,
    exists: false,
    builtAt: null,
    ageMs: null,
    watermark: null,
    watermarkAgeMs: null,
    stale: true,
    docCount: null,
    scrubVersion: null,
    compatible: false,
    failure: "missing",
  };
}

/**
 * Fail-open status read. A missing, corrupt, locked or foreign file reports
 * itself as unusable; the caller returns no hits instead of failing a session.
 */
export function readIndexStatus(path: string, now = Date.now()): RecallIndexStatus {
  if (!existsSync(path)) return missingStatus(path);
  let db: SubstrateDatabase | null = null;
  try {
    db = openReadOnlySqlite(path);
    const state = readIndexState(db);
    if (state === null) return { ...missingStatus(path), exists: true };
    const ageMs = Math.max(0, now - state.built_at);
    // Zero means the source had no rows yet; an age measured from epoch is
    // meaningless, so report absence instead of a 55-year-old watermark.
    const watermark = state.watermark_ts > 0 ? state.watermark_ts : null;
    const watermarkAgeMs = watermark === null ? null : Math.max(0, now - watermark);
    const compatible = isCompatibleState(state);
    return {
      path,
      exists: true,
      builtAt: state.built_at,
      ageMs,
      watermark,
      watermarkAgeMs,
      stale: ageMs > STALE_AFTER_MS,
      docCount: state.doc_count,
      scrubVersion: state.scrub_version,
      compatible,
      failure: compatible ? undefined : "incompatible",
    };
  } catch {
    const lockPath = `${path}.lock`;
    return { ...missingStatus(path), exists: true, failure: existsSync(lockPath) ? "locked" : "corrupt" };
  } finally {
    try {
      db?.close();
    } catch {
      /* a close failure must not mask the status */
    }
  }
}
