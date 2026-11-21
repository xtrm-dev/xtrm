import { useResearchChartData } from "../app/queries.ts";
import type { ChartDataRow } from "../adapters/research/types.ts";
import { ErrorState, LoadingState } from "../ui/primitives.tsx";
import { SectionHeader } from "../ui/section.tsx";

export interface ChartSpec {
  id: string;
  title: string;
  description: string;
  datasets: string[];
}

interface MetricMeta {
  label: string;
  description: string;
  unit?: string;
  direction?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function chartSpecs(experiment: Record<string, unknown>): ChartSpec[] {
  if (!Array.isArray(experiment.chart_specs)) return [];
  return experiment.chart_specs.flatMap((raw) => {
    const r = record(raw);
    if (!r || !Array.isArray(r.datasets)) return [];
    const id = text(r.id);
    const title = text(r.title);
    const description = text(r.description);
    const datasets = r.datasets.filter((d): d is string => typeof d === "string" && d.length > 0);
    return id && title && description && datasets.length > 0 ? [{ id, title, description, datasets }] : [];
  });
}

function metricMeta(experiment: Record<string, unknown>, dataset: string): MetricMeta {
  const glossary = record(experiment.metric_glossary);
  const entry = glossary ? record(glossary[dataset]) : null;
  const legend = record(experiment.legend);
  const fallback = legend && typeof legend[dataset] === "string" ? String(legend[dataset]) : dataset;
  return {
    label: text(entry?.label) ?? dataset,
    description: text(entry?.description) ?? fallback,
    unit: text(entry?.unit) ?? undefined,
    direction: text(entry?.direction) ?? undefined,
  };
}

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(value);
}

function interval(row: Extract<ChartDataRow, { state: "metric" }>): string {
  if (!row.ci95) return `${fmt(row.value)} · n=${row.n}`;
  return `${fmt(row.value)} · 95% CI [${fmt(row.ci95[0])}, ${fmt(row.ci95[1])}] · n=${row.n}`;
}

function MetricDatasetChart({
  experiment,
  dataset,
  runIds,
  runLabels,
}: {
  experiment: Record<string, unknown>;
  dataset: string;
  runIds: string[];
  runLabels?: Record<string, string>;
}) {
  const query = useResearchChartData(runIds, dataset);
  const meta = metricMeta(experiment, dataset);

  if (query.isPending) return <LoadingState rows={Math.max(2, runIds.length)} label={`Loading chart ${dataset}`} />;
  if (query.isError) return <ErrorState title={`Chart dataset unavailable: ${dataset}`} error={query.error} />;

  const measured = query.data.filter((row): row is Extract<ChartDataRow, { state: "metric" }> => row.state === "metric");
  const missing = query.data.filter((row) => row.state === "no_metric");
  if (measured.length === 0) return <p className="text-xs text-ink-faint">No reported values for {meta.label}.</p>;

  const min = Math.min(0, ...measured.map((row) => row.value));
  const max = Math.max(0, ...measured.map((row) => row.value));
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  const position = (value: number) => ((value - min) / span) * 100;

  return (
    <div className="flex flex-col gap-2" aria-label={`${meta.label} chart`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-xs font-medium text-ink">{meta.label}</p>
        <span className="text-xs text-ink-faint">{meta.description}</span>
        {meta.direction && meta.direction !== "unspecified" && <span className="text-xs text-ink-faint">{meta.direction.replaceAll("_", " ")}</span>}
      </div>
      <div className="flex flex-col gap-2">
        {measured.map((row) => {
          const x = position(row.value);
          const left = Math.min(zero, x);
          const width = Math.max(Math.abs(x - zero), 0.8);
          return (
            <div key={row.runId} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-xs">
              <span className="truncate font-mono text-ink-faint" title={runLabels?.[row.runId] ?? row.runId}>{runLabels?.[row.runId] ?? row.runId}</span>
              <div className="relative h-4 overflow-hidden rounded-sm bg-control" aria-hidden="true">
                <span className="absolute inset-y-0 w-px bg-border-muted" style={{ left: `${zero}%` }} />
                <span className="absolute inset-y-1 rounded-sm bg-accent" style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
              <span className="whitespace-nowrap tabular text-ink-muted">{interval(row)}{meta.unit ? ` ${meta.unit}` : ""}</span>
            </div>
          );
        })}
        {missing.map((row) => (
          <div key={row.runId} className="grid grid-cols-[8rem_1fr] gap-2 text-xs">
            <span className="truncate font-mono text-ink-faint">{runLabels?.[row.runId] ?? row.runId}</span>
            <span className="text-ink-faint">not reported</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResearchCharts({
  experiment,
  runIds,
  runLabels,
}: {
  experiment: Record<string, unknown>;
  runIds: string[];
  runLabels?: Record<string, string>;
}) {
  const specs = chartSpecs(experiment);
  if (specs.length === 0 || runIds.length === 0) return null;

  return (
    <section aria-label="Charts" className="flex flex-col">
      <SectionHeader title="Charts" level={3} className="mb-2" />
      <div className="grid gap-3 px-3 xl:grid-cols-2">
        {specs.map((spec) => (
          <article key={spec.id} className="flex min-w-0 flex-col" aria-label={spec.title}>
            <SectionHeader title={spec.title} level={4} inset="none" />
            <p className="mt-0.5 text-xs text-ink-faint">{spec.description}</p>
            <div className="mt-3 flex flex-col gap-4">
              {spec.datasets.map((dataset) => (
                <MetricDatasetChart key={dataset} experiment={experiment} dataset={dataset} runIds={runIds} runLabels={runLabels} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
