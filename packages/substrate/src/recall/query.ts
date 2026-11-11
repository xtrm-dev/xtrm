// Read-only recall query: FTS5 bm25 over scrubbed journal text, then the fixed
// authority/recency/project rerank (CORE-2595). One open per call; nothing is
// cached and no daemon exists. Every failure is fail-open: no hits, exit 0.

import type { SubstrateDatabase } from "../store/database.ts";
import { openReadOnlySqlite } from "../store/sqlite.ts";
import {
  AUTHORITY_WEIGHT,
  CANDIDATE_LIMIT,
  DEFAULT_LIMIT,
  FTS_BODY_WEIGHT,
  FTS_HEAD_WEIGHT,
  FTS_TITLE_WEIGHT,
  PROJECT_BOOST,
  RECENCY_HALF_LIFE_DAYS,
  RECENCY_WEIGHT,
  SNIPPET_MAX_CHARS,
  defaultRecallIndexPath,
} from "./constants.ts";
import { readIndexStatus } from "./schema.ts";
import { scrubText } from "./scrub.ts";
import type { RecallHit, RecallIndexStatus, RecallQueryOptions, RecallResult } from "./types.ts";

const STOP_WORDS = new Set(
  "a an and are as at be by can did do does for from how in is it of on or that the this to was we what when where which who why with without not no".split(
    " ",
  ),
);

const SEARCH_SQL = `
SELECT m.doc_id, m.source, m.ref, m.seq, m.project_id, m.project_name, m.project_prefix,
       m.kind, m.participant, m.ts, m.authority, m.superseded_by,
       bm25(docs, ${FTS_BODY_WEIGHT}, ${FTS_TITLE_WEIGHT}, ${FTS_HEAD_WEIGHT}) AS score,
       snippet(docs, 0, '', '', ' … ', 32) AS snip
FROM docs
JOIN meta m ON m.doc_id = docs.rowid
WHERE docs MATCH ?`;

interface Candidate {
  doc_id: number;
  source: string;
  ref: string;
  seq: number | null;
  project_id: string;
  project_name: string;
  project_prefix: string;
  kind: string;
  participant: string | null;
  ts: number;
  authority: number;
  superseded_by: number | null;
  score: number;
  snip: string;
}

export function queryTokens(terms: string): string[] {
  const raw = terms.match(/[A-Za-z0-9][A-Za-z0-9_.\-/:]*/g) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const value of raw) {
    const token = value.replace(/[./:]+$/, "");
    const key = token.toLowerCase();
    if (token.length < 2 || STOP_WORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function ftsExpression(tokens: string[]): string {
  return tokens.map((token) => `"${token.replace(/"/g, "")}"`).join(" OR ");
}


/**
 * `--since`: epoch milliseconds, `YYYY-MM-DD` (UTC), a full ISO timestamp, or
 * a relative window such as 7d / 24h. Returns an inclusive lower bound in ms.
 */
export function parseSince(raw: string, now = Date.now()): number {
  const value = raw.trim();
  if (value === "") throw new Error("--since requires a date (YYYY-MM-DD), epoch ms, or a window such as 7d");
  if (/^\d+$/.test(value)) return Number(value);
  const relative = /^(\d+)([dhm])$/.exec(value);
  if (relative) {
    const unit = relative[2] === "d" ? 86_400_000 : relative[2] === "h" ? 3_600_000 : 60_000;
    return now - Number(relative[1]) * unit;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`invalid --since value: ${raw} (want YYYY-MM-DD, ISO timestamp, epoch ms, or 7d/24h/30m)`);
}

export function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function clampSnippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= SNIPPET_MAX_CHARS) return clean;
  return `${chars.slice(0, SNIPPET_MAX_CHARS - 1).join("")}…`;
}

