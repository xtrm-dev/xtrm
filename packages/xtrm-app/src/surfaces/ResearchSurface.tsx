import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useAdapters } from "../adapters/index.tsx";
import { readAccounting, readLineage, readVersionRef } from "../adapters/research/manifest.ts";
import { readExperimentSemantics, directionGlyph, directionPhrase, readMetricGlossary, readResultSummary, readRunIntent, type MetricGlossaryEntry } from "../adapters/research/semantics.ts";
import { isInvalidManifestRow, type ExperimentRef, type RunListRow, type RunRow, type RunStatus, type RunSummary, type SampleRecord } from "../adapters/research/types.ts";
import { compareRunIds, validateCompareSearch } from "../app/research-compare-search.ts";
import { useResearchCompare, useResearchExperiment, useResearchExperiments, useResearchMetrics, useResearchRun, useResearchRuns, useResearchSamples, useResearchTail, useResearchWorkloadForRun } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { Icon } from "../ui/icon.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceToolbar, type Tone } from "../ui/primitives.tsx";
import { ToolbarButton } from "../ui/toolbar.tsx";
import { MetricFields, UsageFields } from "./research-format.tsx";
import { ResearchCharts, chartSpecs } from "./research-charts.tsx";
import { DecisionCriteriaSection, GlossaryMetricRow, MethodSection, ResearchQuestionSection, ResultSummarySection } from "./research-semantic.tsx";

function runStatusTone(status: RunStatus): Tone {
  if (status === "success") return "done";
  if (status === "error" || status === "invalid") return "danger";
  if (status === "started") return "active";
  return "muted"; // interrupted
}

/** Run counts per experiment id, derived from the run list. The experiment list itself is
 * registry-sourced, so a definition with zero runs still appears with an explicit `0 runs`. */
function runCountsByExperiment(rows: RunListRow[] | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    if (isInvalidManifestRow(row)) continue;
    counts.set(row.experiment, (counts.get(row.experiment) ?? 0) + 1);
  }
  return counts;
}

function experimentHref(id: string): string {
  return `/research/experiments/${id}`;
}

