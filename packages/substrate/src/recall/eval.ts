// Replay evaluation harness for Substrate recall (CORE-2595, R1).
//
// The weights are fixed before a measurement. The replay set records the
// weights it was frozen with; a held-out run refuses to start when the code
// no longer matches, so a tuning change cannot be hidden inside a result.

import { CANDIDATE_LIMIT, rankingWeights, weightsHash } from "./constants.ts";
import { recall } from "./query.ts";
import type {
  EvalCaseResult,
  ConfidenceInterval,
  EvalMetrics,
  EvalReport,
  ReplayCase,
  ReplayExpected,
  ReplaySet,
} from "./types.ts";

export interface EvaluateOptions {
  indexPath: string;
  split?: "tuning" | "heldout" | "all";
  now?: number;
  /** Explicit override, recorded by the caller; never silent. */
  allowWeightChange?: boolean;
}

export const HELDOUT_HIT5_MIN = 0.85;
export const HELDOUT_HIT10_MIN = 0.95;

function splitOf(value: ReplayCase, index: number): "tuning" | "heldout" {
  if (value.split === "tuning" || value.split === "heldout") return value.split;
  return index % 2 === 0 ? "tuning" : "heldout";
}

function sameWeights(declared: Record<string, number>, current: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(declared), ...Object.keys(current)]);
  for (const key of keys) if (declared[key] !== current[key]) return false;
  return true;
}

export function verifyFrozenWeights(set: ReplaySet, allowWeightChange = false): string {
  const current = rankingWeights();
  const currentHash = weightsHash(current);
  if (set.weights === undefined || set.weightsHash === undefined) {
    throw new Error("replay set carries no fixed weights; freeze weights before measuring (see weights/weightsHash)");
  }
  if (!sameWeights(set.weights, current) || set.weightsHash !== currentHash) {
    if (!allowWeightChange) {
      throw new Error(
        `ranking weights changed since the replay set was fixed (set ${set.weightsHash}, code ${currentHash}); ` +
          "re-freeze on the tuning split before measuring the held-out half",
      );
    }
  }
  return currentHash;
}

function rankOf(expected: ReplayExpected[], hits: Array<{ ref: string; seq: number | null }>): number | null {
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i]!;
    if (expected.some((want) => want.ref === hit.ref && (want.seq === undefined || want.seq === null || want.seq === hit.seq))) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Wilson score interval for a binomial proportion (95%, z = 1.96). Used for
 * the pre-registered hit-rate gate: 17/20 and 19/20 are the pass thresholds.
 */
export function wilson95(successes: number, n: number): ConfidenceInterval {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function metricsFor(results: EvalCaseResult[]): EvalMetrics {
  const n = results.length;
  if (n === 0) {
    return {
      cases: 0,
      hitAt1: 0,
      hitAt5: 0,
      hitAt10: 0,
      mrr: 0,
      misses: 0,
      hitAt5Interval: { low: 0, high: 0 },
      hitAt10Interval: { low: 0, high: 0 },
    };
  }
  const within = (k: number): number => results.filter((r) => r.rank !== null && r.rank <= k).length / n;
  const mrr = results.reduce((sum, r) => sum + (r.rank === null ? 0 : 1 / r.rank), 0) / n;
  return {
    cases: n,
    hitAt1: within(1),
    hitAt5: within(5),
    hitAt10: within(10),
    mrr,
    misses: results.filter((r) => r.rank === null).length,
    hitAt5Interval: wilson95(results.filter((r) => r.rank !== null && r.rank <= 5).length, n),
    hitAt10Interval: wilson95(results.filter((r) => r.rank !== null && r.rank <= 10).length, n),
  };
}

export function evaluateReplay(set: ReplaySet, options: EvaluateOptions): EvalReport {
  const currentHash = verifyFrozenWeights(set, options.allowWeightChange === true);
  const results: EvalCaseResult[] = [];
  // R1 measures journal cases only. Later phases append their own source and
  // the same harness measures them when that source is indexed.
  const journalCases = set.cases.filter((testCase) => (testCase.source ?? "substrate-journal") === "substrate-journal");
  for (let index = 0; index < journalCases.length; index += 1) {
    const testCase = journalCases[index]!;
    const split = splitOf(testCase, index);
    const outcome = recall({
      terms: testCase.query,
      indexPath: options.indexPath,
      limit: CANDIDATE_LIMIT,
      now: options.now,
    });
    results.push({
      id: testCase.id,
      name: testCase.name,
      split,
      rank: rankOf(testCase.expected, outcome.hits),
      expected: testCase.expected,
    });
  }
  const tuning = results.filter((r) => r.split === "tuning");
  const heldout = results.filter((r) => r.split === "heldout");
  const heldoutMetrics = metricsFor(heldout);
  return {
    overall: metricsFor(results),
    tuning: metricsFor(tuning),
    heldout: heldoutMetrics,
    results,
    heldoutMeetsThreshold:
      heldoutMetrics.cases > 0 && heldoutMetrics.hitAt5 >= HELDOUT_HIT5_MIN && heldoutMetrics.hitAt10 >= HELDOUT_HIT10_MIN,
    weightsHash: currentHash,
  };
}

export function filterBySplit(results: EvalCaseResult[], split: "tuning" | "heldout" | "all"): EvalCaseResult[] {
  return split === "all" ? results : results.filter((r) => r.split === split);
}
