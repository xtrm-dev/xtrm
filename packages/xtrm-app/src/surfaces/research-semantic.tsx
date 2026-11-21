// Semantic sections for the run analysis surface (board rerun, Jira XTRM-99 c.13438).
//
// Every section renders from the run's *versioned definitions* (Experiment / Workload /
// QuestionSpec), resolved through the research adapter — never from prose copied into the
// run manifest. Missing v2 fields render nothing rather than a placeholder, so a pre-v2
// experiment keeps its old page shape. The first viewport answers why / what happened /
// what it means; provenance stays below (see ResearchSurface).
import { useResearchQuestionSpec } from "../app/queries.ts";
import { MetricFields } from "./research-format.tsx";
import { Badge } from "../ui/badge.tsx";
import { Row } from "../ui/primitives.tsx";
import { SectionHeader } from "../ui/section.tsx";
import {
  directionGlyph,
  directionPhrase,
  primitiveName,
  readCriteriaEntries,
  type ExperimentSemantics,
  type MetricGlossaryEntry,
  type ResultSummaryAnnotation,
  type RunIntent,
} from "../adapters/research/semantics.ts";
import type { QuestionRef } from "../adapters/research/semantics.ts";
import type { Metric } from "../adapters/research/types.ts";
import { readVersionRef } from "../adapters/research/manifest.ts";

/** One run-page block: the shared section header over prose that starts at the page gutter. The
 * `aria-label` stays on the wrapper because these blocks are addressed as regions ("Result",
 * "Method"), and a heading alone does not name a region. */
function SemanticSection({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col px-3">
      <SectionHeader
        title={title}
        level={2}
        inset="none"
        className="mb-2"
        aside={hint ? <span className="text-xs text-ink-faint">{hint}</span> : undefined}
      />
      <div className="text-sm">{children}</div>
    </section>
  );
}

