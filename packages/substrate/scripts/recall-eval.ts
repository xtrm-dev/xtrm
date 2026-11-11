#!/usr/bin/env node
// Replay harness for the Substrate recall index (CORE-2595, R1).
//
// Usage:
//   node scripts/recall-eval.ts --index <path> [--set <replay.json>]
//        [--split tuning|heldout|all] [--json] [--allow-weight-change]
//   node scripts/recall-eval.ts --verify-weights [--set <replay.json>]
//
// The harness never writes the replay set and never tunes weights. A
// held-out run refuses to start when the code weights differ from the
// weights frozen in the set, because measuring after a tuning change would
// make the held-out half a tuning half.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { evaluateReplay, filterBySplit } from "../src/recall/eval.ts";
import type { EvalMetrics, ReplaySet } from "../src/recall/types.ts";

interface Args {
  index: string | null;
  set: string;
  split: "tuning" | "heldout" | "all";
  json: boolean;
  allowWeightChange: boolean;
  verifyWeights: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    index: null,
    set: join(homedir(), ".cache", "recall-design", "replay-set.json"),
    split: "all",
    json: false,
    allowWeightChange: false,
    verifyWeights: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--index":
        if (!next) throw new Error("--index requires a path");
        args.index = next;
        i += 1;
        break;
      case "--set":
        if (!next) throw new Error("--set requires a path");
        args.set = next;
        i += 1;
        break;
      case "--split": {
        if (next !== "tuning" && next !== "heldout" && next !== "all") throw new Error("--split must be tuning, heldout or all");
        args.split = next;
        i += 1;
        break;
      }
      case "--json":
        args.json = true;
        break;
      case "--allow-weight-change":
        args.allowWeightChange = true;
        break;
      case "--verify-weights":
        args.verifyWeights = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printMetrics(label: string, m: EvalMetrics): void {
  const interval = (ci: { low: number; high: number }): string => `[${percent(ci.low)}, ${percent(ci.high)}]`;
  console.log(
    `${label.padEnd(10)} n=${String(m.cases).padStart(3)}  hit@1 ${percent(m.hitAt1)}  hit@5 ${percent(m.hitAt5)} ${interval(m.hitAt5Interval)}  hit@10 ${percent(m.hitAt10)} ${interval(m.hitAt10Interval)}  MRR ${m.mrr.toFixed(3)}  misses ${m.misses}`,
  );
}

const args = parseArgs(process.argv.slice(2));
const set = JSON.parse(readFileSync(args.set, "utf8")) as ReplaySet;

if (args.verifyWeights) {
  const report = evaluateReplay(set, {
    indexPath: "/nonexistent-index-for-weights-only",
    split: "tuning",
    allowWeightChange: args.allowWeightChange,
  });
  if (args.json) console.log(JSON.stringify({ ok: true, weightsHash: report.weightsHash }));
  else console.log(`weights ok: ${report.weightsHash}`);
  process.exit(0);
}

if (args.index === null) throw new Error("--index is required (the built recall index to measure)");

const report = evaluateReplay(set, {
  indexPath: args.index,
  split: args.split,
  allowWeightChange: args.allowWeightChange,
});

// A tuning run must not reveal held-out metrics: the held-out half may only be
// measured once, after the weights are frozen.
const tuningOnly = args.split === "tuning";
if (args.json) {
  const payload = tuningOnly
    ? { weightsHash: report.weightsHash, split: args.split, results: filterBySplit(report.results, args.split), tuning: report.tuning }
    : { ...report, split: args.split };
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`replay set: ${args.set}`);
  console.log(`weights: ${report.weightsHash}`);
  if (report.weightsOverridden) console.log("WARNING: --allow-weight-change overrode the frozen set; this run is not a held-out measurement");
  for (const result of filterBySplit(report.results, args.split)) {
    console.log(`  ${String(result.rank ?? "miss").padStart(4)}  ${result.split.padEnd(7)}  #${result.id}  ${result.name}`);
  }
  if (args.split === undefined) printMetrics("overall", report.overall);
  if (!tuningOnly) printMetrics("heldout", report.heldout);
  printMetrics("tuning", report.tuning);
  if (!tuningOnly) {
    console.log(
      `held-out gate (hit@5 >= 0.85, hit@10 >= 0.95): ${report.heldoutMeetsThreshold ? "PASS" : "FAIL"}`,
    );
  }
}
process.exitCode = !tuningOnly && !report.heldoutMeetsThreshold ? 1 : 0;
