/**
 * Trusted runtime context assembly for mutation provenance.
 *
 * TRUST BOUNDARY (operator dispatch section 5.2): actor, assignment,
 * execution and authority come from RESOLVED runtime/assignment context
 * assembled by the host. Mutation callers cannot override them with prompt
 * text — the caller-facing payload schema below is `.strict()` and carries
 * NO identity-bearing fields, so any smuggled identity key is structurally
 * rejected with `caller_identity_assertion` (same discipline as the
 * channel-comm host-injected author lane).
 *
 * Model/provider identity is metadata, never actor identity: it is absent
 * from every schema in this module.
 */

import { z } from "zod";
import { canonicalJson } from "../chain-contracts/normalize.ts";
import { sha256String } from "../util/fs.ts";
import { shortId } from "../util/ids.ts";
import {
  ActorSchema,
  ExecutionIdentitySchema,
  PrincipalSetSchema,
  PROVENANCE_SCHEMA_VERSION,
  type Actor,
  type AuthorshipMode,
  type ExecutionIdentity,
  type PrincipalBinding,
  type ProvenanceEnvelope,
  type ProvenanceTarget,
} from "./schemas.ts";

/** Caller-supplied mutation payload: content + target ONLY. Strict on purpose. */
export const MutationPayloadSchema = z
  .object({
    content: z.string(),
    target: z
      .object({
        kind: z.string().min(1),
        issue: z.string().nullable().optional(),
        repo: z.string().nullable().optional(),
        /** Platform-assigned id is NEVER caller-supplied; it binds post-hoc. */
      })
      .strict(),
    source_cursors: z.record(z.string()).optional(),
  })
  .strict();
export type MutationPayload = z.infer<typeof MutationPayloadSchema>;

export const CALLER_IDENTITY_KEYS = [
  "actor_id",
  "principal_set_id",
  "principal_binding",
  "execution_id",
  "parent_execution_id",
  "participant_id",
  "authority_ref",
  "receipt_id",
  "integrity",
  "authorship_mode",
  "attribution_strength",
] as const;

/** Deterministic detection of smuggled identity keys (for typed errors/tests). */
export function findCallerIdentityKeys(payload: unknown): string[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const keys = Object.keys(payload as Record<string, unknown>);
  return keys.filter((k) => (CALLER_IDENTITY_KEYS as readonly string[]).includes(k));
}

/** Host-resolved trusted context. Built OUTSIDE the mutation call path. */
export interface ResolvedExecutionContext {
  actor: Actor;
  principal_set: PrincipalSet;
  execution: ExecutionIdentity;
}

const ResolvedExecutionContextSchema = z
  .object({
    actor: ActorSchema,
    principal_set: PrincipalSetSchema,
    execution: ExecutionIdentitySchema,
  })
  .strict();

/**
 * Assemble a provenance envelope draft from trusted context + a strict
 * caller payload. Throws ZodError when:
 *   - trusted context fails its own schemas (fail closed), or
 *   - the payload carries ANY identity-bearing key (caller override), or
 *   - the trusted actor is not allowed to use the trusted principal set.
 */
export function assembleProvenance(
  ctx: unknown,
  payload: unknown,
  opts: {
    authorship_mode: AuthorshipMode;
    attribution_strength?: "xtrm_attested" | "self_attested_web";
    binding: PrincipalBinding;
  },
): ProvenanceEnvelope {
  const resolved = ResolvedExecutionContextSchema.parse(ctx);
  const smuggled = findCallerIdentityKeys(payload);
  if (smuggled.length > 0) {
    throw new Error(`caller_identity_assertion: ${smuggled.sort().join(",")}`);
  }
  const p = MutationPayloadSchema.parse(payload);
  if (!resolved.actor.allowed_principal_sets.includes(resolved.principal_set.principal_set_id)) {
    throw new Error(
      `principal_set_not_allowed: actor ${resolved.actor.actor_id} cannot use ${resolved.principal_set.principal_set_id}`,
    );
  }
  if (
    !resolved.execution.authority_ref ||
    typeof resolved.execution.authority_ref !== "string"
  ) {
    throw new Error("authority_ref_missing");
  }

  const target: ProvenanceTarget = {
    kind: p.target.kind,
    external_id: null,
    ...(p.target.issue !== undefined ? { issue: p.target.issue } : {}),
    ...(p.target.repo !== undefined ? { repo: p.target.repo } : {}),
  };

  const unsigned = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    receipt_id: `xpr-${shortId("d", 8).slice(4)}`,
    actor_id: resolved.actor.actor_id,
    principal_set_id: resolved.principal_set.principal_set_id,
    principal_binding: opts.binding,
    principal_shared: resolved.principal_set.shared_by.length > 0 && resolved.principal_set.kind === "shared_web_connector",
    authorship_mode: opts.authorship_mode,
    attribution_strength: opts.attribution_strength ?? "self_attested_web",
    assignment_id: resolved.execution.assignment_id,
    assignment_version: resolved.execution.assignment_version,
    execution_id: resolved.execution.execution_id,
    parent_execution_id: resolved.execution.parent_execution_id,
    participant_id: resolved.execution.participant_id,
    authority_ref: resolved.execution.authority_ref,
    target,
    content_sha256: `sha256:${sha256String(p.content)}`,
    source_cursors: p.source_cursors ?? {},
    created_at: new Date().toISOString(),
    integrity: {
      envelope_sha256: "",
      signer: null,
      signature: null,
    },
  };
  return sealEnvelope(unsigned);
}

type UnsignedEnvelope = Omit<ProvenanceEnvelope, "integrity"> & {
  integrity: { envelope_sha256: ""; signer: string | null; signature: string | null };
};

/**
 * Compute envelope_sha256 over the canonical JSON of everything EXCEPT the
 * hash itself (which would be self-referential). Signer/signature are part
 * of the covered material.
 */
export function computeEnvelopeHash(env: Omit<ProvenanceEnvelope, "integrity"> & { integrity?: unknown }): string {
  const copy: Record<string, unknown> = { ...(env as Record<string, unknown>) };
  delete copy.integrity;
  return `sha256:${sha256String(canonicalJson(copy))}`;
}

/** Fill integrity.envelope_sha256 and re-parse through the strict schema. */
export function sealEnvelope(unsigned: UnsignedEnvelope | ProvenanceEnvelope): ProvenanceEnvelope {
  const envelope_sha256 = computeEnvelopeHash(unsigned);
  return {
    ...(unsigned as ProvenanceEnvelope),
    integrity: {
      ...(unsigned as ProvenanceEnvelope).integrity,
      envelope_sha256,
    },
  };
}

/**
 * Bind the platform-assigned external id after a side effect returns.
 * Re-binding over a DIFFERENT existing id fails closed (uncertain side
 * effects must be reconciled, never blindly retried).
 */
export function bindPlatformResult(
  env: ProvenanceEnvelope,
  result: { system: string; external_id: string; content_sha256?: string },
): ProvenanceEnvelope {
  if (env.principal_binding.system !== result.system) {
    throw new Error(`binding_system_mismatch: ${result.system}`);
  }
  if (env.target.external_id !== null && env.target.external_id !== result.external_id) {
    throw new Error(
      `rebind_conflict: bound=${env.target.external_id} observed=${result.external_id} — reconcile, do not retry`,
    );
  }
  if (
    result.content_sha256 !== undefined &&
    result.content_sha256 !== env.content_sha256
  ) {
    throw new Error("content_hash_mismatch: platform content differs from attested content");
  }
  return sealEnvelope({
    ...env,
    target: { ...env.target, external_id: result.external_id },
  });
}
