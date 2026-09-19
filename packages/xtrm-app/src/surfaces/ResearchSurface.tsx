import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useAdapters } from "../adapters/index.tsx";
import { readAccounting, readLineage, readVersionRef } from "../adapters/research/manifest.ts";
import { readExperimentSemantics, readMetricGlossary, readResultSummary, readRunIntent } from "../adapters/research/semantics.ts";
import { isInvalidManifestRow, type InvalidManifestRow, type RunListRow, type RunRow, type RunStatus, type RunSummary, type TailEvent, type UsageRecord } from "../adapters/research/types.ts";
import { compareRunIds, validateCompareSearch } from "../app/research-compare-search.ts";
import { useResearchCompare, useResearchExperiment, useResearchMetrics, useResearchRun, useResearchRuns, useResearchTail, useResearchWorkloadForRun } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceHeader, type Tone } from "../ui/primitives.tsx";
import { MetricFields, UsageFields } from "./research-format.tsx";
import { ResearchCharts } from "./research-charts.tsx";
import { DecisionCriteriaSection, GlossaryMetricRow, MethodSection, ResearchQuestionSection, ResultSummarySection } from "./research-semantic.tsx";

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

function RunRowView({ row, selected, onToggleSelect, onOpen }: { row: RunListRow; selected: boolean; onToggleSelect: () => void; onOpen: () => void }) {
  const checkbox = (
    <input
      type="checkbox"
      aria-label={`Select ${row.id} for comparison`}
      checked={selected}
      onChange={onToggleSelect}
      onClick={(e) => e.stopPropagation()}
      className="size-3.5 shrink-0"
    />
  );
  if (isInvalidManifestRow(row)) {
    return (
      <Row aria-label={`${row.id} invalid manifest`} onActivate={onOpen}>
        {checkbox}
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
    <Row aria-label={run.id} onActivate={onOpen}>
      {checkbox}
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
  const navigate = useNavigate();
  // Insertion order is comparison order: the first selected run is the baseline (§ compare
  // surface below). Selection is local UI state, never persisted — there is no "Saved
  // Comparisons" store yet (RESEARCH_SECTIONS `comparisons` item).
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const openRun = (id: string) => void navigate({ to: `/research/runs/${id}` } as never);
  const compare = () => {
    const [baseline, ...candidate] = selected;
    if (!baseline) return;
    void navigate({ to: "/research/compare", search: { baseline, candidate } } as never);
  };

  let body;
  if (runs.isPending) body = <LoadingState label="Loading runs" />;
  else if (runs.isError) body = <ErrorState title="Research bridge unavailable" error={runs.error} />;
  else if (runs.data.length === 0) body = <p className="px-6 py-6 text-sm text-ink-faint">No runs recorded yet.</p>;
  else
    body = (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <Row density="sidebar" className="text-xs text-ink-faint">
          <span className="w-3.5" />
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
          <RunRowView key={row.id} row={row} selected={selected.includes(row.id)} onToggleSelect={() => toggle(row.id)} onOpen={() => openRun(row.id)} />
        ))}
      </div>
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Runs">
      <SurfaceHeader title="Runs" meta={<SourceBadge source={research.source} />}>
        {selected.length >= 2 && (
          <button type="button" onClick={compare} className="flex h-7 items-center gap-1.5 rounded-md border border-border-muted px-2 text-xs text-ink-muted hover:bg-hover hover:text-ink">
            Compare {selected.length} runs
          </button>
        )}
      </SurfaceHeader>
      {body}
    </section>
  );
}

// --- run analysis -------------------------------------------------------

interface SampleGroup {
  sampleId: string;
  kinds: string[];
  usage: UsageRecord | null;
}

function latestUsage(events: TailEvent[]): UsageRecord | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const usage = events[i]!.usage;
    if (usage) return usage;
  }
  return null;
}

/** Groups `tail()` events by `sampleId` — the sample table's only data source, since no CLI
 * verb exposes `samples.jsonl` directly (map-433.md §B7). */
