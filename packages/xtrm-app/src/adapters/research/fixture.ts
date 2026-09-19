import type { ResearchAdapter } from "./types.ts";
import { mapChartDataRow, mapLineage, mapRunRow, mapRunShow, mapRunSummary, mapTail, type WireChartDataRow, type WireCompare, type WireLineageTree, type WireRunRow, type WireRunShow, type WireTail } from "./live.ts";

// Captured from a real `xtrm-research --json` run (see scripts/generate-research-fixtures.py);
// content is illustrative but every shape is genuine CLI output, never hand-authored.
import fixture from "./__fixtures__/xtrm-research-fixture.json";

const RUN_SHOW: Record<string, WireRunShow> = { "run-a": fixture.runShowA, "run-b": fixture.runShowB };
const EXPERIMENTS: Record<string, Record<string, unknown>> = { "dup-detect-baseline": fixture.experimentShow };
const WORKLOADS: Record<string, Record<string, unknown>> = { "dup-detect": fixture.workloadShow };
const QUESTION_SPECS: Record<string, Record<string, unknown>> = fixture.questionSpecShow
  ? { "dup-check": fixture.questionSpecShow }
  : {};

function get<T>(map: Record<string, T>, key: string, what: string): T {
  const value = map[key];
  if (!value) throw new Error(`unknown ${what}: ${key}`);
  return value;
}

export const fixtureResearch: ResearchAdapter = {
  source: "fixture",
  async listRuns() {
    return (fixture.runs as WireRunRow[]).map(mapRunRow);
  },
  async getLineage(runId) {
    if (runId !== "run-a") throw new Error(`unknown run: ${runId}`);
    return mapLineage(fixture.runsLineage as WireLineageTree);
  },
  async getRun(runId) {
    return mapRunShow(get(RUN_SHOW, runId, "run"));
  },
  async getExperiment(id) {
    return get(EXPERIMENTS, id, "experiment");
  },
  async getWorkload(id) {
    return get(WORKLOADS, id, "workload");
  },
  async getQuestionSpec(id) {
    return get(QUESTION_SPECS, id, "question spec");
  },
  // The captured tail fixture is a single fixed page; a `TailCursor` argument has nothing to
  // resume from here (unlike liveResearch, which sends it on to the CLI's `--after`).
  async tail(runId) {
    if (runId !== "run-a") throw new Error(`unknown run: ${runId}`);
    return mapTail(fixture.tailA as WireTail);
  },
  async getMetrics(runId) {
    if (runId !== "run-a") throw new Error(`unknown run: ${runId}`);
    return mapRunSummary(fixture.metricsA);
  },
  async getChartData(runIds, metric) {
    if (metric !== "accuracy") throw new Error(`unknown chart dataset: ${metric}`);
    for (const runId of runIds) get(RUN_SHOW, runId, "run");
    const wanted = new Set(runIds);
    return (fixture.chartAccuracyAB as WireChartDataRow[]).filter((row) => wanted.has(row.run_id)).map(mapChartDataRow);
  },
  async compare(runIds) {
    const wire = fixture.compareAB as WireCompare;
    const out: Record<string, ReturnType<typeof mapRunSummary>> = {};
    for (const runId of runIds) out[runId] = mapRunSummary(get(wire, runId, "run"));
    return out;
  },
};
