/**
 * ChainSource — versioned authored-form root contracts (ADR-001).
 *
 * A ChainSource is any versioned root contract that deterministically
 * resolves to one chain shape. Four variants exist; none is privileged:
 *
 *   - TemplateChainSource  — reference to a shipped template/formula asset
 *   - JsonChainSource      — user-authored JSON carrying an inline topology
 *   - AdHocChainSource     — persisted, versioned agent/composer composition
 *   - ImportedWorkflowSource — imported external formula artifact
 *
 * Skills, reports and session transcripts are evidence, never sources.
 * Every variant carries `schema_version`, a stable `source_id` and a
 * provenance block. Source-specific metadata lives in `source_metadata`
 * and is dropped by normalization — it must never leak into the
 * normalized ChainDefinition.
 */

import { z } from "zod";

export const CHAIN_SOURCE_SCHEMA_VERSION = "xtrm.chain-source.v1" as const;

export const KebabCase = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "must be kebab-case");
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver");
/** Opaque reference — pointer-first; never dereferenced by the contract layer. */
export const OpaqueRef = z.string().min(1);

export const SchemaVersion = z
  .string()
  .refine((v) => v === CHAIN_SOURCE_SCHEMA_VERSION, {
    message: `unsupported schema_version; supported: ${CHAIN_SOURCE_SCHEMA_VERSION}`,
  });

/**
 * Common provenance for every variant. Values are opaque pointers;
 * provenance travels with the source but is excluded from logical-
 * topology equivalence (see normalize.ts).
 */
export const SourceProvenanceSchema = z
  .object({
    origin: z.string().min(1),
    created_at: z.string().datetime().optional(),
    author_ref: OpaqueRef.optional(),
    refs: z.array(OpaqueRef).optional(),
  })
  .strict();

const SourceEnvelope = {
  schema_version: SchemaVersion,
  source_id: KebabCase,
  /** Human-readable chain name carried into normalized metadata. */
  name: KebabCase,
  version: SemVer,
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  provenance: SourceProvenanceSchema,
};

/**
 * Authored policy inputs. These are REQUESTS the compiler may honor,
 * expand or reject — they bind nothing by themselves.
 */
