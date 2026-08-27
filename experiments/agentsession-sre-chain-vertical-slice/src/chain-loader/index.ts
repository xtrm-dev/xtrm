/**
 * ChainLoader (xtrm-qcy.2) — resolves every ChainSource variant into a
 * normalized ChainDefinition through the qcy.1 contracts machinery.
 *
 * Scope (ADR-001, runtime PRD R1.1, decision-matrix Q24/Q25/Q26):
 *
 *   1. Formula assets — the 15 shipped `.formula.json` compatibility
 *      templates are parsed deterministically into ImportedWorkflowSource
 *      envelopes with inline topologies, then run through
 *      `normalizeImportedSource` so every qcy.1 invariant applies unchanged.
 *   2. Template resolution — a TemplateChainSource carries only a catalog
 *      reference; the loader resolves the referenced formula asset into the
 *      concrete inline shape (`normalizeFromResolvedTemplate`).
 *   3. Ad-hoc sources — persisted typed compositions enter through
 *      `loadAdHocSource` (`normalizeAdhocSource`), same normalization path.
 *   4. Change-contract roots (Q25) — the loader accepts an ALREADY-PARSED
 *      `xt spec` change-contract object (plain JS object; YAML parsing is
 *      owned by `xt spec`, never this module).
 *
 * All four ChainSource variants reach one ChainDefinition here.
 * PRECEDENCE RULE ("formula wins executable shape"): the `.formula.json`
 * asset content ALONE determines the resolved shape. Prose docs, catalog
 * metadata, READMEs and dispatcher labels never alter it. Labels other than
 * `kind:` / `role:` / `advisor:` / `gate:` (`edge:`, `type:`, `scrutiny:`,
 * …) are dispatcher metadata and are DROPPED, not interpreted.
 *
 * Mapping (deterministic, 1:1 where the schema allows):
 *   - `formula` → source_id/name (must be kebab-safe); `version:1` → "1.0.0";
 *     asset `description` → title.
 *   - step `id` → step_id; `needs[]` → depends_on. Known asset-defect
 *     repair: needs referencing steps absent from the asset (conditionally
 *     dispatched advisors) are dropped; see mapFormulaSteps.
 *   - any `gate:*` label → class "gate"; any `advisor:*` label →
 *     class "advisor", else class "step". The gate LEVEL (mandatory/final)
 *     is dispatcher metadata and is dropped (AuthoredStepSchema has no
 *     field for it). Verdict routes or remediation loops are never invented.
 *   - `role:<x>` label → specialist { name: x }.
 *   - FORCED DEVIATION: the root step carries no `role:` label in any of
 *     the 15 assets (it is the container/entry step, not a model step),
 *     but AuthoredStepSchema structurally requires exactly one of
 *     specialist/executor. The loader encodes the root as
 *     executor { kind: "deterministic", ref: "formula-root" } — the only
 *     synthesized field in the whole mapping.
 *   - Var substitution: `{{var}}` tokens in the asset description and step
 *     title/description resolve from supplied vars, falling back to
 *     declared defaults. A declared required var with no value, a var with
 *     neither value nor default, or an unknown remaining token is a
 *     deterministic rejection. Labels are never substituted (and dropped).
 *   - entry_step: the single step labeled `kind:root` (0 or ≥2 → error).
 *
 * No IO happens inside this module: callers read bytes/files and pass
 * strings or parsed objects. No runtime state appears in any output.
 */

import { createHash } from "node:crypto";
import {
  CHAIN_SOURCE_SCHEMA_VERSION,
  AdHocChainSourceSchema,
  ImportedWorkflowSourceSchema,
  JsonChainSourceSchema,
  TemplateChainSourceSchema,
  type AuthoredStep,
  type ImportedWorkflowSource,
  type InlineTopology,
  type JsonChainSource,
  type PolicyInputs,
} from "../chain-contracts/index.ts";
import {
  canonicalJson,
  NormalizationError,
  normalizeAdhocSource,
  normalizeFromResolvedTemplate,
  normalizeImportedSource,
  normalizeJsonSource,
  type ChainDefinition,
} from "../chain-contracts/index.ts";

// ---------------------------------------------------------------------------
// sha256 helper
// ---------------------------------------------------------------------------

