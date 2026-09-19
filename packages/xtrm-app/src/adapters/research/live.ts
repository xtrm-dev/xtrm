import type { ChartDataRow, LineageChild, LineageNode, Metric, ResearchAdapter, RunListRow, RunShow, RunStatus, RunSummary, TailCursor, TailResult, UsageRecord } from "./types.ts";

// Wire shapes of the `xtrm-research-cli/v1` envelope (packages/research). Only the fields read here.
interface Envelope<T> {
  schema: string;
  command: string;
  ok: boolean;
  data?: T;
  error?: string;
}

const ENVELOPE_SCHEMA = "xtrm-research-cli/v1";

interface WireMetric {
  value: number;
  se: number | null;
  ci95: number[] | null;
  n: number;
  method: string;
}
/**
 * `_runs_row` (main.py) always emits every healthy-row key; an `invalid_manifest`
 * row nulls all of them but adds `error` — a single interface with an optional
 * `error` mirrors that exactly (see xtrm-research-fixture.json `runs`).
 */
export interface WireRunRow {
  id: string;
  experiment: string | null;
  variant: string | null;
  trigger: string | null;
  status: string;
  purpose: string | null;
  latest_conclusion: string | null;
  evidence_status: string | null;
  error?: string;
}
export interface WireLineageChild {
  relation: string;
  run_id: string;
  children: WireLineageChild[];
}
export interface WireLineageTree {
  run_id: string;
  children: WireLineageChild[];
}
export interface WireRunShow {
  manifest: Record<string, unknown>;
  status: string;
  annotations: Array<Record<string, unknown>>;
}
/** `common.schema.json#/$defs/usage_record`, quoted keys because GenAI semconv names carry dots. */
export interface WireUsageRecord {
  source: string;
  "gen_ai.usage.input_tokens": number | null;
  "gen_ai.usage.output_tokens": number | null;
  "gen_ai.request.model": string | null;
  "gen_ai.response.model": string | null;
  latency_ms: number | null;
  null_reason: string | null;
}
export interface WireEvent {
  seq: number;
  ts: string;
  kind: string;
  sample_id?: string | null;
  data?: unknown;
  usage?: WireUsageRecord | null;
}
export interface WireTail {
  events: WireEvent[];
  next_offset: number;
}
export interface WireRunSummary {
  metrics: Record<string, WireMetric>;
  sample_count: number;
  event_count: number;
}
export type WireCompare = Record<string, WireRunSummary>;

export interface WireChartMetricRow extends WireMetric {
  run_id: string;
}

export interface WireChartMissingRow {
  run_id: string;
  state: "no_metric";
  reason: string;
}

export type WireChartDataRow = WireChartMetricRow | WireChartMissingRow;

export class ResearchReadError extends Error {}

/** `command` is the verb the caller actually asked for; a reply for a different verb is a protocol error, not a caller mistake. */
export function unwrap<T>(envelope: Envelope<T>, command: string): T {
  if (envelope.schema !== ENVELOPE_SCHEMA) throw new ResearchReadError(`unexpected envelope schema: ${envelope.schema}`);
  if (envelope.command !== command) throw new ResearchReadError(`unexpected envelope command: expected "${command}", got "${envelope.command}"`);
  // `data: null` is as much a broken contract as a missing `data`: every verb's payload is an
  // object or array, so null can only mean the bridge or CLI failed to produce real data.
  if (!envelope.ok || envelope.data === undefined || envelope.data === null) throw new ResearchReadError(envelope.error ?? `${command} failed`);
  return envelope.data;
}

export function mapRunRow(w: WireRunRow): RunListRow {
  if (w.status === "invalid_manifest") return { id: w.id, status: "invalid_manifest", error: w.error ?? "" };
  return {
    id: w.id,
    status: w.status as RunStatus,
    experiment: w.experiment ?? "",
    variant: w.variant ?? "",
    trigger: w.trigger ?? "",
    purpose: w.purpose ?? "",
    latestConclusion: w.latest_conclusion,
    evidenceStatus: w.evidence_status,
  };
}

export function mapLineageChild(c: WireLineageChild): LineageChild {
  return { relation: c.relation, runId: c.run_id, children: c.children.map(mapLineageChild) };
}

export function mapLineage(t: WireLineageTree): LineageNode {
  return { runId: t.run_id, children: t.children.map(mapLineageChild) };
}

export function mapRunShow(w: WireRunShow): RunShow {
  return { manifest: w.manifest, status: w.status as RunStatus, annotations: w.annotations };
}

