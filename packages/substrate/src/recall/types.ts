// Types for the Substrate recall index (CORE-2595, R1: journal source only).

export interface RecallIndexStatus {
  path: string;
  exists: boolean;
  /** Last successful index run (ms) and its age. */
  builtAt: number | null;
  ageMs: number | null;
  /** Newest source created_at covered by the index (ms) and its age. */
  watermark: number | null;
  watermarkAgeMs: number | null;
  stale: boolean;
  docCount: number | null;
  scrubVersion: string | null;
  /** False when the stored schema or scrub revision cannot answer safely. */
  compatible: boolean;
}

export type RecallSource = "substrate-journal";

export interface RecallHit {
  source: string;
  ref: string;
  seq: number | null;
  project: string | null;
  projectPrefix: string | null;
  kind: string;
  participant: string | null;
  ts: number;
  date: string;
  authority: number;
  superseded: boolean;
  snippet: string;
}

export interface RecallResult {
  query: string;
  hits: RecallHit[];
  index: RecallIndexStatus;
  /** Fail-open explanation; null when the query ran against a usable index. */
  note: string | null;
}

export interface RecallQueryOptions {
  terms: string;
  source?: string;
  /** Inclusive lower bound on the document timestamp (ms). */
  since?: number;
  /** 1..MAX_LIMIT in the CLI; the eval harness may ask for more. */
  limit?: number;
  indexPath?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  /** Effective current project id (SUBSTRATE_PROJECT), used for the boost. */
  projectId?: string | null;
}

export interface RecallBuildOptions {
  storePath: string;
  indexPath?: string;
  rebuild?: boolean;
  /** Absolute load1 ceiling; 0 disables the gate. */
  loadGate?: number;
  now?: number;
  /** Test seam: report the build that would run without writing. */
  dryRun?: boolean;
}

export interface RecallBuildResult {
  status: "built" | "deferred" | "skipped";
  reason: string | null;
  docsIndexed: number;
  docsTotal: number;
  watermark: number;
  builtAt: number;
  durationMs: number;
  indexBytes: number;
  /** Peak RSS of the indexing process (Linux ru_maxrss is KiB). */
  peakRssBytes: number;
}

export interface ReplayExpected {
  ref: string;
  seq?: number | null;
}

export interface ReplayCase {
  id: number | string;
  name: string;
  query: string;
  expected: ReplayExpected[];
  source?: string;
  /** Fixed before measurement; never derived from a score. */
  split?: "tuning" | "heldout";
  ground_truth?: string;
  provenance?: string;
}

export interface ReplaySet {
  version: number;
  created: string;
  note?: string;
  /** The fixed weights this set is measured with, plus their hash. */
  weights?: Record<string, number>;
  weightsHash?: string;
  cases: ReplayCase[];
}

export interface EvalCaseResult {
  id: number | string;
  name: string;
  split: "tuning" | "heldout";
  rank: number | null;
  expected: ReplayExpected[];
}

export interface ConfidenceInterval {
  low: number;
  high: number;
}

export interface EvalMetrics {
  cases: number;
  hitAt1: number;
  hitAt5: number;
  hitAt10: number;
  mrr: number;
  misses: number;
  hitAt5Interval: ConfidenceInterval;
  hitAt10Interval: ConfidenceInterval;
}

export interface EvalReport {
  overall: EvalMetrics;
  tuning: EvalMetrics;
  heldout: EvalMetrics;
  results: EvalCaseResult[];
  heldoutMeetsThreshold: boolean;
  weightsHash: string;
}
