// Narrow, defensive readers over the versioned registry definitions the run page resolves
// (Experiment / Workload / QuestionSpec `show` output — passthrough Records on the adapter).
// Same contract as manifest.ts: a missing or partially-upgraded definition renders an explicit
// "not recorded" state, never a throw or a blank.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const strList = (v: unknown): string[] | null => {
  if (!Array.isArray(v) || v.length === 0) return null;
  const items = v.filter((e): e is string => typeof e === "string" && e.length > 0);
  return items.length > 0 ? items : null;
};

export interface ExperimentSemantics {
  description: string | null;
  hypothesis: string | null;
  researchQuestion: string | null;
  primaryOutcomes: string[] | null;
  successCriteria: string[] | null;
  falsificationCriteria: string[] | null;
  nonClaims: string[] | null;
  terminology: Array<[string, string]> | null;
  legend: Array<[string, string]> | null;
}

/** The semantic fields an Experiment definition may carry. Everything is optional: an
 * experiment registered before the v2 fields still renders, just without those sections. */
export function readExperimentSemantics(def: Record<string, unknown>): ExperimentSemantics {
  const terminology = isRecord(def.terminology)
    ? (Object.entries(def.terminology).filter(([, v]) => typeof v === "string") as Array<[string, string]>)
    : null;
  const legend = isRecord(def.legend)
    ? (Object.entries(def.legend).filter(([, v]) => typeof v === "string") as Array<[string, string]>)
    : null;
  return {
    description: str(def.description),
    hypothesis: str(def.hypothesis),
    researchQuestion: str(def.research_question),
    primaryOutcomes: strList(def.primary_outcomes),
    successCriteria: strList(def.success_criteria),
    falsificationCriteria: strList(def.falsification_criteria),
    nonClaims: strList(def.non_claims),
    terminology: terminology && terminology.length > 0 ? terminology : null,
    legend: legend && legend.length > 0 ? legend : null,
  };
}

export type MetricDirection = "higher_better" | "lower_better" | "unspecified";

export interface MetricGlossaryEntry {
  label: string;
  description: string;
  unit: string | null;
  direction: MetricDirection;
  interpretation: string | null;
}

export function readMetricGlossary(def: Record<string, unknown>): Map<string, MetricGlossaryEntry> {
  const out = new Map<string, MetricGlossaryEntry>();
  const raw = def.metric_glossary;
  if (!isRecord(raw)) return out;
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const label = str(value.label);
    const description = str(value.description);
    const direction = value.direction;
    if (!label || !description) continue;
    out.set(name, {
      label,
      description,
      unit: str(value.unit),
      direction:
        direction === "higher_better" || direction === "lower_better" ? direction : "unspecified",
      interpretation: str(value.interpretation),
    });
  }
  return out;
}

export function directionGlyph(direction: MetricDirection): string {
  if (direction === "higher_better") return "↑";
  if (direction === "lower_better") return "↓";
  return "·";
}

export function directionPhrase(direction: MetricDirection): string {
  if (direction === "higher_better") return "higher is better";
  if (direction === "lower_better") return "lower is better";
  return "direction not stated";
}

export interface QuestionRef {
  id: string;
  version: string;
}

export function readQuestionRefs(def: Record<string, unknown>): QuestionRef[] {
  const raw = def.questions;
  if (!Array.isArray(raw)) return [];
  const out: QuestionRef[] = [];
  for (const q of raw) {
    if (!isRecord(q)) continue;
    const id = str(q.id);
    const version = str(q.version);
    if (id && version) out.push({ id, version });
  }
  return out;
}

/** Primitive name shown for a question type — canonical TypeSafe terminology. */
export function primitiveName(type: string | null): string {
  return type === "noul" || type === "choice" || type === "score" ? type : "unknown";
}

/** A criteria object on a QuestionSpec, rendered as its string entries: a Noul carries
 * `true`/`false` boundaries, a Choice its option criteria, a Score its level legend. */
export function readCriteriaEntries(criteria: unknown): Array<[string, string]> | null {
  if (!isRecord(criteria)) return null;
  const entries = Object.entries(criteria)
    .map(([k, v]): [string, string] | null => {
      if (typeof v === "string" && v.length > 0) return [k, v];
      if (v === null || v === undefined) return [k, ""];
      if (isRecord(v)) {
        // A Choice option criterion may itself be structured ({true:..., false:...}-shaped).
        const inner = Object.entries(v)
          .filter(([, iv]) => typeof iv === "string")
          .map(([ik, iv]) => `${ik}: ${iv}`)
          .join("; ");
        return inner ? [k, inner] : null;
      }
      return null;
    })
    .filter((e): e is [string, string] => e !== null);
  return entries.length > 0 ? entries : null;
}

export interface RunIntent {
  purpose: string | null;
  rationale: string | null;
  trigger: string | null;
}

export function readRunIntent(manifest: Record<string, unknown>): RunIntent {
  const intent = isRecord(manifest.intent) ? manifest.intent : {};
  return {
    purpose: str(intent.purpose),
    rationale: str(intent.rationale),
    trigger: str(intent.trigger),
  };
}

export interface ResultSummaryAnnotation {
  plainLanguage: string;
  supportedClaims: string[];
  unsupportedClaims: string[];
  caveats: string[];
  decision: string;
  evidenceStatus: string | null;
}

/** The latest `result_summary` annotation on a run, or null. */
export function readResultSummary(annotations: Array<Record<string, unknown>>): ResultSummaryAnnotation | null {
  const summaries = annotations.filter((a) => a.kind === "result_summary");
  const last = summaries[summaries.length - 1];
  if (!last || !isRecord(last.result_summary)) return null;
  const block = last.result_summary;
  const plain = str(block.plain_language);
  if (!plain) return null;
  return {
    plainLanguage: plain,
    supportedClaims: strList(block.supported_claims) ?? [],
    unsupportedClaims: strList(block.unsupported_claims) ?? [],
    caveats: strList(block.caveats) ?? [],
    decision: str(block.decision) ?? "",
    evidenceStatus: str(last.evidence_status),
  };
}