export function mapMetric(m: WireMetric): Metric {
  const ci95 = m.ci95 && m.ci95.length === 2 ? ([m.ci95[0], m.ci95[1]] as [number, number]) : null;
  return { value: m.value, se: m.se, ci95, n: m.n, method: m.method };
}

export function mapRunSummary(w: WireRunSummary): RunSummary {
  const metrics: Record<string, Metric> = {};
  for (const [key, metric] of Object.entries(w.metrics)) metrics[key] = mapMetric(metric);
  return { metrics, sampleCount: w.sample_count, eventCount: w.event_count };
}

export function mapChartDataRow(w: WireChartDataRow): ChartDataRow {
  if ("state" in w) return { runId: w.run_id, state: "no_metric", reason: w.reason };
  return { runId: w.run_id, state: "metric", ...mapMetric(w) };
}

export function mapUsage(w: WireUsageRecord): UsageRecord {
  return {
    source: w.source,
    inputTokens: w["gen_ai.usage.input_tokens"],
    outputTokens: w["gen_ai.usage.output_tokens"],
    requestModel: w["gen_ai.request.model"],
    responseModel: w["gen_ai.response.model"],
    latencyMs: w.latency_ms,
    nullReason: w.null_reason,
  };
}

// The one legitimate place a `TailCursor` is minted: straight from the wire's `next_offset`.
export function mapTail(w: WireTail): TailResult {
  return {
    events: w.events.map((e) => ({ seq: e.seq, ts: e.ts, kind: e.kind, sampleId: e.sample_id ?? null, data: e.data, usage: e.usage ? mapUsage(e.usage) : null })),
    nextOffset: w.next_offset as TailCursor,
  };
}

async function read<T>(path: string, command: string): Promise<T> {
  const res = await fetch(`/xtrm-api/research${path}`);
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ResearchReadError(`research bridge returned ${res.status}`);
  }
  if (!("schema" in body)) throw new ResearchReadError((body as { error?: string }).error ?? `research bridge returned ${res.status}`);
  return unwrap(body, command);
}

const q = (params: Record<string, string | number | TailCursor | undefined>) => {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) usp.set(key, String(value));
  const s = usp.toString();
  return s ? `?${s}` : "";
};

export const liveResearch: ResearchAdapter = {
  source: "live",
  async listRuns() {
    return (await read<WireRunRow[]>("/runs", "runs")).map(mapRunRow);
  },
  async getLineage(runId) {
    return mapLineage(await read<WireLineageTree>(`/runs${q({ lineage: runId })}`, "runs"));
  },
  async getRun(runId) {
    return mapRunShow(await read<WireRunShow>(`/run${q({ id: runId })}`, "run show"));
  },
  async getExperiment(id, version) {
    return read<Record<string, unknown>>(`/experiment${q({ id, version })}`, "experiment show");
  },
  async getWorkload(id, version) {
    return read<Record<string, unknown>>(`/workload${q({ id, version })}`, "workload show");
  },
  // Cursor trap: `after` is the last-seen event `seq`, not a count, and it is passed straight
  // through to the Python CLI's `--after` (default -1, meaning "everything"). The bridge cannot
  // spell "from the beginning" as a number, so omit `after` for a fresh read — passing a cursor
  // of `0` would silently drop event seq 0, since the CLI filter is strict `seq > after`. The
  // `TailCursor` brand (types.ts) stops a raw numeric literal from being handed in by accident;
  // a genuinely acquired cursor of 0 is still valid and still gets sent as `after=0`. Later
  // slices (tail polling) must carry the previous call's `nextOffset` forward, never a count.
  async tail(runId, after) {
    return mapTail(await read<WireTail>(`/tail${q({ run: runId, after })}`, "tail"));
  },
  async getMetrics(runId) {
    return mapRunSummary(await read<WireRunSummary>(`/metrics${q({ run: runId })}`, "metrics"));
  },
  async getChartData(runIds, metric) {
    const usp = new URLSearchParams();
    for (const runId of runIds) usp.append("run", runId);
    usp.set("metric", metric);
    return (await read<WireChartDataRow[]>(`/chart-data?${usp.toString()}`, "chart-data")).map(mapChartDataRow);
  },
  async compare(runIds) {
    const usp = new URLSearchParams();
    for (const runId of runIds) usp.append("run", runId);
    const wire = await read<WireCompare>(`/compare?${usp.toString()}`, "compare");
    const out: Record<string, RunSummary> = {};
    for (const [runId, summary] of Object.entries(wire)) out[runId] = mapRunSummary(summary);
    return out;
  },
};
