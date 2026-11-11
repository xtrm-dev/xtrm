// Incremental journal indexer for Substrate recall (CORE-2595, R1).
//
// One writer only: the user systemd timer runs this as a oneshot under nice
// and MemoryMax, with a load gate. There is no daemon and no watcher. The
// source store is opened read-only; the raw journal text never leaves this
// function unscrubbed.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { loadavg } from "node:os";
import type { SubstrateDatabase } from "../store/database.ts";
import { openBareSqlite, openReadOnlySqlite } from "../store/sqlite.ts";
import {
  BODY_MAX_CHARS,
  HEAD_MAX_CHARS,
  LOCK_STALE_MS,
  RECALL_SCHEMA_VERSION,
  defaultLoadGate,
  defaultRecallIndexPath,
} from "./constants.ts";
import { ensureIndexSchema, isCompatibleState, readIndexState } from "./schema.ts";
import { SCRUB_VERSION, scrubJsonValue, scrubText } from "./scrub.ts";
import type { RecallBuildOptions, RecallBuildResult } from "./types.ts";

export const JOURNAL_SOURCE = "substrate-journal";

const COMMIT_EVERY = 1000;

/** Design authority ladder (CORE-2581): operator ruling 4 > decision 3 > ... */
export function authorityForKind(kind: string): number {
  switch (kind) {
    case "decision":
      return 3;
    case "finding":
    case "result":
      return 2;
    case "note":
    case "handoff":
    case "milestone":
    case "blocker":
      return 1;
    case "checkpoint":
    case "compaction":
      return 0;
    default:
      return 1;
  }
}

const MAX_FLATTEN_DEPTH = 8;