/** sha256 over raw bytes/string, or over the canonical JSON of an object. */
export function sha256Canonical(input: unknown): string {
  const bytes =
    typeof input === "string"
      ? input
      : input instanceof Uint8Array
        ? Buffer.from(input)
        : canonicalJson(input);
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Formula asset parsing
// ---------------------------------------------------------------------------

/** Minimal structural expectations for one formula step (pre-mapping). */
interface FormulaStep {
  id: string;
  title?: string;
  description?: string;
  needs?: string[];
  labels?: string[];
}

/** Minimal structural expectations for one `.formula.json` asset. */
export interface FormulaAsset {
  formula: string;
  type?: string;
  version?: number;
  description?: string;
  vars?: Record<string, { default?: string; required?: boolean }>;
  steps?: FormulaStep[];
}

export interface ParsedFormulaEntry {
  /** Raw parsed asset (unsubstituted), kept for per-call var resolution. */
  asset: FormulaAsset;
  /** Source path for provenance/import_ref (opaque pointer). */
  path: string;
  /** sha256 over canonical JSON of the raw asset. */
  sha256: string;
}

const TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

function substitute(text: string, vars: Record<string, string>, problems: string[]): string {
  return text.replace(TOKEN, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      problems.push(`var '${name}' has no value and no default`);
      return m;
    }
    return v;
  });
}

/**
 * Resolve effective vars: supplied values win over declared defaults.
 * Deterministic rejections for unresolvable vars and undeclared supplies.
 */
function resolveVars(asset: FormulaAsset, supplied: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const unknownSupplied = Object.keys(supplied ?? {}).filter((k) => !(k in (asset.vars ?? {})));
  if (unknownSupplied.length > 0) {
    throw new NormalizationError(unknownSupplied.map((k) => `supplied var '${k}' is not declared by the formula`));
  }
  for (const [name, spec] of Object.entries(asset.vars ?? {})) {
    const v = supplied?.[name] ?? spec.default;
    if (v === undefined) {
      throw new NormalizationError([
        spec.required ? `required var '${name}' has no value and no default` : `var '${name}' has no value and no default`,
      ]);
    }
    out[name] = v;
  }
  return out;
}

function mapFormulaSteps(
  asset: FormulaAsset,
  vars: Record<string, string>,
): { steps: AuthoredStep[]; entryStep: string } {
  if (!Array.isArray(asset.steps) || asset.steps.some((s) => s === null || typeof s !== "object")) {
    throw new NormalizationError(["formula asset 'steps' must be an array of step objects"]);
  }
  const problems: string[] = [];
  const steps: AuthoredStep[] = [];

  const roots = asset.steps.filter((s) => (s.labels ?? []).includes("kind:root"));
  if (roots.length === 0) problems.push("no step labeled 'kind:root' — cannot determine entry_step");
  if (roots.length > 1) problems.push(`multiple 'kind:root' steps: ${roots.map((r) => r.id).join(", ")}`);
  const ids = new Set(asset.steps.map((s) => s.id));

  for (const s of asset.steps ?? []) {
    // Labels are substituted too (e.g. research-only declares
    // "role:{{specialist}}") and then reduced: kind:/role:/advisor:/gate:
    // drive mapping; every other label is dispatcher metadata and is dropped.
    const labels = (s.labels ?? []).map((l) => substitute(l, vars, problems));
    const isRoot = labels.includes("kind:root");
    const isGate = labels.some((l) => l.startsWith("gate:"));
    const isAdvisor = labels.some((l) => l.startsWith("advisor:"));
    const role = labels.find((l) => l.startsWith("role:"))?.slice("role:".length);
    const title = s.title !== undefined ? substitute(s.title, vars, problems) : undefined;
    // Description text is substituted purely to enforce var-token
    // validity; AuthoredStepSchema has no description slot (mandate prose
    // is dispatcher-level), so it is dropped from the mapped step.
    const description = s.description !== undefined ? substitute(s.description, vars, problems) : undefined;
    void description;

    steps.push({
      step_id: s.id,
      class: isGate ? "gate" : isAdvisor ? "advisor" : "step",
      ...(title !== undefined && title.length > 0 ? { title } : {}),
      // Root carries no role label in any shipped formula; the authored-form
      // schema requires exactly one of specialist/executor (see docblock).
      ...(isRoot
        ? { executor: { kind: "deterministic" as const, ref: "formula-root" } }
        : role
          ? { specialist: { name: role } }
          : {}),
      // Deterministic repair for a known formula-asset defect class
      // (the dangling-advisor-needs instance in code-with-advisors; ADR-001
      // §5 names this defect family and sanctions its repair during
      // migration): some assets declare needs on CONDITIONALLY DISPATCHED
      // steps that do not exist in the asset itself. Dangling needs are dropped so the qcy.1 referential validation sees
      // the authored shape the asset actually contains; existing ids pass
      // through untouched.
      depends_on: (s.needs ?? []).filter((n) => ids.has(n)),
      routes: [],
    });
  }

  if (problems.length > 0) throw new NormalizationError(problems);
  return { steps, entryStep: roots[0]!.id };
}