export function ExperimentListSurface() {
  const { research } = useAdapters();
  const experiments = useResearchExperiments();
  const runs = useResearchRuns();
  const navigate = useNavigate();
  const runCounts = useMemo(() => runCountsByExperiment(runs.data), [runs.data]);
  // `invalid_manifest` rows have no resolvable experiment id, but a broken run must stay
  // visible rather than being filtered out of the view.
  const unknown = useMemo(() => (runs.data ?? []).filter(isInvalidManifestRow), [runs.data]);
  const openExperiment = (id: string) => void navigate({ to: experimentHref(id) } as never);

  let body;
  if (experiments.isPending) body = <LoadingState label="Loading experiments" />;
  else if (experiments.isError) body = <ErrorState title="Research registry unavailable" error={experiments.error} />;
  else if (experiments.data.length === 0 && unknown.length === 0) body = <p className="px-6 py-6 text-sm text-ink-faint">No experiment definitions are registered.</p>;
  else
    body = (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {experiments.data.map((experiment: ExperimentRef) => {
          const count = runCounts.get(experiment.id) ?? 0;
          return (
            <Row key={`${experiment.id}@${experiment.version}`} aria-label={experiment.id} onActivate={() => openExperiment(experiment.id)}>
              <span className="min-w-0 flex-1 truncate text-ink">{experiment.id}</span>
              <span className="w-16 shrink-0 truncate text-xs text-ink-faint">{experiment.version}</span>
              <span className="shrink-0 text-xs text-ink-faint tabular">
                {count} run{count === 1 ? "" : "s"}
              </span>
            </Row>
          );
        })}
        {unknown.length > 0 && (
          <>
            <h2 className="px-3 py-1.5 text-xs font-medium text-ink-faint">Unreadable run — no resolvable experiment</h2>
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
      <SurfaceToolbar>
        <SourceBadge source={research.source} />
      </SurfaceToolbar>
      {body}
    </section>
  );
}

// --- experiment detail --------------------------------------------------

function GlossaryDefinitionRow({ name, entry }: { name: string; entry: MetricGlossaryEntry }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border-muted px-3 py-2 last:border-b-0" aria-label={name}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-xs text-ink-faint">{name}</span>
        <span className="text-sm text-ink">{entry.label}</span>
        <span className="text-xs text-ink-faint" title={directionPhrase(entry.direction)}>
          {directionGlyph(entry.direction)} {directionPhrase(entry.direction)}
          {entry.unit ? ` · ${entry.unit}` : ""}
        </span>
      </div>
      <p className="text-xs leading-snug text-ink-faint">
        {entry.description}
        {entry.interpretation ? ` ${entry.interpretation}` : ""}
      </p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

/** The stable experiment-detail route: registry definition first, related runs second. Missing
 * optional fields are explicitly absent, never placeholdered with invented prose. */
export function ExperimentDetailSurface() {
  const { experimentId } = useParams({ strict: false }) as { experimentId: string };
  const navigate = useNavigate();
  const experiment = useResearchExperiment(experimentId);
  const runs = useResearchRuns();
  const semantics = useMemo(() => (experiment.data ? readExperimentSemantics(experiment.data) : null), [experiment.data]);
  const glossary = useMemo(() => (experiment.data ? readMetricGlossary(experiment.data) : new Map<string, MetricGlossaryEntry>()), [experiment.data]);
  const specs = useMemo(() => (experiment.data ? chartSpecs(experiment.data) : []), [experiment.data]);
  const relatedRuns = useMemo(
    () => (runs.data ?? []).filter((row): row is RunRow => !isInvalidManifestRow(row) && row.experiment === experimentId),
    [runs.data, experimentId],
  );
  const version = typeof experiment.data?.version === "string" ? experiment.data.version : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Experiment ${experimentId}`}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-muted px-4">
        <Breadcrumbs
          className="text-sm"
          items={[
            { key: "list", icon: "back", label: "Experiments", onClick: () => void navigate({ to: "/research/experiments" } as never) },
            { key: "self", label: <span className="font-mono">{experimentId}</span> },
          ]}
        />
        {version && <span className="ml-auto font-mono text-xs text-ink-faint">{experimentId}@{version}</span>}
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {experiment.isPending ? (
          <LoadingState rows={8} label="Loading experiment" />
        ) : experiment.isError ? (
          <ErrorState title={`Experiment definition unavailable: ${experimentId}`} error={experiment.error} />
        ) : (
          <div className="flex flex-col gap-6">
            <section aria-label="Definition">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Definition</h2>
              <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <DetailField label="Description" value={semantics?.description ?? <span className="text-ink-faint">not recorded</span>} />
                <DetailField label="Research question" value={semantics?.researchQuestion ?? <span className="text-ink-faint">not recorded</span>} />
                <DetailField label="Hypothesis" value={semantics?.hypothesis ?? <span className="text-ink-faint">not recorded</span>} />
                {semantics?.terminology && (
                  <DetailField
                    label="Terminology"
                    value={
                      <dl className="space-y-0.5">
                        {semantics.terminology.map(([term, definition]) => (
                          <div key={term} className="flex gap-2 text-xs leading-snug">
                            <dt className="shrink-0 font-mono text-ink">{term}</dt>
                            <dd className="text-ink-faint">{definition}</dd>
                          </div>
                        ))}
                      </dl>
                    }
                  />
                )}
              </dl>
            </section>
            <DecisionCriteriaSection experiment={semantics} />
            <section aria-label="Metric glossary">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Metric glossary</h2>
              {glossary.size === 0 ? (
                <p className="text-sm text-ink-faint">This experiment declares no metric glossary.</p>
              ) : (
                <div className="flex flex-col rounded-md border border-border-muted">
                  {[...glossary.entries()].map(([name, entry]) => (
                    <GlossaryDefinitionRow key={name} name={name} entry={entry} />
                  ))}
                </div>
              )}
            </section>
            <section aria-label="Declared charts">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Declared charts</h2>
              {specs.length === 0 ? (
                <p className="text-sm text-ink-faint">This experiment declares no charts.</p>
              ) : relatedRuns.length > 0 ? (
                <ResearchCharts experiment={experiment.data!} runIds={relatedRuns.map((r) => r.id)} />
              ) : (
                <div className="flex flex-col gap-2">
                  {specs.map((spec) => (
                    <div key={spec.id} className="rounded-md border border-border-muted px-3 py-2">
                      <p className="text-sm text-ink">{spec.title}</p>
                      <p className="text-xs text-ink-faint">{spec.description}</p>
                      <p className="mt-1 font-mono text-xs text-ink-faint">{spec.datasets.join(", ")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section aria-label="Related runs">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Related runs</h2>
              {relatedRuns.length === 0 ? (
                <p className="text-sm text-ink-faint">No runs reference this experiment.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border-muted rounded-md border border-border-muted">
                  {relatedRuns.map((run) => (
                    <Row key={run.id} density="list" aria-label={run.id} onActivate={() => void navigate({ to: `/research/runs/${run.id}` } as never)}>
                      <StatusDot tone={runStatusTone(run.status)} label={run.status} />
                      <span className="w-32 shrink-0 truncate font-mono text-xs text-ink-faint">{run.id}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{run.purpose}</span>
                    </Row>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
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
      <SurfaceToolbar>
        <SourceBadge source={research.source} />
        <div className="ml-auto" />
        {selected.length >= 2 && (
          <ToolbarButton onClick={compare}>Compare {selected.length} runs</ToolbarButton>
        )}
      </SurfaceToolbar>
      {body}
    </section>
  );
}

// --- run analysis -------------------------------------------------------

function jsonPreview(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** One arbitrary JSON value (a sample's input/output/candidate) rendered compactly. Absent stays
 * an explicit dash: it is never replaced with an inferred value from the event log. */
function JsonCell({ value, label }: { value: unknown; label: string }) {
  if (value === undefined) return <span className="text-ink-faint">—</span>;
  const text = jsonPreview(value);
  return (
    <span className="block truncate font-mono text-xs text-ink-muted" title={`${label}: ${text}`}>
      {text}
    </span>
  );
}

function SampleRowView({ sample, runId, onOpen }: { sample: SampleRecord; runId: string; onOpen: () => void }) {
  return (
    <Row density="list" aria-label={sample.sampleId} onActivate={onOpen}>
      <span className="w-24 shrink-0 truncate font-mono text-xs text-ink-faint">{sample.sampleId}</span>
      <span className="w-20 shrink-0 text-xs text-ink-faint">{sample.status}</span>
      <span className="min-w-0 flex-1">
        <JsonCell value={sample.input} label={`${sample.sampleId} input`} />
      </span>
      <span className="min-w-0 flex-1">
        <JsonCell value={sample.output} label={`${sample.sampleId} output`} />
      </span>
      <span className="min-w-0 flex-1">
        <JsonCell value={sample.candidate} label={`${sample.sampleId} candidate`} />
      </span>
      <span className="w-56 shrink-0 truncate text-xs text-ink-faint">
        {sample.usage ? <UsageFields usage={sample.usage} layout="inline" /> : "no usage recorded"}
      </span>
    </Row>
  );
}

export function RunAnalysisSurface() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const { inspect } = useShell();
  const navigate = useNavigate();
  const run = useResearchRun(runId);
  const metrics = useResearchMetrics(runId);
  const samples = useResearchSamples(runId);
  // Telemetry is a separate read from the sample records: the event log is never presented as
  // sample contents, and a sample is never reconstructed from its events.
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
        <Breadcrumbs
          className="text-sm"
          items={[
            { key: "list", icon: "back", label: "Runs", onClick: () => void navigate({ to: "/research/runs" } as never) },
            { key: "self", label: <span className="font-mono">{runId}</span> },
          ]}
        />
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
              {samples.isPending ? (
                <LoadingState rows={3} label="Loading samples" />
              ) : samples.isError ? (
                <ErrorState title="Sample records unavailable" error={samples.error} />
              ) : samples.data.length === 0 ? (
                <p className="text-sm text-ink-faint">No sample records recorded.</p>
              ) : (
                <div className="flex flex-col rounded-md border border-border-muted">
                  <Row density="list" className="text-xs text-ink-faint">
                    <span className="w-24 shrink-0">Sample</span>
                    <span className="w-20 shrink-0">Status</span>
                    <span className="min-w-0 flex-1">Input</span>
                    <span className="min-w-0 flex-1">Output</span>
                    <span className="min-w-0 flex-1">Candidate</span>
                    <span className="w-56 shrink-0">Usage</span>
                  </Row>
                  <div className="flex flex-col divide-y divide-border-muted">
                    {samples.data.map((sample) => (
                      <SampleRowView key={sample.sampleId} sample={sample} runId={runId} onOpen={() => inspect({ kind: "research-sample", ref: `${runId}|${sample.sampleId}` })} />
                    ))}
                  </div>
                </div>
              )}
            </section>
            <section aria-label="Telemetry events">
              <h2 className="mb-2 text-xs font-medium text-ink-faint">Telemetry events</h2>
              {tail.isPending ? (
                <LoadingState rows={3} label="Loading telemetry" />
              ) : tail.isError ? (
                <ErrorState title="Telemetry log unavailable" error={tail.error} />
              ) : tail.data.events.length === 0 ? (
                <p className="text-sm text-ink-faint">No telemetry events recorded.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border-muted rounded-md border border-border-muted">
                  {tail.data.events.map((event) => (
                    <Row key={event.seq} density="list" aria-label={`event ${event.seq} ${event.kind}`}>
                      <span className="w-12 shrink-0 tabular text-xs text-ink-faint">{event.seq}</span>
                      <span className="w-40 shrink-0 truncate text-xs text-ink-faint">{new Date(event.ts).toLocaleString()}</span>
                      <span className="w-40 shrink-0 truncate font-mono text-xs text-ink-muted">{event.kind}</span>
                      <span className="w-24 shrink-0 truncate font-mono text-xs text-ink-faint">{event.sampleId ?? "—"}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">
                        {event.usage ? <UsageFields usage={event.usage} layout="inline" /> : "no usage recorded"}
                      </span>
                    </Row>
                  ))}
                </div>
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
      <SurfaceToolbar>
        <SourceBadge source={research.source} />
      </SurfaceToolbar>
      {body}
    </section>
  );
}
