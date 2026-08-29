/**
 * Trusted execution-context adapter (robot identities slice 2, xtrm-eq8).
 *
 * Wires the landed provenance contracts (xtrm-c4z / PR #99) to ONE real
 * trusted host/local execution lane: the chain-runtime scheduler. In this
 * vertical slice the scheduler resolves participant/execution identity
 * (makeIdentity) BEFORE any model-controlled mutation code runs, and the
 * tools inject that identity from the host closure. This module is that
 * lane's adapter into ResolvedExecutionContext.
 *
 * TRUST BOUNDARY:
 *   - identity fields (actor, principal set, execution, assignment,
 *     authority, participant, parent lineage, authorship mode, attribution
 *     strength) come ONLY from host-resolved runtime state below, never
 *     from prompt/model/tool payloads.
 *   - the adapter REJECTS (throws) when a required identity field is
 *     missing: actor, assignment/version, execution id, authority.
 *   - principal sets are looked up in the host-supplied registered set.
 *   - no second actor/execution identity system: fields reuse chain-runtime
 *     participant_id / execution_id / attempt semantics with a deterministic
 *     mapping into the xtrm.execution-identity.v1 contract.
 */

import { z } from "zod";
import type { ChainStep, ParticipantIdentity, ResolvedChain, StepExecutionState } from "./types.ts";
import { canonicalJson } from "../chain-contracts/normalize.ts";
import { sha256String } from "../util/fs.ts";
import {
  ACTOR_SCHEMA_VERSION,
  EXECUTION_SCHEMA_VERSION,
  PRINCIPAL_SET_SCHEMA_VERSION,
  ActorSchema,
  ExecutionIdentitySchema,
  PrincipalSetSchema,
  type Actor,
  type ExecutionIdentity,
  type PrincipalSet,
} from "../identity/schemas.ts";
import type { ResolvedExecutionContext } from "../identity/context.ts";

// ---------------------------------------------------------------------------
// Trusted host inputs
// ---------------------------------------------------------------------------

export interface TrustedRuntimeContextInput {
  /** Host-resolved participant identity (see chain/scheduler.ts makeIdentity). */
  identity: ParticipantIdentity;
  /** Frozen approved chain (assignments + authority ref + fingerprint). */
  chain: ResolvedChain;
  /** The step being executed. */
  step: ChainStep;
  /** Per-step execution state (attempts, last pi session id). */
  stepState: StepExecutionState;
  /**
   * Registered actor + principal-set configuration. Keys are actor_id and
   * principal_set_id; values are schema-checked here, never trusted as-is.
   */
  registries: {
    actors: Record<string, unknown>;
    principalSets: Record<string, unknown>;
  };
  /**
   * Host-resolved assignment identity: the durable assignment beacon this
   * execution belongs to (e.g. chain root bead or step bead). Version is
   * the assignment's version; retries change attempt, not assignment.
   */
  assignment: { id: string; version: number };
  /** Authority reference for this work (e.g. bead ref or jira issue ref). */
  authorityRef: string;
  /** Runtime session id when the lane has one (pi session). */
  runtimeSessionId?: string | null;
  /** Parent execution lineage when resuming/retrying. */
  parentExecutionId?: string | null;
  /** Which actor_id to use; defaults to identity participant mapping. */
  actorId?: string;
  /** Which principal_set_id to use; must be allowed for the actor. */
  principalSetId?: string;
}

export interface TrustedContextResolution {
  context: ResolvedExecutionContext;
  actor: Actor;
  principalSet: PrincipalSet;
  execution: ExecutionIdentity;
}

// ---------------------------------------------------------------------------
// Deterministic adapter
// ---------------------------------------------------------------------------

/** Actor id for a chain participant: the chain role is the logical actor surface in this lane. */
export function participantActorId(identity: ParticipantIdentity, step: ChainStep): string {
  return `${identity.chain_id.replace(/[^a-zA-Z0-9._/@-]+/g, "-")}/${step.role}`;
}

/**
 * Deterministic policy/toolchain digests for the execution identity.
 * Derived from the frozen chain fingerprint so the same approved chain
 * always yields the same digests.
 */