/**
 * Map a parsed formula asset onto an inline topology + envelope metadata.
 * Pure: no IO, no clocks. Throws NormalizationError on any mapping problem.
 */
function mapFormula(
  asset: FormulaAsset,
  suppliedVars: Record<string, string> | undefined,
): { sourceId: string; version: string; title?: string; topology: InlineTopology } {
  if (typeof asset.formula !== "string" || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(asset.formula)) {
    throw new NormalizationError([`formula name must be kebab-case, got: ${JSON.stringify(asset.formula)}`]);
  }
  const vars = resolveVars(asset, suppliedVars);
  const problems: string[] = [];
  const description = asset.description !== undefined ? substitute(asset.description, vars, problems) : undefined;
  if (problems.length > 0) throw new NormalizationError(problems);
  const { steps, entryStep } = mapFormulaSteps(asset, vars);
  return {
    sourceId: asset.formula,
    version: asset.version === undefined ? "1.0.0" : `${asset.version}.0.0`,
    ...(description !== undefined && description.length > 0 ? { title: description } : {}),
    topology: { entry_step: entryStep, steps, policy: {} },
  };
}

/**
 * Parse one formula asset into an ImportedWorkflowSource envelope with an
 * inline topology (schema-validated). Callers then call
 * `normalizeImportedSource(source)` to obtain the ChainDefinition.
 */
export function parseFormulaAsset(
  json: unknown,
  opts: { path?: string; vars?: Record<string, string> } = {},
): ImportedWorkflowSource {
  if (typeof json === "string") {
    json = JSON.parse(json);
  } else if (json instanceof Uint8Array) {
    json = JSON.parse(Buffer.from(json).toString("utf8"));
  }
  const asset = json as FormulaAsset;
  const mapped = mapFormula(asset, opts.vars);
  // import_ref.path is an opaque pointer; without a caller-supplied path we
  // point at the formula name itself.
  const path = opts.path ?? mapped.sourceId;
  return ImportedWorkflowSourceSchema.parse({
    schema_version: CHAIN_SOURCE_SCHEMA_VERSION,
    source_id: mapped.sourceId,
    name: mapped.sourceId,
    version: mapped.version,
    ...(mapped.title !== undefined ? { title: mapped.title } : {}),
    provenance: { origin: `file:${path}` },
    source_kind: "imported",
    import_ref: { path, sha256: sha256Canonical(json) },
    topology: mapped.topology,
  });
}

/** Parse and normalize in one step (the common path). */
export function loadFormulaAsset(
  json: unknown,
  opts: { path?: string; vars?: Record<string, string> } = {},
): ChainDefinition {
  return normalizeImportedSource(parseFormulaAsset(json, opts));
}

// ---------------------------------------------------------------------------
// Ad-hoc sources (persisted typed compositions)
// ---------------------------------------------------------------------------

/**
 * Load a persisted AdHocChainSource (typed composition saved before
 * execution; PRD §2/R1.1). Input is the already-persisted source object
 * (parsed JSON); schema validation and normalization go through the
 * shared qcy.1 path exactly like every other variant. Schema violations
 * surface as NormalizationError like every other mapping problem.
 */
