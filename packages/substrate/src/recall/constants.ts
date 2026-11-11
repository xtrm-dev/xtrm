// Fixed ranking and storage parameters for Substrate recall (CORE-2595, R1).
//
// These values are measured, not tuned per query: the eval harness refuses a
// held-out run when the current weights differ from the weights recorded in
// the replay set, so a weight change is always visible as a new fixed revision.

import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";

export const RECALL_SCHEMA_VERSION = "recall/1";
export const INDEX_FILE_NAME = "index.sqlite";
export const INDEX_ENV = "SUBSTRATE_RECALL_INDEX";

/** FTS5 bm25 column weights, in DDL column order: body, title, head. */
export const FTS_BODY_WEIGHT = 1.5;
export const FTS_TITLE_WEIGHT = 2.0;
export const FTS_HEAD_WEIGHT = 0.5;

/** Multiplier = 1 + AUTHORITY_WEIGHT * authority (authority 0..4). */
export const AUTHORITY_WEIGHT = 0.15;
/** Multiplier = 1 + RECENCY_WEIGHT * exp(-ageDays / RECENCY_HALF_LIFE_DAYS). */
export const RECENCY_WEIGHT = 0.8;
export const RECENCY_HALF_LIFE_DAYS = 30;
/** Exact project match (SUBSTRATE_PROJECT) ranks higher. */
export const PROJECT_BOOST = 1.25;

export const DEFAULT_LIMIT = 3;
export const MAX_LIMIT = 5;
/** Internal candidate pool before the fixed rerank. */
export const CANDIDATE_LIMIT = 50;

export const SNIPPET_MAX_CHARS = 240;
export const HEAD_MAX_CHARS = 240;
export const BODY_MAX_CHARS = 4096;

/** The timer runs every five minutes; three missed cycles mean stale. */
export const STALE_AFTER_MS = 15 * 60 * 1000;
export const LOCK_STALE_MS = 10 * 60 * 1000;

export const MIN_LOAD_GATE = 4;
export const LOAD_GATE_PER_CPU = 2;

export function defaultRecallIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[INDEX_ENV]?.trim();
  if (override) return override;
  return join(homedir(), ".xtrm", "recall", INDEX_FILE_NAME);
}

export function defaultLoadGate(totalCpus = cpus().length): number {
  return Math.max(MIN_LOAD_GATE, totalCpus * LOAD_GATE_PER_CPU);
}

/**
 * The exact values the eval harness fixes before a measurement. Changing any
 * of them changes the hash, and a held-out run then refuses to start.
 */
export function rankingWeights(): Record<string, number> {
  return {
    ftsBody: FTS_BODY_WEIGHT,
    ftsTitle: FTS_TITLE_WEIGHT,
    ftsHead: FTS_HEAD_WEIGHT,
    authority: AUTHORITY_WEIGHT,
    recency: RECENCY_WEIGHT,
    recencyHalfLifeDays: RECENCY_HALF_LIFE_DAYS,
    projectBoost: PROJECT_BOOST,
  };
}

export function weightsHash(weights: Record<string, number> = rankingWeights()): string {
  const canonical = Object.keys(weights)
    .sort()
    .map((key) => `${key}=${weights[key]}`)
    .join(";");
  return createHash("sha256").update(canonical).digest("hex");
}
