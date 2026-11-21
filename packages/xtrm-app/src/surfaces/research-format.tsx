// Shared presentational widgets for a `Metric` and a `UsageRecord` (adapters/research/types.ts),
// used by both the run analysis / comparison surfaces and the Inspector Drawer panels, so a
// metric or a usage row always renders the same way wherever it appears (rev 10 item 2/3: value
// never appears without its interval and method; a null value never appears without its reason).
import type { Metric, UsageRecord } from "../adapters/research/types.ts";
import { Fields } from "../ui/drawer.tsx";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));

/** The one label-column step for a Research field grid (XTRM-948).
 *
 * `Fields` already owns the gutter (`gap-x-3`, 0.75rem), so the COLUMN is the step and a page must
 * not restate the template: a 10rem column starts its values at 172px, an 8rem column at 140px, and
 * 7.5rem at 132px, so four pages that look alike disagreed about where a value begins. Pass this to
 * `Fields` rather than writing a new `gridTemplateColumns`.
 *
 * The one sanctioned exception is the dense criteria grid: keys are literally `true`/`false` (about
 * 28px of text in a 56px track) with its own `gap-x-2`, because it is a key/value legend, not a
 * field list. It is bounded by LABEL LENGTH, not by row density — an 8-character label is the limit,
 * and renaming those keys to `supported`/`unsupported` would overflow the fixed track. */
export const LABEL_COLUMN = "10rem";

/** The sanctioned dense exception's column (see `LABEL_COLUMN`). */
export const DENSE_LABEL_COLUMN = "3.5rem";

/** One renderer, two layouts: `fields` is the drawer's label/value list, `inline` is the compact
 * single line shared by the run analysis metrics table and the comparison metric cell. */
export type FieldLayout = "fields" | "inline";

/** A metric always renders value, interval, se, n and method together — or, when se/ci95 are
 * null, `method` stands in for the missing half so the row never goes blank. */
export function MetricFields({ metric, layout = "fields" }: { metric: Metric; layout?: FieldLayout }) {
  if (layout === "inline")
    return (
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs text-ink-faint">
        <span className="tabular text-sm text-ink">{metric.value}</span>
        <span className="tabular">{metric.ci95 ? `95% CI [${metric.ci95[0]}, ${metric.ci95[1]}]` : `no interval — ${metric.method}`}</span>
        <span className="tabular">{metric.se === null ? `se n/a — ${metric.method}` : `se=${metric.se}`}</span>
        <span className="tabular">n={metric.n}</span>
        <span className="min-w-0 truncate" title="Method">
          {metric.method}
        </span>
      </span>
    );
  const interval = metric.ci95 ? `[${fmt(metric.ci95[0])}, ${fmt(metric.ci95[1])}]` : <span className="text-ink-faint">no interval — {metric.method}</span>;
  return (
    <Fields
      labelWidth={LABEL_COLUMN}
      rows={[
        ["Value", <span className="tabular">{fmt(metric.value)}</span>],
        ["95% CI", interval],
        ["SE", metric.se === null ? <span className="text-ink-faint">n/a — {metric.method}</span> : <span className="tabular">{fmt(metric.se)}</span>],
        ["N", <span className="tabular">{metric.n}</span>],
        ["Method", metric.method],
      ]}
    />
  );
}

/** Every usage field is nullable; a null one is always paired with `nullReason` (schema
 * guarantee), so a null cell renders the reason instead of a blank or a zero. */
export function UsageFields({ usage, layout = "fields" }: { usage: UsageRecord; layout?: FieldLayout }) {
  if (layout === "inline") {
    const reason = usage.nullReason ? ` — ${usage.nullReason}` : "";
    if (usage.inputTokens === null && usage.outputTokens === null) return <span className="text-ink-faint">usage unavailable{reason}</span>;
    const missing = usage.inputTokens === null || usage.outputTokens === null;
    return (
      <span className="tabular text-ink-faint">
        {usage.inputTokens ?? "unavailable"} in / {usage.outputTokens ?? "unavailable"} out{missing ? reason : ""}
      </span>
    );
  }
  const cell = (v: number | string | null) => (v === null ? <span className="text-ink-faint">unavailable{usage.nullReason ? ` — ${usage.nullReason}` : ""}</span> : <span className="tabular">{v}</span>);
  return (
    <Fields
      rows={[
        ["Source", usage.source],
        ["Input tokens", cell(usage.inputTokens)],
        ["Output tokens", cell(usage.outputTokens)],
        ["Request model", cell(usage.requestModel)],
        ["Response model", cell(usage.responseModel)],
        ["Latency", cell(usage.latencyMs === null ? null : `${usage.latencyMs} ms`)],
      ]}
    />
  );
}
