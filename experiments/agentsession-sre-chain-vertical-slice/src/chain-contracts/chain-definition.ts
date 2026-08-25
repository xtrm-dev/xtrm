/**
 * ChainDefinition — the normalized authored form (ADR-001 §2).
 *
 * AST-like, persisted and reviewable before freeze. Contains authored
 * logical topology ONLY: stable logical step ids, dependency edges,
 * gate/verdict routing, bounded remediation declarations, capability
 * requests (never grants), result/evidence requirements, operator gates
 * and policy inputs. No physical job/session IDs, no attempt/activation/
 * scheduler state, no effect receipts, no Beads runtime IDs, no ChainRun
 * state — every schema below is `.strict()`, so runtime-only fields are
 * structurally impossible rather than merely discouraged.
 */

import { z } from "zod";
import {
  CapabilityRequestsSchema,
  ExecutorRefSchema,
  KebabCase,
  OperatorGateSchema,
  PolicyInputsSchema,
  RemediationLoopSchema,
  ResultRequirementsSchema,
  SemVer,
  SpecialistRefSchema,
  StepClassSchema,
  VerdictRouteSchema,
} from "./chain-source.ts";

export const CHAIN_DEFINITION_SCHEMA_VERSION = "xtrm.chain-definition.v1" as const;

export const DefinitionSchemaVersion = z
  .string()
  .refine((v) => v === CHAIN_DEFINITION_SCHEMA_VERSION, {
    message: `unsupported schema_version; supported: ${CHAIN_DEFINITION_SCHEMA_VERSION}`,
  });

export const DefinitionMetadataSchema = z
  .object({
    name: KebabCase,
    title: z.string().min(1).optional(),
    version: SemVer,
    description: z.string().min(1).optional(),
  })
  .strict();

/** Where this definition came from — provenance only, never semantics. */
export const DefinitionProvenanceSchema = z
  .object({
    source_kind: z.enum(["template", "json", "adhoc", "imported"]),
    source_id: KebabCase,
    origin: z.string().min(1),
  })
  .strict();

export const DefinitionStepSchema = z
  .object({
    step_id: KebabCase,
    class: StepClassSchema,
    title: z.string().min(1).optional(),
    /** Exactly one of specialist / executor. */
    specialist: SpecialistRefSchema.optional(),
    executor: ExecutorRefSchema.optional(),
    /** Sorted, deduplicated at normalization time. */
    depends_on: z.array(KebabCase),
    routes: z.array(VerdictRouteSchema),
    remediation: RemediationLoopSchema.optional(),
    capability_requests: CapabilityRequestsSchema.optional(),
    result_requirements: ResultRequirementsSchema.optional(),
    operator_gate: OperatorGateSchema.optional(),
    policy_inputs: PolicyInputsSchema.optional(),
  })
  .strict();

export const ChainDefinitionSchema = z
  .object({
    schema_version: DefinitionSchemaVersion,
    metadata: DefinitionMetadataSchema,
    provenance: DefinitionProvenanceSchema,
    topology: z
      .object({
        entry_step: KebabCase,
        steps: z.array(DefinitionStepSchema).min(1),
        policy: PolicyInputsSchema,
      })
      .strict(),
  })
  .strict();

export type ChainDefinition = z.infer<typeof ChainDefinitionSchema>;
export type DefinitionStep = z.infer<typeof DefinitionStepSchema>;

/**
 * Runtime-only field names that must never appear in an authored
 * ChainDefinition. Exported for diagnostics; `.strict()` schemas already
 * make them structurally impossible.
 */
export const RUNTIME_ONLY_FIELDS = [
  "job_id",
  "execution_id",
  "pi_session_id",
  "attempt",
  "attempts",
  "activation_state",
  "scheduler_state",
  "effect_receipts",
  "bead_id",
  "beads_id",
  "root_bead_id",
  "chain_run_state",
  "status",
  "state",
] as const;