export function chainFingerprintDigests(chain: ResolvedChain): {
  policy_digest: string;
  toolchain_digest: string;
} {
  const policyMaterial = canonicalJson({
    chain_id: chain.chain_id,
    topology: chain.topology,
    entry_step_id: chain.entry_step_id,
    close_step_id: chain.close_step_id,
    reviewer_step_id: chain.reviewer_step_id,
    diagnostician_step_id: chain.diagnostician_step_id,
  });
  const toolchainMaterial = canonicalJson({
    pi_package: chain.fingerprint.pi_package,
    beads_version: chain.fingerprint.beads_version,
    experiment_source_dir: chain.fingerprint.experiment_source_dir,
  });
  return {
    policy_digest: `sha256:${sha256String(policyMaterial)}`,
    toolchain_digest: `sha256:${sha256String(toolchainMaterial)}`,
  };
}

/**
 * Resolve the trusted execution context from chain-runtime state.
 *
 * Fails closed (throws Error with a stable reason prefix) when:
 *   - the participant identity is missing host-required fields;
 *   - the actor registry has no entry for the resolved actor_id (or the
 *     entry does not parse);
 *   - the principal-set registry has no entry for the resolved
 *     principal_set_id (or it does not parse);
 *   - the actor is not allowed to use the principal set;
 *   - assignment id/version are missing;
 *   - authority_ref is missing/blank;
 *   - execution/participant identity cannot be derived.
 */
export function resolveTrustedExecutionContext(
  input: TrustedRuntimeContextInput,
): TrustedContextResolution {
  // 1. Identity must be complete (execution id + participant id come from
  //    the host lane, never from a payload).
  if (!input.identity?.execution_id || !input.identity?.participant_id) {
    throw new Error("execution_identity_missing");
  }

  const actorId = input.actorId ?? participantActorId(input.identity, input.step);
  const principalSetId = input.principalSetId ?? "";

  // 2. Actor must be registered and parseable.
  const actorParse = ActorSchema.safeParse(input.registries.actors[actorId]);
  if (!actorParse.success) {
    throw new Error(`actor_missing_or_invalid: ${actorId}`);
  }
  const actor = actorParse.data;

  // 3. Principal set must be registered and parseable.
  const psParse = PrincipalSetSchema.safeParse(input.registries.principalSets[principalSetId]);
  if (!psParse.success) {
    throw new Error(`principal_set_missing_or_invalid: ${principalSetId}`);
  }
  const principalSet = psParse.data;

  // 4. Actor must be allowed to act through this principal set.
  if (!actor.allowed_principal_sets.includes(principalSetId)) {
    throw new Error(`principal_set_not_allowed: ${actorId} -> ${principalSetId}`);
  }

  // 5. Authority + assignment must be present (host-resolved).
  if (!input.authorityRef || input.authorityRef.trim() === "") {
    throw new Error("authority_ref_missing");
  }
  if (!input.assignment || !input.assignment.id || input.assignment.version < 1) {
    throw new Error("assignment_missing_or_invalid");
  }

  // 6. Assemble the full execution identity (attempt >=1; retries change
  //    attempt, never participant/assignment).
  const attempt = input.stepState.attempts >= 1 ? input.stepState.attempts : 1;
  const digests = chainFingerprintDigests(input.chain);
  const execution = ExecutionIdentitySchema.parse({
    schema_version: EXECUTION_SCHEMA_VERSION,
    execution_id: input.identity.execution_id,
    attempt,
    actor_id: actorId,
    principal_set_id: principalSetId,
    assignment_id: input.assignment.id,
    assignment_version: input.assignment.version,
    participant_id: input.identity.participant_id,
    parent_execution_id: input.parentExecutionId ?? null,
    runtime_session_id: input.runtimeSessionId ?? null,
    generation: 1,
    authority_ref: input.authorityRef,
    policy_digest: digests.policy_digest,
    toolchain_digest: digests.toolchain_digest,
  });

  return {
    context: validateTrustedContext({ actor, principal_set: principalSet, execution }),
    actor,
    principalSet,
    execution,
  };
}

/** Strict validation of the assembled context (fail closed, no loose shapes). */
export function validateTrustedContext(ctx: unknown): ResolvedExecutionContext {
  const ResolvedExecutionContextSchema = z
    .object({
      actor: ActorSchema,
      principal_set: PrincipalSetSchema,
      execution: ExecutionIdentitySchema,
    })
    .strict();
  return ResolvedExecutionContextSchema.parse(ctx);
}
