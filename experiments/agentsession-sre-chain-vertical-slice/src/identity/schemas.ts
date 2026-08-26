/**
 * XTRM identity & mutation-provenance semantic contracts.
 *
 * Normative source: operator robot-identities direction 2026-08-14
 * ("XTRM robot identities and provenance — implementation decision and local
 * dispatch"), implemented as an extension of the accepted XTRM v1 runtime
 * identity model (docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md).
 *
 * CORE RULES (loud, load-bearing):
 *   - Robot identities are XTRM product identities. No project namespace
 *     (Mercury or otherwise) may be hard-coded here; project actors are DATA
 *     in caller-supplied registries/fixtures only.
 *   - The external credential principal identifies the ACCESS PLANE (one
 *     shared web account per platform). It never identifies the logical
 *     actor. Many logical actors map many-to-one onto one shared principal
 *     set (`xtrm-web` is the recommended instance, not a constant).
 *   - Every identity-bearing schema below is `.strict()`: a caller smuggling
 *     actor/principal/execution fields into a mutation payload is structurally
 *     REJECTED, never ignored (same discipline as channel-comm author lane).
 *   - `legacy_unattributed` is an honest classification for pre-XTRM actions.
 *     Identity is NEVER inferred from prose, branch names, labels or models.
 */

import { z } from "zod";

export const PRINCIPAL_SET_SCHEMA_VERSION = "xtrm.principal-set.v1" as const;
export const ACTOR_SCHEMA_VERSION = "xtrm.actor.v1" as const;
export const EXECUTION_SCHEMA_VERSION = "xtrm.execution-identity.v1" as const;
export const PROVENANCE_SCHEMA_VERSION = "xtrm.provenance.v1" as const;

/** Platform systems with at least one supported binding shape. */
export const PLATFORM_SYSTEMS = ["github", "jira"] as const;

/** How the principal authenticates. Presentation-only names live separately. */
export const PRINCIPAL_TYPES = ["user", "service_account", "app"] as const;

/** Principal-set operational classes. The shared web connector plane is one of several. */
export const PRINCIPAL_SET_KINDS = [
  "shared_web_connector",
  "local_automation",
  "host_automation",
  "ops",
] as const;

export const CREDENTIAL_STORAGES = [
  "external_connector",
  "secret_store",
  "none",
] as const;

const idToken = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/@+-]*$/);

export const PrincipalBindingSchema = z
  .object({
    system: z.enum(PLATFORM_SYSTEMS),
    principal_type: z.enum(PRINCIPAL_TYPES),
    /** Immutable platform account id; null until cutover populates it. */
    immutable_account_id: z.string().min(1).nullable(),
    /** Presentation only — never used for matching. */
    display_name: z.string().min(1),
  })
  .strict();
export type PrincipalBinding = z.infer<typeof PrincipalBindingSchema>;

/**
 * One XTRM operational identity across systems. Bindings are per-platform;
 * at most one binding per platform system (superRefine below).
 */
export const PrincipalSetSchema = z
  .object({
    schema_version: z.literal(PRINCIPAL_SET_SCHEMA_VERSION),
    principal_set_id: idToken,
    kind: z.enum(PRINCIPAL_SET_KINDS),
    bindings: z.array(PrincipalBindingSchema).min(1),
    /**
     * Actor-selector expressions describing which actors MAY use this set,
     * e.g. `environment == web`. Enforcement reads the actor registry via
     * validateMutation — this field is declarative metadata, not a parser.
     */
    shared_by: z.array(z.string().min(1)).min(1),
    credential_storage: z.enum(CREDENTIAL_STORAGES),
  })
  .strict()
  .superRefine((ps, ctx) => {
    const seen = new Set<string>();
    for (const b of ps.bindings) {
      if (seen.has(b.system)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bindings"],
          message: `duplicate binding for system ${b.system}`,
        });
      }
      seen.add(b.system);
    }
  });
export type PrincipalSet = z.infer<typeof PrincipalSetSchema>;

export const ACTOR_KINDS = [
  "coordinator",
  "worker",
  "researcher",
  "reviewer",
  "relay",
  "service",
] as const;

/**
 * Logical actor: independent of model, session and credential principal.
 * `actor_id` MAY be project-scoped (e.g. `<project>/<role>`); the contract
 * itself is project-neutral.
 */