export function loadAdHocSource(source: unknown): ChainDefinition {
  const parsed = AdHocChainSourceSchema.safeParse(source);
  if (!parsed.success) {
    throw new NormalizationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return normalizeAdhocSource(parsed.data);
}

// ---------------------------------------------------------------------------
// Catalog + template resolution
// ---------------------------------------------------------------------------

/**
 * Build a formula catalog keyed by formula name. Entries are raw parsed
 * assets, or JSON bytes/strings with an optional path. The asset content
 * alone determines shape (precedence rule above) — nothing else is read.
 */
export function buildFormulaCatalog(
  entries: Array<{ asset?: unknown; bytes?: string | Uint8Array; path?: string }>,
): Map<string, ParsedFormulaEntry> {
  const catalog = new Map<string, ParsedFormulaEntry>();
  for (const e of entries) {
    let json: unknown = e.asset;
    if (json === undefined) {
      if (e.bytes === undefined) throw new Error("catalog entry needs 'asset' or 'bytes'");
      json = JSON.parse(typeof e.bytes === "string" ? e.bytes : Buffer.from(e.bytes).toString("utf8"));
    }
    const asset = json as FormulaAsset;
    if (typeof asset.formula !== "string") {
      throw new NormalizationError([`catalog entry missing 'formula' name${e.path ? ` (${e.path})` : ""}`]);
    }
    catalog.set(asset.formula, { asset, path: e.path ?? "", sha256: sha256Canonical(json) });
  }
  return catalog;
}

export interface TemplateRef {
  template: { name: string; version?: string; catalog_ref?: string };
  /** Author-supplied substitutions; override asset defaults. */
  vars?: Record<string, string>;
  policy?: PolicyInputs;
}

/**
 * Resolve a template reference against a catalog and normalize it.
 * Unknown template name → NormalizationError; when `version` is supplied
 * it must equal the formula's mapped semver (1 → "1.0.0") or the load
 * fails explicitly.
 */
export function loadTemplate(ref: TemplateRef, catalog: Map<string, ParsedFormulaEntry>): ChainDefinition {
  const entry = catalog.get(ref.template.name);
  if (!entry) {
    throw new NormalizationError([`unknown template '${ref.template.name}' in catalog (${catalog.size} entries)`]);
  }
  const mappedVersion = entry.asset.version === undefined ? "1.0.0" : `${entry.asset.version}.0.0`;
  if (ref.template.version !== undefined && ref.template.version !== mappedVersion) {
    throw new NormalizationError([
      `template '${ref.template.name}' requested at version ${ref.template.version}; catalog has ${mappedVersion}`,
    ]);
  }
  const mapped = mapFormula(entry.asset, ref.vars);
  const source = TemplateChainSourceSchema.parse({
    schema_version: CHAIN_SOURCE_SCHEMA_VERSION,
    source_id: mapped.sourceId,
    name: mapped.sourceId,
    version: mapped.version,
    ...(mapped.title !== undefined ? { title: mapped.title } : {}),
    provenance: {
      origin: entry.path.length > 0 ? `catalog:${entry.path}` : `catalog:${ref.template.catalog_ref ?? mapped.sourceId}`,
    },
    source_kind: "template",
    template: {
      name: ref.template.name,
      ...(ref.template.version !== undefined ? { version: ref.template.version } : {}),
      ...(ref.template.catalog_ref !== undefined ? { catalog_ref: ref.template.catalog_ref } : {}),
    },
    ...(ref.vars !== undefined ? { vars: ref.vars } : {}),
    policy: ref.policy ?? {},
  });
  return normalizeFromResolvedTemplate(source, mapped.topology);
}

// ---------------------------------------------------------------------------
// Change-contract roots (Q25)
// ---------------------------------------------------------------------------

/**
 * Load a change-contract ROOT already parsed out of spec.yaml by `xt spec`.
 * This module NEVER parses YAML. Recognized fields:
 *
 *   - recommended_template?: kebab template name (+ optional
 *     recommended_template_version) — resolved against the catalog as the
 *     base shape (Pass-2 annotation → template wins as promoted default).
 *   - steps?: inline authored steps (AuthoredStep-compatible) with optional
 *     entry_step (default "root"), policy, vars — treated as
 *     json-equivalent authored topology.
 *   - Both present → error (ambiguous base shape). Neither → error.
 *   - Envelope overrides: source_id?, name?, version?, description?, origin?.
 *     Defaults: source_id/name "change-contract", version "0.1.0".
 */
export function loadChangeContractRoot(
  root: Record<string, unknown>,
  catalog: Map<string, ParsedFormulaEntry>,
): ChainDefinition {
  const hasTemplate = typeof root.recommended_template === "string";
  const hasInline = Array.isArray(root.steps);
  if (hasTemplate && hasInline) {
    throw new NormalizationError(["change-contract declares both recommended_template and inline steps — ambiguous base shape"]);
  }
  if (!hasTemplate && !hasInline) {
    throw new NormalizationError(["change-contract declares neither recommended_template nor inline steps"]);
  }

  if (hasTemplate) {
    return loadTemplate(
      {
        template: {
          name: root.recommended_template as string,
          ...(typeof root.recommended_template_version === "string"
            ? { version: root.recommended_template_version }
            : {}),
        },
        ...(root.vars !== undefined ? { vars: root.vars as Record<string, string> } : {}),
        ...(root.policy !== undefined ? { policy: root.policy as PolicyInputs } : {}),
      },
      catalog,
    );
  }

  const sourceId = typeof root.source_id === "string" ? root.source_id : "change-contract";
  const source: JsonChainSource = JsonChainSourceSchema.parse({
    schema_version: CHAIN_SOURCE_SCHEMA_VERSION,
    source_id: sourceId,
    name: typeof root.name === "string" ? root.name : sourceId,
    version: typeof root.version === "string" ? root.version : "0.1.0",
    ...(typeof root.description === "string" ? { description: root.description } : {}),
    provenance: { origin: typeof root.origin === "string" ? root.origin : "change-contract:inline" },
    source_kind: "json",
    topology: {
      entry_step: typeof root.entry_step === "string" ? root.entry_step : "root",
      steps: root.steps,
      policy: (root.policy as PolicyInputs | undefined) ?? {},
    },
  });
  return normalizeJsonSource(source);
}