export const PolicyInputsSchema = z
  .object({
    /** SCRUTINY floor request. Floor-only-raise is a compiler concern. */
    scrutiny: z.enum(["none", "low", "medium", "high"]).optional(),
    budget: z
      .object({
        max_steps: z.number().int().positive().optional(),
        max_total_retries: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inline topology payload — shared by Json / AdHoc / Imported variants.
// The template variant references a catalog asset instead; its shape
// resolution happens in the ChainLoader (xtrm-qcy.2).
// ---------------------------------------------------------------------------

export const SpecialistRefSchema = z
  .object({
    name: KebabCase,
    version: SemVer.optional(),
  })
  .strict();

/** Deterministic (non-model) executor reference. */
export const ExecutorRefSchema = z
  .object({
    kind: z.literal("deterministic"),
    ref: z.string().min(1),
  })
  .strict();

/**
 * Capability REQUESTS. Requesting is not granting — grants are computed at
 * compile/activation time from specialist requests + step policy + operator
 * policy + runtime capabilities. This contract has no grant vocabulary on
 * purpose; unknown keys are rejected by `.strict()`.
 */
export const CapabilityRequestsSchema = z
  .object({
    required_tools: z.array(z.string().min(1)).optional(),
    required_skills: z.array(KebabCase).optional(),
  })
  .strict();

/** Result/evidence requirements — pointer-first, opaque kinds. */
export const ResultRequirementsSchema = z
  .object({
    evidence_required: z.boolean().default(true),
    evidence_kinds: z.array(z.string().min(1)).optional(),
    output_schema_ref: OpaqueRef.optional(),
  })
  .strict();

/**
 * Explicit human/operator gate on a step. The operator decision is an
 * authored requirement; how it blocks progression is runtime semantics.
 */
export const OperatorGateSchema = z
  .object({
    instructions: z.string().min(1).optional(),
  })
  .strict();

/**
 * Bounded remediation loop declaration. `max_iterations` makes the bound
 * explicit; unbounded loops are not expressible.
 */
export const RemediationLoopSchema = z
  .object({
    back_to: KebabCase,
    max_iterations: z.number().int().min(1).max(10),
  })
  .strict();

/**
 * Gate/verdict routing edges. Routes are declared ON the gate step itself
 * and reference that same step as `gate` (validated in
 * `validateInlineTopology`). Duplicate `(gate, verdict)` pairs are
 * rejected — a verdict has exactly one authored continuation.
 *
 * Recorded precedence decision (binding for the qcy.3 compiler): when a
 * step declares both a remediation loop and fail-routes, the remediation
 * loop consumes its `max_iterations` budget FIRST; route evaluation
 * applies only after remediation budget exhaustion. This is an authored
 * declaration order, not scheduler state.
 */
export const VerdictRouteSchema = z
  .object({
    gate: KebabCase,
    verdict: z.enum(["pass", "fail", "escalate"]),
    target: KebabCase,
  })
  .strict();

/**
 * Authored position classes. "coordinator" is a structural class, not a role
 * (decision record: docs/design/qcy-f1-coordinator-vocabulary.md): coordinator
 * entry/close positions author as class "coordinator" and round-trip verbatim;
 * runtime authority seams already consume it (ParticipantClass includes
 * "coordinator"; channel-comm COORDINATOR_CLASSES gates coordinator powers).
 */
export const StepClassSchema = z.enum(["step", "gate", "advisor", "coordinator"]);

/**
 * One authored logical step. Identity is the stable logical `step_id`;
 * no physical job/session/attempt/bead IDs are expressible here.
 */
export const AuthoredStepSchema = z
  .object({
    step_id: KebabCase,
    class: StepClassSchema.default("step"),
    title: z.string().min(1).optional(),
    /** Exactly one of specialist / executor (superRefine below). */
    specialist: SpecialistRefSchema.optional(),
    executor: ExecutorRefSchema.optional(),
    depends_on: z.array(KebabCase).default([]),
    routes: z.array(VerdictRouteSchema).default([]),
    remediation: RemediationLoopSchema.optional(),
    capability_requests: CapabilityRequestsSchema.optional(),
    result_requirements: ResultRequirementsSchema.optional(),
    operator_gate: OperatorGateSchema.optional(),
    policy_inputs: PolicyInputsSchema.optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (!step.specialist && !step.executor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["specialist"],
        message: "step requires exactly one of specialist or executor",
      });
    }
    if (step.specialist && step.executor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executor"],
        message: "step requires exactly one of specialist or executor",
      });
    }
  });

