// Shared helpers for the CORE-2603 R1b run: index access, the pre-registered
// answer rule, copy sets, document frequency and the seeded order.
//
// Nothing here ranks or filters on a measurement result: every rule below is
// fixed before the sampler runs and recorded in the freeze Journal entry.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { BODY_MAX_CHARS } from "../src/recall/constants.ts";
import { queryTokens } from "../src/recall/query.ts";

export const WORK_DIR = join(homedir(), ".cache", "recall-design", "r1b");
export const DEFAULT_INDEX = join(WORK_DIR, "index.sqlite");
export const USED_SET_DIR = join(homedir(), ".cache", "recall-design");

/** Contract SCOPE: refs the case set must never draw from. */
export const EXCLUDED_REFS = ["CORE-2581", "CORE-2595", "CORE-2602", "CORE-2603"];
/** Contract SCOPE: kinds that are not case material. */
export const EXCLUDED_KINDS = ["checkpoint", "compaction"];
/** Contract SCOPE: at most this many cases per issue ref. */
export const MAX_PER_REF = 3;
/** Contract SCOPE: no project contributes more than this share of the cases. */
export const MAX_PROJECT_SHARE = 0.5;
/** Contract SUCCESS: exactly this many accepted cases are measured. */
export const CASE_COUNT = 40;
/** Contract SUCCESS: the frozen pass bars. */
export const PASS_HIT5 = 34;
export const PASS_HIT10 = 38;
/** Contract SCOPE: the age window, in days, at the freeze. */
export const MIN_AGE_DAYS = 7;
export const MAX_AGE_DAYS = 120;
/** Contract SCOPE: scrubbed normalised text length required of a target. */
export const MIN_TARGET_CHARS = 200;
/** Contract SCOPE: more copies than this and the target is templated. */
export const MAX_COPIES = 3;
/** Contract SCOPE: the Jev acceptance threshold on each probability. */
export const ACCEPT_P = 0.8;
/** Contract SCOPE: a question token must not be rarer than this in the index. */
export const MIN_TOKEN_DF = 3;

export const DAY_MS = 86_400_000;

export interface IndexDoc {
  docId: number;
  ref: string;
  seq: number;
  projectId: string;
  projectName: string;
  projectPrefix: string;
  kind: string;
  ts: number;
  title: string;
  body: string;
}

export function openIndex(path: string = DEFAULT_INDEX): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

const DOC_SQL = `
SELECT m.doc_id, m.ref, m.seq, m.project_id, m.project_name, m.project_prefix, m.kind, m.ts,
       d.title, d.body
FROM meta m JOIN docs d ON d.rowid = m.doc_id`;

export function loadDocs(db: DatabaseSync): IndexDoc[] {
  const rows = db.prepare(`${DOC_SQL} ORDER BY m.doc_id`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    docId: Number(row["doc_id"]),
    ref: String(row["ref"]),
    seq: Number(row["seq"]),
    projectId: String(row["project_id"]),
    projectName: String(row["project_name"]),
    projectPrefix: String(row["project_prefix"]),
    kind: String(row["kind"]),
    ts: Number(row["ts"]),
    title: String(row["title"]),
    body: String(row["body"]),
  }));
}

/**
 * The pre-registered answer rule's normalisation: scrubbed (the index stores
 * only scrubbed text), lowercased, whitespace collapsed, cut at the index body
 * maximum. The stored body is already scrubbed, collapsed and capped, so this
 * is the remaining lowercase+collapse pass, applied identically to targets and
 * to every candidate row.
 */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, BODY_MAX_CHARS);
}

export function docKey(ref: string, seq: number | null): string {
  return seq === null || seq < 0 ? ref : `${ref}#${seq}`;
}

/** sha256(seed + "\n" + identity) decides every order in this run. */
export function seededKey(seed: string, ref: string, seq: number): string {
  return createHash("sha256").update(`${seed}\n${docKey(ref, seq)}`).digest("hex");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Contract SCOPE: a hit is the target row, or any row whose normalised text
 * contains the target's FULL normalised text. The target itself is not a copy.
 */
export function copiesOf(docs: readonly IndexDoc[], target: IndexDoc): IndexDoc[] {
  const needle = normalise(target.body);
  if (needle.length === 0) return [];
  const copies: IndexDoc[] = [];
  for (const doc of docs) {
    if (doc.docId === target.docId) continue;
    if (normalise(doc.body).includes(needle)) copies.push(doc);
  }
  return copies;
}

/** Document frequency of one already-search-shaped token, from the FTS index. */
export function documentFrequency(db: DatabaseSync, token: string): number {
  const statement = db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ?");
  const quoted = `"${token.replace(/"/g, "")}"`;
  try {
    return Number((statement.get(quoted) as Record<string, unknown>)["n"] ?? 0);
  } catch {
    return 0;
  }
}

export interface TokenDf {
  token: string;
  df: number;
}

export function questionTokenDf(db: DatabaseSync, question: string): TokenDf[] {
  return queryTokens(question).map((token) => ({ token, df: documentFrequency(db, token) }));
}

/** The 60 used cases: every ref#seq the R1 replay set, the confirmation set and the diagnostic touched. */
export function usedCaseKeys(): Set<string> {
  const keys = new Set<string>();
  const add = (ref: unknown, seq: unknown): void => {
    if (typeof ref === "string" && ref !== "") keys.add(docKey(ref, typeof seq === "number" ? seq : null));
  };
  const readJson = (name: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(USED_SET_DIR, name), "utf8")) as unknown;
    } catch {
      return null;
    }
  };
  for (const name of ["replay-set.json", "confirmation-set.json"]) {
    const set = readJson(name) as Record<string, unknown> | null;
    for (const raw of (set?.["cases"] as Array<Record<string, unknown>> | undefined) ?? []) {
      for (const want of (raw["expected"] as Array<Record<string, unknown>> | undefined) ?? []) add(want["ref"], want["seq"]);
    }
  }
  const diagnostic = readJson("diagnostic-top10.json");
  const rows = (Array.isArray(diagnostic)
    ? diagnostic
    : ((diagnostic as Record<string, unknown> | null)?.["rows"] ?? (diagnostic as Record<string, unknown> | null)?.["cases"] ?? [])) as Array<
    Record<string, unknown>
  >;
  for (const row of rows) {
    const target = (row["expected"] ?? row["target"] ?? null) as Record<string, unknown> | null;
    if (target) add(target["ref"], target["seq"]);
  }
  return keys;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