function Bullets({ items, tone = "ink-muted" }: { items: string[]; tone?: string }) {
  return (
    <ul className="ml-5 list-disc space-y-1">
      {items.map((item, i) => (
        <li key={i} className={`text-${tone === "ink-muted" ? "ink-muted" : "ink"} leading-snug`}>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** WHY — research question, hypothesis, and why this concrete run happened. */
export function ResearchQuestionSection({
  experiment,
  intent,
  runId,
}: {
  experiment: ExperimentSemantics | null;
  intent: RunIntent;
  runId: string;
}) {
  if (!experiment?.researchQuestion && !experiment?.hypothesis && !intent.purpose && !intent.rationale) return null;
  return (
    <SemanticSection title="Why this run" hint={runId}>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
        {experiment?.researchQuestion && (
          <>
            <dt className="text-ink-faint">Research question</dt>
            <dd className="text-ink">{experiment.researchQuestion}</dd>
          </>
        )}
        {experiment?.hypothesis && (
          <>
            <dt className="text-ink-faint">Hypothesis</dt>
            <dd className="text-ink">{experiment.hypothesis}</dd>
          </>
        )}
        {intent.purpose && (
          <>
            <dt className="text-ink-faint">Run purpose</dt>
            <dd className="text-ink-muted">{intent.purpose}</dd>
          </>
        )}
        {intent.rationale && (
          <>
            <dt className="text-ink-faint">Why now</dt>
            <dd className="text-ink-muted">{intent.rationale}</dd>
          </>
        )}
        {experiment?.terminology && (
          <>
            <dt className="text-ink-faint self-start pt-0.5">Terminology</dt>
            <dd>
              <dl className="space-y-0.5">
                {experiment.terminology.map(([term, definition]) => (
                  <div key={term} className="flex gap-2 text-xs leading-snug">
                    <dt className="shrink-0 font-mono text-ink">{term}</dt>
                    <dd className="text-ink-faint">{definition}</dd>
                  </div>
                ))}
              </dl>
            </dd>
          </>
        )}
      </dl>
    </SemanticSection>
  );
}

/** WHAT WOULD COUNT — pre-registered interpretation criteria and non-claims. */
export function DecisionCriteriaSection({ experiment }: { experiment: ExperimentSemantics | null }) {
  if (!experiment) return null;
  const { primaryOutcomes, successCriteria, falsificationCriteria, nonClaims } = experiment;
  if (!primaryOutcomes && !successCriteria && !falsificationCriteria && !nonClaims) return null;
  return (
    <SemanticSection title="What would count">
      <div className="flex flex-col gap-1.5">
        {primaryOutcomes && (
          <p className="text-ink-muted">
            <span className="text-ink-faint">Primary outcomes: </span>
            <span className="font-mono text-xs">{primaryOutcomes.join(", ")}</span>
          </p>
        )}
        {successCriteria && (
          <div>
            <p className="text-xs text-ink-faint">Supports the hypothesis if</p>
            <Bullets items={successCriteria} />
          </div>
        )}
        {falsificationCriteria && (
          <div>
            <p className="text-xs text-ink-faint">Falsifies the hypothesis if</p>
            <Bullets items={falsificationCriteria} />
          </div>
        )}
        {nonClaims && (
          <div>
            <p className="text-xs text-ink-faint">This experiment does not establish</p>
            <Bullets items={nonClaims} />
          </div>
        )}
      </div>
    </SemanticSection>
  );
}

/** WHAT HAPPENED / WHAT IT MEANS — the structured post-evidence result summary. */
export function ResultSummarySection({ summary }: { summary: ResultSummaryAnnotation | null }) {
  if (!summary) return null;
  return (
    <SemanticSection title="Result" hint={summary.evidenceStatus ? `evidence: ${summary.evidenceStatus}` : undefined}>
      <p className="mb-2 leading-snug text-ink">{summary.plainLanguage}</p>
      <div className="flex flex-col gap-1.5">
        {summary.supportedClaims.length > 0 && (
          <div>
            <p className="text-xs text-ink-faint">Supported by this evidence</p>
            <Bullets items={summary.supportedClaims} />
          </div>
        )}
        {summary.unsupportedClaims.length > 0 && (
          <div>
            <p className="text-xs text-ink-faint">Not established</p>
            <Bullets items={summary.unsupportedClaims} />
          </div>
        )}
        {summary.caveats.length > 0 && (
          <div>
            <p className="text-xs text-ink-faint">Caveats</p>
            <Bullets items={summary.caveats} />
          </div>
        )}
        {summary.decision && (
          <p className="mt-1 border-t border-border-muted pt-1.5 text-ink-muted">
            <span className="text-xs text-ink-faint">Decision: </span>
            {summary.decision}
          </p>
        )}
      </div>
    </SemanticSection>
  );
}

function QuestionSpecRow({ q }: { q: QuestionRef }) {
  const spec = useResearchQuestionSpec(q.id, q.version);
  if (spec.isPending) return null;
  const def = spec.data;
  if (!def) return null;
  const type = typeof def.type === "string" ? def.type : null;
  const instructions = typeof def.instructions === "string" ? def.instructions : null;
  const criteria = readCriteriaEntries(def.criteria);
  const options = Array.isArray(def.options) ? (def.options.filter((o) => typeof o === "string") as string[]) : [];
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline gap-2">
        <Badge size="xs" mono>{primitiveName(type)}</Badge>
        <span className="font-mono text-xs text-ink">{q.id}</span>
        <span className="text-xs text-ink-faint">{q.version}</span>
      </div>
      {instructions && <p className="text-xs leading-snug text-ink-muted">{instructions}</p>}
      {criteria && (
        <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 text-xs leading-snug">
          {criteria.map(([k, v]) => (
            <div key={k} className="col-span-2 grid grid-cols-subgrid">
              <dt className="font-mono text-ink-faint">{k}</dt>
              <dd className="text-ink-faint">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {options.length > 0 && <p className="font-mono text-xs text-ink-faint">{options.join(" | ")}</p>}
    </div>
  );
}

/** HOW — dataset, workload, variant, backend, and the System One question battery with the
 * actual primitive types, instructions and criteria/legend from the frozen QuestionSpecs. */
export function MethodSection({
  manifest,
  workloadDef,
}: {
  manifest: Record<string, unknown>;
  workloadDef: Record<string, unknown> | undefined;
}) {
  const dataset = readVersionRef(manifest.dataset);
  const variant = readVersionRef(manifest.variant);
  const workload = readVersionRef(manifest.workload);
  const backend = typeof manifest.backend === "object" && manifest.backend !== null ? (manifest.backend as Record<string, unknown>) : null;
  const questions = workloadDef ? (Array.isArray(workloadDef.questions) ? workloadDef.questions : []) : [];
  const refs = questions
    .map((q) => (typeof q === "object" && q !== null ? (q as Record<string, unknown>) : null))
    .filter((q): q is Record<string, unknown> => q !== null)
    .map((q) => ({ id: String(q.id ?? ""), version: String(q.version ?? "") }))
    .filter((q) => q.id && q.version);
  return (
    <SemanticSection title="Method">
      <dl className="mb-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-ink-faint">Dataset</dt>
        <dd className="text-ink">{dataset ? `${dataset.id}@${dataset.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Workload</dt>
        <dd className="text-ink">{workload ? `${workload.id}@${workload.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Variant</dt>
        <dd className="text-ink">{variant ? `${variant.id}@${variant.version}` : <span className="text-ink-faint">unresolved</span>}</dd>
        <dt className="text-ink-faint">Backend</dt>
        <dd className="font-mono text-xs text-ink-muted">
          {backend
            ? [String(backend.provider ?? "?"), String(backend.model ?? "?"), String(backend.model_version ?? "?")].join(" · ")
            : <span className="text-ink-faint">unrecorded</span>}
        </dd>
      </dl>
      {refs.length > 0 && (
        <>
          <p className="mb-1.5 text-xs text-ink-faint">System One questions ({refs.length})</p>
          <div className="flex flex-col divide-y divide-border-muted">
            {refs.map((q) => (
              <QuestionSpecRow key={`${q.id}@${q.version}`} q={q} />
            ))}
          </div>
        </>
      )}
    </SemanticSection>
  );
}

/** HOW TO READ THE METRICS — one row per metric with its glossary meaning and direction.
 * A metric without a glossary entry renders its legend label (if any) or an explicit
 * "no recorded definition" marker, never a silently unexplained identifier. The numeric
 * fields reuse `MetricFields`, so a value never appears without its interval/method here
 * either. */
export function GlossaryMetricRow({
  name,
  metric,
  entry,
  legendLabel,
  onActivate,
}: {
  name: string;
  metric: Metric;
  entry: MetricGlossaryEntry | undefined;
  legendLabel: string | undefined;
  onActivate?: () => void;
}) {
  const meaning = entry ?? (legendLabel ? { label: legendLabel, description: legendLabel, unit: null, direction: "unspecified" as const, interpretation: null } : null);
  return (
    <Row density="list" className="h-auto items-start py-1.5" aria-label={name} onActivate={onActivate}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs text-ink-faint">{name}</span>
          {meaning && <span className="text-sm text-ink">{meaning.label}</span>}
          {entry && (
            <span className="text-xs text-ink-faint" title={directionPhrase(entry.direction)}>
              {directionGlyph(entry.direction)} {directionPhrase(entry.direction)}
              {entry.unit ? ` · ${entry.unit}` : ""}
            </span>
          )}
        </div>
        {meaning ? (
          <p className="text-xs leading-snug text-ink-faint">
            {meaning.description}
            {meaning.interpretation ? ` ${meaning.interpretation}` : ""}
          </p>
        ) : (
          <p className="text-xs text-ink-faint/70">no recorded definition for this metric</p>
        )}
        <MetricFields metric={metric} layout="inline" />
      </div>
    </Row>
  );
}
