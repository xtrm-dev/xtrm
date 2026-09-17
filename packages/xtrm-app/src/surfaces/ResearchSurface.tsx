import { useMemo } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { isInvalidManifestRow, type InvalidManifestRow, type RunListRow, type RunRow, type RunStatus } from "../adapters/research/types.ts";
import { useResearchRuns } from "../app/queries.ts";
import { ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceHeader, type Tone } from "../ui/primitives.tsx";

function runStatusTone(status: RunStatus): Tone {
  if (status === "success") return "done";
  if (status === "error" || status === "invalid") return "danger";
  if (status === "started") return "active";
  return "muted"; // interrupted
}

/** One distinct experiment id seen across `listRuns()`, plus how many runs reference it. There is
 * no `listExperiments` read verb (map-433.md §B2), so the experiment list is derived here rather
 * than sourced from a new adapter call. */
interface ExperimentSummary {
  id: string;
  runCount: number;
}

interface DerivedExperiments {
  experiments: ExperimentSummary[];
  /** `invalid_manifest` rows: no resolvable experiment id, but a broken run must stay visible
   * (rev 9) rather than being filtered out of the derived view, same rule as the run list's
   * error row. */
  unknown: InvalidManifestRow[];
}

function deriveExperiments(rows: RunListRow[] | undefined): DerivedExperiments {
  if (!rows) return { experiments: [], unknown: [] };
  const byId = new Map<string, ExperimentSummary>();
  const unknown: InvalidManifestRow[] = [];
  for (const row of rows) {
    if (isInvalidManifestRow(row)) {
      unknown.push(row);
      continue;
    }
    const entry = byId.get(row.experiment) ?? { id: row.experiment, runCount: 0 };
    entry.runCount += 1;
    byId.set(row.experiment, entry);
  }
  return { experiments: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), unknown };
}

export function ExperimentListSurface() {
  const { research } = useAdapters();
  const runs = useResearchRuns();
  const { experiments, unknown } = useMemo(() => deriveExperiments(runs.data), [runs.data]);

  let body;
  if (runs.isPending) body = <LoadingState label="Loading experiments" />;
  else if (runs.isError) body = <ErrorState title="Research bridge unavailable" error={runs.error} />;
  else if (experiments.length === 0 && unknown.length === 0) body = <p className="px-6 py-6 text-sm text-ink-faint">No experiments have a run yet.</p>;
  else
    body = (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {experiments.map((experiment) => (
          <Row key={experiment.id}>
            <span className="min-w-0 flex-1 truncate text-ink">{experiment.id}</span>
            <span className="shrink-0 text-xs text-ink-faint tabular">
              {experiment.runCount} run{experiment.runCount === 1 ? "" : "s"}
            </span>
          </Row>
        ))}
        {unknown.length > 0 && (
          <>
            <h2 className="px-3 py-1.5 text-xs font-medium text-ink-faint">Unknown experiment — manifest unreadable</h2>
            {unknown.map((row) => (
              <Row key={row.id} aria-label={`${row.id} unknown experiment`}>
                <StatusDot tone="danger" label="invalid_manifest" />
                <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-faint">{row.id}</span>
                <span className="min-w-0 flex-1 truncate text-danger" title={row.error}>
                  {row.error}
                </span>
              </Row>
            ))}
          </>
        )}
      </div>
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Experiments">
      <SurfaceHeader title="Experiments" meta={<SourceBadge source={research.source} />} />
      {body}
    </section>
  );
}

function RunRowView({ row }: { row: RunListRow }) {
  if (isInvalidManifestRow(row)) {
    return (
      <Row aria-label={`${row.id} invalid manifest`}>
        <StatusDot tone="danger" label="invalid_manifest" />
        <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-faint">{row.id}</span>
        <span className="min-w-0 flex-1 truncate text-danger" title={row.error}>
          {row.error}
        </span>
      </Row>
    );
  }
  const run: RunRow = row;
  return (
    <Row aria-label={run.id}>
      <StatusDot tone={runStatusTone(run.status)} label={run.status} />
      <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-faint">{run.id}</span>
      <span className="w-24 shrink-0 truncate text-xs text-ink-faint">{run.trigger}</span>
      <span className="min-w-0 flex-1 truncate text-ink-muted">{run.purpose}</span>
      <span className="w-48 shrink-0 truncate text-xs text-ink-faint" title={run.latestConclusion ?? undefined}>
        {run.latestConclusion ?? "—"}
      </span>
      <span className="w-24 shrink-0 truncate text-xs text-ink-faint">{run.evidenceStatus ?? "—"}</span>
    </Row>
  );
}

export function RunListSurface() {
  const { research } = useAdapters();
  const runs = useResearchRuns();

  let body;
  if (runs.isPending) body = <LoadingState label="Loading runs" />;
  else if (runs.isError) body = <ErrorState title="Research bridge unavailable" error={runs.error} />;
  else if (runs.data.length === 0) body = <p className="px-6 py-6 text-sm text-ink-faint">No runs recorded yet.</p>;
  else
    body = (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <Row density="sidebar" className="text-xs text-ink-faint">
          <span className="w-3.5" />
          <span className="w-28 shrink-0">Run</span>
          <span className="w-24 shrink-0">Trigger</span>
          <span className="min-w-0 flex-1">Purpose</span>
          <span className="w-48 shrink-0">Latest conclusion</span>
          <span className="w-24 shrink-0">Evidence</span>
        </Row>
        {/* Cost moved to the run analysis surface under rev 9 (reads run show); never re-add it
            here as a per-row lookup — that would be an N+1 fetch over listRuns(). */}
        {runs.data.map((row) => (
          <RunRowView key={row.id} row={row} />
        ))}
      </div>
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Runs">
      <SurfaceHeader title="Runs" meta={<SourceBadge source={research.source} />} />
      {body}
    </section>
  );
}
