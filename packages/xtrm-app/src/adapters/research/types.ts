import type { DataSource } from "../types.ts";

// Typed view models for the xtrm-research bridge (server/research-cli.ts).
// UI components depend on these, never on the wire shapes in live.ts.

export type RunStatus = "started" | "success" | "error" | "invalid" | "interrupted";

export interface Metric {
  value: number;
  se: number | null;
  ci95: [number, number] | null;
  n: number;
  method: string;
}

export interface RunRow {
  id: string;
  status: RunStatus;
  experiment: string;
  variant: string;
  trigger: string;
  purpose: string;
  latestConclusion: string | null;
  evidenceStatus: string | null;
}

/** A `runs` row whose manifest.json failed to load; every other field is null. */
export interface InvalidManifestRow {
  id: string;
  status: "invalid_manifest";
  error: string;
}

export type RunListRow = RunRow | InvalidManifestRow;

export function isInvalidManifestRow(row: RunListRow): row is InvalidManifestRow {
  return row.status === "invalid_manifest";
}

export interface LineageChild {
  relation: string;
  runId: string;
  children: LineageChild[];
}

export interface LineageNode {
  runId: string;
  children: LineageChild[];
}

export interface RunShow {
  manifest: Record<string, unknown>;
  status: RunStatus;
  annotations: Array<Record<string, unknown>>;
}

/** `common.schema.json#/$defs/usage_record`. Every value field is nullable, and the schema
 * guarantees a null value is always paired with a non-empty `nullReason`. */
export interface UsageRecord {
  source: string;
  inputTokens: number | null;
  outputTokens: number | null;
  requestModel: string | null;
  responseModel: string | null;
  latencyMs: number | null;
  nullReason: string | null;
}

export interface TailEvent {
  seq: number;
  ts: string;
  kind: string;
  sampleId: string | null;
  data: unknown;
  usage: UsageRecord | null;
}

declare const TAIL_CURSOR: unique symbol;

/**
 * The last-seen event `seq` for one run's tail, not a count. Branded so a plain number
 * literal (e.g. a cursor a caller initializes to `0`) can never type-check as one: the only
 * way to produce a `TailCursor` is a prior `TailResult.nextOffset`. Passing no cursor at all
 * means "from the beginning" — there is no numeric way to spell that (see `tail` below).
 */
export type TailCursor = number & { readonly [TAIL_CURSOR]: true };

export interface TailResult {
  events: TailEvent[];
  nextOffset: TailCursor;
}

export interface RunSummary {
  metrics: Record<string, Metric>;
  sampleCount: number;
  eventCount: number;
}

export interface ChartMetricRow extends Metric {
  runId: string;
  state: "metric";
}

export interface ChartMissingRow {
  runId: string;
  state: "no_metric";
  reason: string;
}

export type ChartDataRow = ChartMetricRow | ChartMissingRow;

export interface ResearchAdapter {
  readonly source: DataSource;
  listRuns(): Promise<RunListRow[]>;
  getLineage(runId: string): Promise<LineageNode>;
  getRun(runId: string): Promise<RunShow>;
  getExperiment(id: string, version?: string): Promise<Record<string, unknown>>;
  getWorkload(id: string, version?: string): Promise<Record<string, unknown>>;
  getQuestionSpec(id: string, version?: string): Promise<Record<string, unknown>>;
  tail(runId: string, after?: TailCursor): Promise<TailResult>;
  getMetrics(runId: string): Promise<RunSummary>;
  getChartData(runIds: string[], metric: string): Promise<ChartDataRow[]>;
  compare(runIds: string[]): Promise<Record<string, RunSummary>>;
}
