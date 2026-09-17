// Narrow, defensive readers over `RunShow.manifest` (a passthrough `Record<string, unknown>`,
// see types.ts). The manifest schema requires every field below, but a run analysis surface
// still renders defensively: a hand-edited or partially-upgraded manifest must produce an
// explicit "provenance unavailable" state rather than throw or blank out (rev 10 item 3).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export interface VersionRef {
  id: string;
  version: string;
  contentHash: string;
}

/** `{id, version, content_hash}` — experiment/workload/dataset/variant/evaluator/question_spec refs. */
export function readVersionRef(v: unknown): VersionRef | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const version = str(v.version);
  const contentHash = str(v.content_hash);
  return id && version && contentHash ? { id, version, contentHash } : null;
}

export interface AccountingProvenance {
  priceTableVersion: string;
  telemetrySchemaVersion: string;
  otelSemconvRef: string;
}

/** `manifest.accounting` never carries a money figure (rev 10): provenance identifiers only. */
export function readAccounting(v: unknown): AccountingProvenance | null {
  if (!isRecord(v)) return null;
  const priceTableVersion = str(v.price_table_version);
  const telemetrySchemaVersion = str(v.telemetry_schema_version);
  const otelSemconvRef = str(v.otel_semconv_ref);
  return priceTableVersion && telemetrySchemaVersion && otelSemconvRef ? { priceTableVersion, telemetrySchemaVersion, otelSemconvRef } : null;
}

export interface LineageRef {
  relation: string;
  runId: string;
}

export function readLineage(v: unknown): LineageRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => (isRecord(e) ? { relation: str(e.relation), runId: str(e.run_id) } : null))
    .filter((e): e is LineageRef => e !== null && e.relation !== null && e.runId !== null);
}