/** Flatten nested JSON into indexable prose. Object keys are not text. */
export function flattenJournalValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > MAX_FLATTEN_DEPTH) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return flattenJournalValue(JSON.parse(trimmed), depth + 1);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return "";
  if (Array.isArray(value)) {
    return value.map((item) => flattenJournalValue(item, depth + 1)).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => flattenJournalValue(item, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

export interface JournalSourceRow {
  id: string;
  sequence: number;
  kind: string;
  participant_id: string | null;
  created_at: number;
  mechanical_json: string | null;
  semantic_json: string | null;
  result_json: string | null;
  refs_json: string | null;
  human_number: number;
  title: string | null;
  project_id: string;
  project_name: string;
  prefix: string;
}

export interface RecallDocument {
  source: string;
  ref: string;
  seq: number;
  kind: string;
  participant: string | null;
  ts: number;
  authority: number;
  projectId: string;
  projectName: string;
  projectPrefix: string;
  body: string;
  title: string;
  head: string;
  scrubVersion: string;
}

function scrubJournalPart(raw: string | null): string {
  if (raw === null || raw.trim() === "") return "";
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // plain text part
  }
  return flattenJournalValue(scrubJsonValue(value));
}

export function journalDocument(row: JournalSourceRow): RecallDocument | null {
  const rawBody = [
    scrubJournalPart(row.semantic_json),
    scrubJournalPart(row.result_json),
    scrubJournalPart(row.mechanical_json),
    scrubJournalPart(row.refs_json),
  ]
    .filter((part) => part.trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // A checkpoint with no mechanical payload carries no retrievable text.
  if (rawBody === "") return null;
  // Scrub BEFORE the cap: truncating first would leave a half-secret tail in
  // the stored text and hand the raw prefix to FTS.
  const body = scrubText(rawBody).text.slice(0, BODY_MAX_CHARS);
  const ref = `${row.prefix}-${row.human_number}`;
  const title = scrubText(row.title ?? "").text;
  const head = scrubText(`${ref} ${row.kind} ${body.slice(0, HEAD_MAX_CHARS)}`).text.slice(0, HEAD_MAX_CHARS + 64);
  return {
    source: JOURNAL_SOURCE,
    ref,
    seq: row.sequence,
    kind: row.kind,
    participant: row.participant_id,
    ts: row.created_at,
    authority: authorityForKind(row.kind),
    projectId: row.project_id,
    projectName: row.project_name,
    projectPrefix: row.prefix,
    body,
    title,
    head,
    scrubVersion: SCRUB_VERSION,
  };
}

interface LockHandle {
  release(): void;
}

function acquireLock(lockPath: string, now: number): LockHandle | null {
  const nonce = `${process.pid}:${now}:${Math.random().toString(36).slice(2)}`;
  const attempt = (): LockHandle | null => {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: now, nonce }));
      closeSync(fd);
      return {
        release: () => {
          try {
            const held = JSON.parse(readFileSync(lockPath, "utf8")) as { nonce?: unknown };
            if (held.nonce === nonce) rmSync(lockPath, { force: true });
          } catch {
            // a missing or replaced lock is not ours to delete
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return null;
    }
  };
  const first = attempt();
  if (first !== null) return first;
  try {
    const age = now - statSync(lockPath).mtimeMs;
    if (age <= LOCK_STALE_MS) return null;
    rmSync(lockPath, { force: true });
  } catch {
    return null;
  }
  return attempt();
}

function readLockPid(lockPath: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

const SOURCE_SQL = `
SELECT j.id, j.sequence, j.kind, j.participant_id, j.created_at,
       j.mechanical_json, j.semantic_json, j.result_json, j.refs_json,
       i.human_number, i.title, i.project_id, p.name AS project_name, p.prefix
FROM issue_journal j
JOIN issues i ON i.id = j.issue_id
JOIN projects p ON p.id = i.project_id
WHERE j.created_at >= ?
ORDER BY j.created_at ASC, j.id ASC`;

function clearIndex(db: SubstrateDatabase): void {
  db.exec("DELETE FROM docs");
  db.exec("DELETE FROM meta");
  db.exec("DELETE FROM index_state");
}

function upsertDocument(db: SubstrateDatabase, doc: RecallDocument): void {
  const existing = db
    .prepare("SELECT doc_id FROM meta WHERE source = ? AND ref = ? AND seq = ?")
    .get(doc.source, doc.ref, doc.seq);
  const values = [
    doc.source,
    doc.projectId,
    doc.projectName,
    doc.projectPrefix,
    doc.ref,
    doc.seq,
    doc.kind,
    doc.participant,
    doc.ts,
    doc.authority,
    doc.scrubVersion,
  ] as const;
  let docId: number;
  if (existing) {
    docId = Number(existing["doc_id"]);
    db.prepare("DELETE FROM docs WHERE rowid = ?").run(docId);
    db.prepare(
      `UPDATE meta SET source = ?, project_id = ?, project_name = ?, project_prefix = ?, ref = ?, seq = ?,
       kind = ?, participant = ?, ts = ?, authority = ?, scrub_version = ? WHERE doc_id = ?`,
    ).run(...values, docId);
  } else {
    const inserted = db.prepare(
      `INSERT INTO meta (source, project_id, project_name, project_prefix, ref, seq, kind, participant, ts, authority, scrub_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values);
    docId = Number(inserted.lastInsertRowid);
  }
  db.prepare("INSERT INTO docs (rowid, body, title, head) VALUES (?, ?, ?, ?)").run(docId, doc.body, doc.title, doc.head);
}

function writeState(db: SubstrateDatabase, builtAt: number, watermark: number, docCount: number): void {
  db.prepare(
    `INSERT INTO index_state (id, schema_version, scrub_version, built_at, watermark_ts, doc_count)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, scrub_version = excluded.scrub_version,
       built_at = excluded.built_at, watermark_ts = excluded.watermark_ts, doc_count = excluded.doc_count`,
  ).run(RECALL_SCHEMA_VERSION, SCRUB_VERSION, builtAt, watermark, docCount);
}

function countDocs(db: SubstrateDatabase): number {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM meta").get()?.["n"] ?? 0);
}

/**
 * Build or advance the index. Returns `deferred` when the host is too loaded
 * and `skipped` when another writer holds the lock; both exit successfully so
 * the timer simply tries again on its next cycle.
 */
export function buildRecallIndex(options: RecallBuildOptions): RecallBuildResult {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const indexPath = options.indexPath ?? defaultRecallIndexPath();
  const gate = options.loadGate ?? defaultLoadGate();
  const empty: Omit<RecallBuildResult, "status" | "reason"> = {
    docsIndexed: 0,
    docsTotal: 0,
    watermark: 0,
    builtAt: now,
    durationMs: 0,
    indexBytes: 0,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
  };

  if (gate > 0 && loadavg()[0]! > gate) {
    return { ...empty, status: "deferred", reason: `load gate: load1 ${loadavg()[0]!.toFixed(2)} > ${gate.toFixed(2)}` };
  }

  mkdirSync(dirname(indexPath), { recursive: true, mode: 0o700 });
  const lockPath = `${indexPath}.lock`;
  const lock = acquireLock(lockPath, now);
  if (lock === null) {
    const holder = readLockPid(lockPath);
    return { ...empty, status: "skipped", reason: `locked${holder === null ? "" : ` by pid ${holder}`}` };
  }

  let rebuild = options.rebuild === true;
  let targetPath = rebuild ? `${indexPath}.tmp-${process.pid}` : indexPath;
  let index: SubstrateDatabase | null = null;
  let source: SubstrateDatabase | null = null;
  try {
    if (rebuild) rmSync(targetPath, { force: true });
    index = openBareSqlite(targetPath);
    index.exec("PRAGMA synchronous = NORMAL");
    ensureIndexSchema(index);
    let previous = readIndexState(index);
    if (!rebuild && !isCompatibleState(previous)) {
      // A schema or scrub change must not keep old text in freelist pages:
      // rebuild into a fresh file and rename it over the old one.
      index.close();
      index = null;
      rebuild = true;
      targetPath = `${indexPath}.tmp-${process.pid}`;
      rmSync(targetPath, { force: true });
      index = openBareSqlite(targetPath);
      index.exec("PRAGMA synchronous = NORMAL");
      ensureIndexSchema(index);
      previous = readIndexState(index);
    }
    const reset = rebuild || !isCompatibleState(previous);
    if (reset) clearIndex(index);
    let watermark = reset ? 0 : (previous?.watermark_ts ?? 0);

    source = openReadOnlySqlite(options.storePath);
    let docsIndexed = 0;
    let processed = 0;
    const statement = source.prepare(SOURCE_SQL);
    index.exec("BEGIN");
    for (const raw of statement.iterate(watermark)) {
      const row = raw as unknown as JournalSourceRow;
      const doc = journalDocument(row);
      if (doc !== null) {
        upsertDocument(index, doc);
        docsIndexed += 1;
      }
      watermark = Math.max(watermark, Number(row.created_at));
      processed += 1;
      if (processed % COMMIT_EVERY === 0) {
        index.exec("COMMIT");
        index.exec("BEGIN");
      }
    }
    index.exec("COMMIT");
    if (docsIndexed > 0) {
      index.exec("BEGIN");
      index.exec("INSERT INTO docs(docs) VALUES('optimize')");
      index.exec("COMMIT");
    }
    const docCount = countDocs(index);
    index.exec("BEGIN");
    writeState(index, now, watermark, docCount);
    index.exec("COMMIT");
    source.close();
    source = null;
    index.close();
    index = null;
    if (rebuild) renameSync(targetPath, indexPath);
    chmodSync(indexPath, 0o600);
    return {
      status: "built",
      reason: null,
      docsIndexed,
      docsTotal: docCount,
      watermark,
      builtAt: now,
      durationMs: Date.now() - startedAt,
      indexBytes: existsSync(indexPath) ? statSync(indexPath).size : 0,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    };
  } finally {
    try {
      source?.close();
    } catch {
      /* source close must not mask the build result */
    }
    try {
      index?.close();
    } catch {
      /* index close must not mask the build result */
    }
    if (rebuild) rmSync(targetPath, { force: true });
    lock.release();
  }
}
