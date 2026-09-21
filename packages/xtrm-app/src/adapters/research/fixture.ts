import type { ChartDataRow, Metric, ResearchAdapter } from "./types.ts";
import { mapChartDataRow, mapLineage, mapMetric, mapRunRow, mapRunShow, mapRunSummary, mapSample, mapTail, type WireChartDataRow, type WireCompare, type WireExperimentRef, type WireLineageTree, type WireMetric, type WireRunRow, type WireRunShow, type WireSample, type WireTail } from "./live.ts";

// Captured from a real `xtrm-research --json` run (see scripts/generate-research-fixtures.py);
// content is illustrative but every shape is genuine CLI output, never hand-authored.
import fixture from "./__fixtures__/xtrm-research-fixture.json";

const RUN_SHOW: Record<string, WireRunShow> = { "run-a": fixture.runShowA, "run-b": fixture.runShowB };
const EXPERIMENTS: Record<string, Record<string, unknown>> = { "dup-detect-baseline": fixture.experimentShow, "zero-run-baseline": fixture.experimentShowZeroRun };
const WORKLOADS: Record<string, Record<string, unknown>> = { "dup-detect": fixture.workloadShow };
const QUESTION_SPECS: Record<string, Record<string, unknown>> = fixture.questionSpecShow
  ? { "dup-check": fixture.questionSpecShow }
  : {};
// Per-run metric summaries, as captured from `compare`; the chart resolution below reads these
// so a chart dataset is resolved against namespaced metrics exactly as the CLI does.
const METRICS: WireCompare = fixture.compareAB;
const SAMPLES: Record<string, WireSample[]> = { "run-a": fixture.samplesA as WireSample[] };

function get<T>(map: Record<string, T>, key: string, what: string): T {
  const value = map[key];
  if (!value) throw new Error(`unknown ${what}: ${key}`);
  return value;
}

/** Mirrors `views._chart_metric` (packages/research): exact metric key first, then exactly one
 * `::<dataset>` suffix match; more than one is ambiguous and fails closed. A fixture that
 * hardcoded the dataset id would mock away the evaluator namespacing the live CLI performs. */
export function resolveChartMetric(metrics: Record<string, WireMetric>, dataset: string): Metric | null {
  const exact = metrics[dataset];
  if (exact) return mapMetric(exact);
  const suffix = `::${dataset}`;
  const matches = Object.entries(metrics).filter(([key]) => key.endsWith(suffix));
  if (matches.length > 1) throw new Error(`chart dataset '${dataset}' is ambiguous across metrics: ${matches.map(([k]) => k).join(", ")}`);
  const only = matches[0]?.[1];
  return only ? mapMetric(only) : null;
}

export const fixtureResearch: ResearchAdapter = {
  source: "fixture",
  async listRuns() {
    return (fixture.runs as WireRunRow[]).map(mapRunRow);
  },
  async listExperiments() {
    return fixture.experiments as WireExperimentRef[];
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
  async getSamples(runId) {
    return get(SAMPLES, runId, "run").map(mapSample);
  },
  async getChartData(runIds, metric) {
    for (const runId of runIds) get(RUN_SHOW, runId, "run");
    const rows: ChartDataRow[] = runIds.map((runId) => {
      const resolved = resolveChartMetric(METRICS[runId]?.metrics ?? {}, metric);
      return resolved ? { runId, state: "metric", ...resolved } : { runId, state: "no_metric", reason: `run '${runId}' has no metric '${metric}'` };
    });
    return rows;
  },
  async compare(runIds) {
    const wire = fixture.compareAB as WireCompare;
    const out: Record<string, ReturnType<typeof mapRunSummary>> = {};
    for (const runId of runIds) out[runId] = mapRunSummary(get(wire, runId, "run"));
    return out;
  },
};

// Re-exported so the fixture test can cross-check the resolved rows against the captured
// `chart-data` envelope rather than trusting the resolver alone.
export const capturedChartRows = (fixture.chartAccuracyAB as WireChartDataRow[]).map(mapChartDataRow);