function groupSamples(events: TailEvent[]): SampleGroup[] {
  const bySample = new Map<string, TailEvent[]>();
  for (const e of events) {
    if (e.sampleId === null) continue;
    const list = bySample.get(e.sampleId) ?? [];
    list.push(e);
    bySample.set(e.sampleId, list);
  }
  return [...bySample.entries()].map(([sampleId, evs]) => ({ sampleId, kinds: evs.map((e) => e.kind), usage: latestUsage(evs) }));
}

export function RunAnalysisSurface() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const { inspect } = useShell();
  const navigate = useNavigate();
  const run = useResearchRun(runId);
  const metrics = useResearchMetrics(runId);
  const tail = useResearchTail(runId);
  // The run page resolves the *exact versioned* definitions its manifest references: the chart
  // surface and the semantic sections read the same resolved definition, and neither copies
  // prose into the manifest.
  const manifest = run.data?.manifest;
  const experimentRef = manifest ? readVersionRef(manifest.experiment) : null;
  const variantRef = manifest ? readVersionRef(manifest.variant) : null;
  const experiment = useResearchExperiment(experimentRef?.id ?? null, experimentRef?.version);
  const workload = useResearchWorkloadForRun(manifest);
  const semantics = useMemo(() => (experiment.data ? readExperimentSemantics(experiment.data) : null), [experiment.data]);
  const glossary = useMemo(() => (experiment.data ? readMetricGlossary(experiment.data) : new Map()), [experiment.data]);
  const intent = useMemo(() => (manifest ? readRunIntent(manifest) : { purpose: null, rationale: null, trigger: null }), [manifest]);
  const resultSummary = useMemo(() => (run.data ? readResultSummary(run.data.annotations) : null), [run.data]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Run ${runId}`}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-muted px-4">
        <button type="button" onClick={() => void navigate({ to: "/research/runs" } as never)} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-ink-faint hover:bg-hover hover:text-ink">
          <Icon name="back" size="xs" /> Runs
        </button>
        <span className="text-ink-faint">/</span>
        <span className="font-mono text-sm text-ink">{runId}</span>
        {run.data && <StatusDot tone={runStatusTone(run.data.status)} label={run.data.status} />}
        {manifest && readVersionRef(manifest.variant) && <span className="ml-auto font-mono text-xs text-ink-faint">{readVersionRef(manifest.variant)!.id}@{readVersionRef(manifest.variant)!.version}</span>}
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {run.isPending ? (
          <LoadingState rows={8} label="Loading run" />
        ) : run.isError ? (
          <ErrorState title={`Run manifest unreadable: ${runId}`} error={run.error} />
        ) : (
          <div className="flex flex-col gap-6">
            {/* First viewport: why -> what would count -> what happened -> what it means. */}
            <ResearchQuestionSection experiment={semantics} intent={intent} runId={runId} />
            <DecisionCriteriaSection experiment={semantics} />
            <ResultSummarySection summary={resultSummary} />
            <MethodSection manifest={manifest!} workloadDef={workload.data} />
            <section aria-label="Metrics">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Metrics</h2>
              {metrics.isPending ? (
                <LoadingState rows={3} label="Loading metrics" />
              ) : metrics.isError ? (
                <ErrorState title="Metrics unavailable" error={metrics.error} />
              ) : Object.keys(metrics.data.metrics).length === 0 ? (
                <p className="text-sm text-ink-faint">No metrics reported for this run.</p>
              ) : (
                <div className="flex flex-col rounded-md border border-border-muted">
                  {Object.entries(metrics.data.metrics).map(([key, metric]) => {
                    // Metric keys are namespaced `evaluator::metric`; the glossary and legend are
                    // keyed by the bare metric name.
                    const bare = key.includes("::") ? key.slice(key.indexOf("::") + 2) : key;
                    const legendLabel = (experiment.data?.legend as Record<string, string> | undefined)?.[key] ?? (experiment.data?.legend as Record<string, string> | undefined)?.[bare];
                    return (
                      <GlossaryMetricRow
                        key={key}
                        name={key}
                        metric={metric}
                        entry={glossary.get(bare) ?? glossary.get(key)}
                        legendLabel={legendLabel}
                        onActivate={() => inspect({ kind: "research-metric", ref: `${runId}|${key}` })}
                      />
                    );
                  })}
                </div>
              )}
            </section>
            {experiment.isPending ? (
              <section aria-label="Charts"><LoadingState rows={3} label="Loading chart definitions" /></section>
            ) : experiment.isError ? (
              <section aria-label="Charts"><ErrorState title="Experiment chart definitions unavailable" error={experiment.error} /></section>
            ) : experiment.data ? (
              <ResearchCharts experiment={experiment.data} runIds={[runId]} runLabels={{ [runId]: variantRef?.id ?? runId }} />
            ) : null}
            <section aria-label="Samples">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Samples</h2>
              {tail.isPending ? (
                <LoadingState rows={3} label="Loading samples" />
              ) : tail.isError ? (
                <ErrorState title="Sample log unavailable" error={tail.error} />
              ) : (
                (() => {
                  const groups = groupSamples(tail.data.events);
                  if (groups.length === 0) return <p className="text-sm text-ink-faint">No per-sample events recorded yet.</p>;
                  return (
                    <div className="flex flex-col divide-y divide-border-muted rounded-md border border-border-muted">
                      {groups.map((g) => (
                        <Row key={g.sampleId} density="list" onActivate={() => inspect({ kind: "research-sample", ref: `${runId}|${g.sampleId}` })} aria-label={g.sampleId}>
                          <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-faint">{g.sampleId}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{g.kinds.join(", ")}</span>
                          <span className="w-56 shrink-0 truncate text-xs text-ink-faint">
                            {g.usage ? <UsageFields usage={g.usage} layout="inline" /> : "no usage recorded"}
                          </span>
                        </Row>
                      ))}
                    </div>
                  );
                })()
              )}
            </section>
            <section aria-label="Annotations">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Annotations</h2>
              {run.data.annotations.length === 0 ? (
                <p className="text-sm text-ink-faint">No annotations recorded.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border-muted rounded-md border border-border-muted">
                  {run.data.annotations.map((a, i) => (
                    <Row key={i} density="list" onActivate={() => inspect({ kind: "research-annotation", ref: `${runId}|${i}` })} aria-label={String(a.kind ?? `annotation-${i}`)}>
                      <span className="w-32 shrink-0 truncate text-xs text-ink-faint">{String(a.kind ?? "—")}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-muted">{String(a.text ?? (a.result_summary as Record<string, unknown> | undefined)?.plain_language ?? "")}</span>
                    </Row>
                  ))}
                </div>
              )}
            </section>
            {/* Provenance stays below the scientific reading (c.13438): the first viewport
                answers why/what/means, the version pins and accounting follow. */}
            <ManifestSection runId={runId} manifest={manifest!} onInspect={() => inspect({ kind: "research-run", ref: runId })} />
          </div>
        )}
      </div>
    </section>
  );
}

function ManifestSection({ runId, manifest, onInspect }: { runId: string; manifest: Record<string, unknown>; onInspect: () => void }) {
  const experiment = readVersionRef(manifest.experiment);
  const workload = readVersionRef(manifest.workload);
  const variant = readVersionRef(manifest.variant);
  const dataset = readVersionRef(manifest.dataset);
  const accounting = readAccounting(manifest.accounting);
  const lineage = readLineage(manifest.lineage);
  const { inspect } = useShell();
  return (
    <section aria-label="Manifest and versions">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs font-medium text-ink-faint">Manifest &amp; versions</h2>
        <button type="button" onClick={onInspect} className="ml-auto text-xs text-accent-ink hover:underline">
          Open provenance
        </button>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-faint">Experiment</dt>
        <dd className="text-ink">{experiment ? `${experiment.id}@${experiment.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Workload</dt>
        <dd className="text-ink">{workload ? `${workload.id}@${workload.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Variant</dt>
        <dd className="text-ink">{variant ? `${variant.id}@${variant.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Dataset</dt>
        <dd className="text-ink">{dataset ? `${dataset.id}@${dataset.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Accounting</dt>
        <dd className="text-ink">
          {accounting ? (
            `${accounting.priceTableVersion} · ${accounting.telemetrySchemaVersion} · ${accounting.otelSemconvRef}`
          ) : (
            <span className="text-danger">Accounting provenance unavailable</span>
          )}
        </dd>
        <dt className="text-ink-faint">Lineage</dt>
        <dd className="text-ink">
          {lineage.length === 0 ? (
            <span className="text-ink-faint">no lineage refs</span>
          ) : (
            <span className="flex flex-wrap gap-x-3">
              {lineage.map((l) => (
                <button key={`${l.relation}:${l.runId}`} type="button" onClick={() => inspect({ kind: "research-run", ref: l.runId })} className="text-accent-ink hover:underline">
                  {l.relation} → {l.runId}
                </button>
              ))}
            </span>
          )}
        </dd>
      </dl>
    </section>
  );
}

// --- comparison -----------------------------------------------------------

interface MetricCell {
  metric: RunSummary["metrics"][string] | undefined;
}

function MetricCellView({ metric }: MetricCell) {
  if (!metric) return <span className="text-ink-faint">not reported</span>;
  return <MetricFields metric={metric} layout="inline" />;
}

function delta(candidate: number | undefined, baseline: number | undefined): string {
  if (candidate === undefined || baseline === undefined) return "—";
  const d = candidate - baseline;
  if (d === 0) return "0";
  return d > 0 ? `+${d}` : String(d);
}

export function RunComparisonSurface() {
  const { research } = useAdapters();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateCompareSearch(rawSearch);
  const runIds = compareRunIds(search);
  const compare = useResearchCompare(runIds);
  const runs = useResearchRuns();
  const runLabels = Object.fromEntries(
    (runs.data ?? [])
      .filter((row): row is RunRow => !isInvalidManifestRow(row) && runIds.includes(row.id))
      .map((row) => [row.id, row.variant]),
  );
  const baselineRun = useResearchRun(runIds[0] ?? null);
  const baselineExperimentRef = baselineRun.data ? readVersionRef(baselineRun.data.manifest.experiment) : null;
  const experiment = useResearchExperiment(baselineExperimentRef?.id ?? null, baselineExperimentRef?.version);

  let body: ReactNode;
  if (runIds.length < 2) {
    body = <EmptyState icon="research" title="Select a baseline and at least one candidate run to compare">Pick two or more runs from Recent Runs and choose Compare.</EmptyState>;
  } else if (compare.isPending) {
    body = <LoadingState rows={6} label="Loading comparison" />;
  } else if (compare.isError) {
    // `compare` has no per-run tolerance (map-433.md §B7): one bad run fails the whole call.
    // Never render an empty table for that — name the comparison and the reason.
    body = <ErrorState title={`Comparison failed: ${runIds.join(" vs ")}`} error={compare.error} />;
  } else {
    const [baselineId, ...candidateIds] = runIds;
    const baseline = compare.data[baselineId!];
    const metricKeys = [...new Set(Object.values(compare.data).flatMap((s) => Object.keys(s.metrics)))].sort();
    body = (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint">
              <th className="border-b border-border-muted px-2 py-1.5">Metric</th>
              <th className="border-b border-border-muted px-2 py-1.5">{baselineId} (baseline)</th>
              {candidateIds.map((c) => (
                <th key={c} className="border-b border-border-muted px-2 py-1.5" colSpan={2}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricKeys.map((key) => (
              <tr key={key}>
                <td className="border-b border-border-muted px-2 py-1.5 font-mono text-xs text-ink-faint">{key}</td>
                <td className="border-b border-border-muted px-2 py-1.5">
                  <MetricCellView metric={baseline?.metrics[key]} />
                </td>
                {candidateIds.map((c) => (
                  <Fragment key={c}>
                    <td className="border-b border-border-muted px-2 py-1.5">
                      <MetricCellView metric={compare.data[c]?.metrics[key]} />
                    </td>
                    <td className="border-b border-border-muted px-2 py-1.5 text-xs text-ink-faint tabular">
                      {delta(compare.data[c]?.metrics[key]?.value, baseline?.metrics[key]?.value)}
                    </td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {experiment.data ? (
          <div className="mt-6">
            <ResearchCharts experiment={experiment.data} runIds={runIds} runLabels={runLabels} />
          </div>
        ) : experiment.isError ? (
          <div className="mt-6"><ErrorState title="Experiment chart definitions unavailable" error={experiment.error} /></div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Comparison">
      <SurfaceHeader title="Comparison" meta={<SourceBadge source={research.source} />} />
      {body}
    </section>
  );
}