export const ActorSchema = z
  .object({
    schema_version: z.literal(ACTOR_SCHEMA_VERSION),
    actor_id: idToken,
    actor_kind: z.enum(ACTOR_KINDS),
    parent_actor_id: idToken.nullable().optional(),
    policy_profile: z.string().min(1),
    /** Principal sets this actor is authorized to act through. Fail-closed. */
    allowed_principal_sets: z.array(idToken).min(1),
    authority_source: z.string().min(1),
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;

/** Execution attempt. Retry mints a NEW execution_id/attempt; participant stays stable. */
export const ExecutionIdentitySchema = z
  .object({
    schema_version: z.literal(EXECUTION_SCHEMA_VERSION),
    execution_id: idToken,
    attempt: z.number().int().min(1),
    actor_id: idToken,
    principal_set_id: idToken,
    assignment_id: z.string().min(1),
    assignment_version: z.number().int().min(1),
    participant_id: z.string().min(1),
    parent_execution_id: idToken.nullable(),
    runtime_session_id: z.string().nullable(),
    generation: z.number().int().min(1),
    /** e.g. `jira:ISSUE-84:comment:<id>` — opaque here, rendered by projection. */
    authority_ref: z.string().min(1),
    policy_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    toolchain_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();
export type ExecutionIdentity = z.infer<typeof ExecutionIdentitySchema>;

/** Closed authorship modes. Never inferred — always resolved from trusted context. */
export const AUTHORSHIP_MODES = [
  "human_direct",
  "xtrm_web_direct",
  "xtrm_local_direct",
  "xtrm_host_direct",
  "xtrm_relay",
  "legacy_unattributed",
] as const;
export type AuthorshipMode = (typeof AUTHORSHIP_MODES)[number];

/**
 * Attribution strength. `xtrm_attested` REQUIRES an envelope signature once a
 * signer exists; an unsigned envelope must downgrade honestly (see refine in
 * ProvenanceEnvelopeSchema). A bare hash is integrity evidence only.
 */
export const ATTRIBUTION_STRENGTHS = [
  "xtrm_attested",
  "self_attested_web",
  "unattributed",
] as const;
export type AttributionStrength = (typeof ATTRIBUTION_STRENGTHS)[number];

export const ProvenanceTargetSchema = z
  .object({
    kind: z.string().min(1),
    /** Platform-assigned id AFTER the side effect returns; null while unbound. */
    external_id: z.string().nullable(),
    issue: z.string().nullable().optional(),
    repo: z.string().nullable().optional(),
  })
  .strict();
export type ProvenanceTarget = z.infer<typeof ProvenanceTargetSchema>;

export const IntegritySchema = z
  .object({
    envelope_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    signer: z.string().nullable(),
    signature: z.string().nullable(),
  })
  .strict();

/**
 * Mutation provenance envelope. Field-level rules:
 *   - authorship_mode=legacy_unattributed => actor_id=null AND
 *     attribution_strength=unattributed AND signature/signer null (honest
 *     unknown; never guessed).
 *   - any other mode => actor_id required.
 *   - attribution_strength=xtrm_attested requires signer+signature (until the
 *     attestation service is approved, callers must use self_attested_web).
 *   - principal_binding.immutable_account_id may be null only before cutover;
 *     when present it must match a binding of the referenced principal set
 *     (checked by validateMutation against trusted config, not here).
 */
export const ProvenanceEnvelopeSchema = z
  .object({
    schema_version: z.literal(PROVENANCE_SCHEMA_VERSION),
    receipt_id: idToken,
    actor_id: idToken.nullable(),
    principal_set_id: idToken,
    principal_binding: PrincipalBindingSchema.extend({
      // binding carried in the envelope must name its platform system
    }),
    principal_shared: z.boolean(),
    authorship_mode: z.enum(AUTHORSHIP_MODES),
    attribution_strength: z.enum(ATTRIBUTION_STRENGTHS),
    assignment_id: z.string().min(1),
    assignment_version: z.number().int().min(1),
    execution_id: idToken,
    parent_execution_id: idToken.nullable(),
    participant_id: z.string().min(1),
    authority_ref: z.string().min(1),
    target: ProvenanceTargetSchema,
    content_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    source_cursors: z.record(z.string()),
    created_at: z.string().datetime({ offset: true }),
    integrity: IntegritySchema,
  })
  .strict()
  .superRefine((env, ctx) => {
    if (env.authorship_mode === "legacy_unattributed") {
      if (env.actor_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actor_id"],
          message: "legacy_unattributed envelopes must not carry a guessed actor",
        });
      }
      if (env.attribution_strength !== "unattributed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attribution_strength"],
          message: "legacy_unattributed requires attribution_strength=unattributed",
        });
      }
      return;
    }
    if (env.actor_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actor_id"],
        message: `${env.authorship_mode} envelopes require an actor_id`,
      });
    }
    if (
      env.attribution_strength === "xtrm_attested" &&
      (env.integrity.signer === null || env.integrity.signature === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attribution_strength"],
        message:
          "xtrm_attested requires signer+signature; unsigned receipts must classify self_attested_web",
      });
    }
  });
export type ProvenanceEnvelope = z.infer<typeof ProvenanceEnvelopeSchema>;