export const InlineTopologySchema = z
  .object({
    entry_step: KebabCase,
    steps: z.array(AuthoredStepSchema).min(1),
    policy: PolicyInputsSchema.default({}),
  })
  .strict();

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const TemplateChainSourceSchema = z
  .object({
    ...SourceEnvelope,
    source_kind: z.literal("template"),
    template: z
      .object({
        name: KebabCase,
        version: SemVer.optional(),
        catalog_ref: OpaqueRef.optional(),
      })
      .strict(),
    /** Author-supplied variable substitutions resolved at load time. */
    vars: z.record(z.string()).optional(),
    // TODO(xtrm-qcy.2): typed override vocabulary lands with the ChainLoader.
    overrides: z.array(z.unknown()).default([]),
    policy: PolicyInputsSchema.default({}),
    source_metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export const JsonChainSourceSchema = z
  .object({
    ...SourceEnvelope,
    source_kind: z.literal("json"),
    topology: InlineTopologySchema,
    source_metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export const AdHocChainSourceSchema = z
  .object({
    ...SourceEnvelope,
    source_kind: z.literal("adhoc"),
    /** Composition context — persisted with the source, not the definition. */
    composition: z
      .object({
        composer_participant: OpaqueRef.optional(),
        session_evidence_ref: OpaqueRef.optional(),
      })
      .strict()
      .optional(),
    topology: InlineTopologySchema,
    source_metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export const ImportedWorkflowSourceSchema = z
  .object({
    ...SourceEnvelope,
    source_kind: z.literal("imported"),
    import_ref: z.object({ path: z.string().min(1), sha256: z.string().length(64) }).strict(),
    topology: InlineTopologySchema,
    source_metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export const ChainSourceSchema = z.discriminatedUnion("source_kind", [
  TemplateChainSourceSchema,
  JsonChainSourceSchema,
  AdHocChainSourceSchema,
  ImportedWorkflowSourceSchema,
]);

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;
export type PolicyInputs = z.infer<typeof PolicyInputsSchema>;
export type AuthoredStep = z.infer<typeof AuthoredStepSchema>;
export type InlineTopology = z.infer<typeof InlineTopologySchema>;
export type TemplateChainSource = z.infer<typeof TemplateChainSourceSchema>;
export type JsonChainSource = z.infer<typeof JsonChainSourceSchema>;
export type AdHocChainSource = z.infer<typeof AdHocChainSourceSchema>;
export type ImportedWorkflowSource = z.infer<typeof ImportedWorkflowSourceSchema>;
export type ChainSource = z.infer<typeof ChainSourceSchema>;

/**
 * Structural referential validation over an inline topology: duplicate /
 * missing step ids, dangling depends_on / remediation / route targets.
 * Returns a list of human-readable problems (empty when valid).
 */
export function validateInlineTopology(t: InlineTopology): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of t.steps) {
    if (seen.has(s.step_id)) problems.push(`duplicate step_id: ${s.step_id}`);
    seen.add(s.step_id);
  }
  const ref = (id: string, what: string): void => {
    if (!seen.has(id)) problems.push(`${what} references nonexistent step_id: ${id}`);
  };
  for (const s of t.steps) {
    for (const d of s.depends_on) {
      if (d === s.step_id) problems.push(`step ${s.step_id} depends on itself`);
      ref(d, `step ${s.step_id} depends_on`);
    }
    if (s.remediation) ref(s.remediation.back_to, `step ${s.step_id} remediation`);
    const routeKeys = new Set<string>();
    for (const r of s.routes) {
      if (r.gate !== s.step_id) {
        problems.push(`route on step ${s.step_id} must declare gate = its own step_id (${s.step_id})`);
      }
      const key = `${r.gate}|${r.verdict}`;
      if (routeKeys.has(key)) {
        problems.push(`duplicate route verdict ${r.verdict} on gate ${r.gate}`);
      }
      routeKeys.add(key);
      ref(r.target, `route on step ${s.step_id} (target)`);
      const gate = t.steps.find((g) => g.step_id === r.gate);
      if (gate && gate.class !== "gate") {
        problems.push(`route verdict references non-gate step ${r.gate}`);
      }
    }
  }
  if (!seen.has(t.entry_step)) problems.push(`entry_step references nonexistent step_id: ${t.entry_step}`);

  // Cycle rejection over dependency edges (routes/remediation are
  // conditional re-entry declarations bounded by max_iterations, not part
  // of the mandatory dependency graph).
  const byId = new Map(t.steps.map((s) => [s.step_id, s]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited 1=in-stack 2=done
  const visit = (id: string, path: string[]): void => {
    const st = state.get(id) ?? 0;
    if (st === 1) {
      problems.push(`dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
      return;
    }
    if (st === 2) return;
    state.set(id, 1);
    for (const d of byId.get(id)?.depends_on ?? []) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const s of t.steps) visit(s.step_id, []);

  return problems;
}