function rankValue(candidate: Candidate, now: number, projectId: string | null): number {
  const ageDays = Math.max(0, (now - candidate.ts) / 86_400_000);
  const recency = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
  const authority = 1 + AUTHORITY_WEIGHT * candidate.authority;
  const freshness = 1 + RECENCY_WEIGHT * recency;
  const project = projectId !== null && candidate.project_id === projectId ? PROJECT_BOOST : 1;
  return -candidate.score * authority * freshness * project;
}

function compareCandidates(a: Candidate, b: Candidate, now: number, projectId: string | null): number {
  const delta = rankValue(b, now, projectId) - rankValue(a, now, projectId);
  if (delta !== 0) return delta;
  if (b.ts !== a.ts) return b.ts - a.ts;
  if (b.authority !== a.authority) return b.authority - a.authority;
  if (a.score !== b.score) return a.score - b.score;
  return a.doc_id - b.doc_id;
}

function toHit(candidate: Candidate): RecallHit {
  const fallback = `${candidate.ref}${candidate.seq === null ? "" : `#${candidate.seq}`} ${candidate.kind}`;
  return {
    source: candidate.source,
    ref: candidate.ref,
    seq: candidate.seq,
    project: candidate.project_name || null,
    projectPrefix: candidate.project_prefix || null,
    kind: candidate.kind,
    participant: candidate.participant,
    ts: candidate.ts,
    date: formatDate(candidate.ts),
    authority: candidate.authority,
    superseded: candidate.superseded_by !== null,
    snippet: clampSnippet(candidate.snip || fallback),
  };
}

function safeNote(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `recall index unavailable: ${scrubText(message).text.slice(0, 160)}`;
}

function emptyResult(query: string, index: RecallIndexStatus, note: string): RecallResult {
  return { query, hits: [], index, note };
}

function search(db: SubstrateDatabase, match: string, source: string | undefined, since: number | undefined): Candidate[] {
  const where: string[] = [];
  const params: Array<string | number> = [match];
  if (source !== undefined) {
    where.push("m.source = ?");
    params.push(source);
  }
  if (since !== undefined) {
    where.push("m.ts >= ?");
    params.push(since);
  }
  const sql = `${SEARCH_SQL}${where.length > 0 ? ` AND ${where.join(" AND ")}` : ""} ORDER BY score LIMIT ${CANDIDATE_LIMIT}`;
  return db.prepare(sql).all(...params) as unknown as Candidate[];
}

/**
 * Query the local index. Never throws: a missing, corrupt, incompatible or
 * locked index returns zero hits with a note and the caller exits 0.
 */
export function recall(options: RecallQueryOptions): RecallResult {
  const now = options.now ?? Date.now();
  const indexPath = options.indexPath ?? defaultRecallIndexPath(options.env);
  // The CLI caps at MAX_LIMIT; the eval harness may ask for the whole
  // candidate pool so it can rank a held-out case at any depth.
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, CANDIDATE_LIMIT));
  const status = readIndexStatus(indexPath, now);
  if (!status.exists) {
    return emptyResult(options.terms, status, "recall index not built yet; run `sb recall-build` once or enable the timer");
  }
  if (!status.compatible) {
    return emptyResult(options.terms, status, "recall index needs a rebuild (schema or scrub rules changed); run `sb recall-build --rebuild`");
  }
  const tokens = queryTokens(options.terms);
  if (tokens.length === 0) return emptyResult(options.terms, status, "no searchable terms in the query");

  let db: SubstrateDatabase | null = null;
  try {
    db = openReadOnlySqlite(indexPath);
    const projectId = options.projectId !== undefined ? options.projectId : (options.env?.["SUBSTRATE_PROJECT"]?.trim() || null);
    const candidates = search(db, ftsExpression(tokens), options.source, options.since);
    candidates.sort((a, b) => compareCandidates(a, b, now, projectId));
    return {
      query: options.terms,
      hits: candidates.slice(0, limit).map(toHit),
      index: status,
      note: null,
    };
  } catch (error) {
    return emptyResult(options.terms, status, safeNote(error));
  } finally {
    try {
      db?.close();
    } catch {
      /* fail-open: a close failure never changes the answer */
    }
  }
}
