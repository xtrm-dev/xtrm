/**
 * Robot identities slice 2 (xtrm-eq8) — trusted runtime context wiring +
 * provenance projection canary + runtime authority safety.
 *
 * Binds to the REAL chain-runtime lane: exported scheduler makeIdentity +
 * newResolvedChain + StepExecutionState, through the adapter in
 * src/chain/trusted-context.ts, into the landed Slice 1 contracts.
 *
 * Mercury project ids appear ONLY as fixture data (actor ids / principal
 * set names); the contracts and adapter are project-neutral.
 */

import { describe, test, expect } from "bun:test";
import type { ChainStep, ParticipantIdentity, ResolvedChain, StepExecutionState } from "../src/chain/types.ts";
import { makeIdentity } from "../src/chain/scheduler.ts";
import { newResolvedChain, stepById } from "../src/chain/topology.ts";
import {
  participantActorId,
  resolveTrustedExecutionContext,
  chainFingerprintDigests,
} from "../src/chain/trusted-context.ts";
import type { PlatformMutationAdapter } from "../src/identity/canary.ts";
import { runProvenanceCanary } from "../src/identity/canary.ts";
import { assembleProvenance, findCallerIdentityKeys } from "../src/identity/context.ts";
import { compactAttributionLine, githubTrailers } from "../src/identity/projection.ts";
import { legacyUnattributedEnvelope, validateMutation } from "../src/identity/validation.ts";
import {
  ACTOR_SCHEMA_VERSION,
  PRINCIPAL_SET_SCHEMA_VERSION,
  type Actor,
  type PrincipalSet,
} from "../src/identity/schemas.ts";

// ---------------------------------------------------------------- real lane

const sha = (s: string) =>
  `sha256:${Array.from(new Bun.CryptoHasher("sha256").update(s).digest("hex")).join("")}`;

const ACTOR: Actor = {
  schema_version: ACTOR_SCHEMA_VERSION,
  actor_id: "mercury/sre-chain-coordinator",
  actor_kind: "coordinator",
  parent_actor_id: null,
  policy_profile: "sre-triage-chain",
  allowed_principal_sets: ["xtrm-web"],
  authority_source: "chain-runtime-scheduler",
};

const PRINCIPAL_SET: PrincipalSet = {
  schema_version: PRINCIPAL_SET_SCHEMA_VERSION,
  principal_set_id: "xtrm-web",
  kind: "shared_web_connector",
  bindings: [
    { system: "github", principal_type: "user", immutable_account_id: null, display_name: "XTRM Web" },
  ],
  shared_by: ["environment == web"],
  credential_storage: "external_connector",
};

const REGISTRIES = {
  actors: { [ACTOR.actor_id]: ACTOR },
  principalSets: { [PRINCIPAL_SET.principal_set_id]: PRINCIPAL_SET },
};

/** role -> the single registered actor representing that role (slice 3 F4). */
const ROLE_ACTORS: Record<string, string> = {
  "chain-coordinator": ACTOR.actor_id,
  explorer: ACTOR.actor_id,
  "observability-analyst": ACTOR.actor_id,
  "sre-diagnostician": ACTOR.actor_id,
  reviewer: ACTOR.actor_id,
};

function realChain(): ResolvedChain {
  return newResolvedChain({
    chain_id: "chain-sre-canary",
    root_bead_id: "xtrm-eq8",
    fingerprint: {
      pi_package: { name: "pi-coding-agent", version: "0.84.1" },
      beads_version: "1.2.2",
      experiment_source_dir: "experiments/agentsession-sre-chain-vertical-slice",
      experiment_source_dirty: false,
      baseline_specialists: [],
    },
  });
}

function stepStateFor(stepId: string, attempts = 1, piSession?: string): StepExecutionState {
  return {
    step_id: stepId,
    participant_id: "",
    attempts,
    status: "running",
    remediation_loops: 0,
    last_pi_session_id: piSession ?? `pi-session-${stepId}-${attempts}`,
  };
}

/** Resolve the trusted context exactly the way the scheduler would. */
function resolveForStep(chain: ResolvedChain, step: ChainStep, st: StepExecutionState) {
  const identity = makeIdentity(chain, step, st);
  return {
    identity,
    resolution: resolveTrustedExecutionContext({
      identity,
      chain,
      step,
      stepState: st,
      registries: REGISTRIES,
      roleActors: ROLE_ACTORS,
      assignment: { id: `bead:${chain.root_bead_id}`, version: 1 },
      authorityRef: `bead:${chain.root_bead_id}`,
      actorId: ACTOR.actor_id,
      principalSetId: PRINCIPAL_SET.principal_set_id,
    }),
  };
}

/** Dry-run, non-production GitHub adapter — the canary's platform side. */
const dryRunGithub: PlatformMutationAdapter = {
  system: "github",
  async project({ envelope, target }) {
    const external_id = `xtrm-canary/repo#issue-deadbeef-${envelope.receipt_id}`;
    return { external_id, content_sha256: envelope.content_sha256 };
  },
};

const MUTATION_PAYLOAD = {
  content: "canary: chain runtime produced a bounded mutation record",
  target: { kind: "github_issue_comment", repo: "xtrm-canary/repo", issue: "issue-deadbeef" },
  source_cursors: { evidence_index: "evidence/index.jsonl#L1" },
};

// ------------------------------------------------------------------ tests

describe("slice 2 — trusted runtime context wiring (real scheduler lane)", () => {
  test("makeIdentity from the real lane populates the trusted execution context", () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const st = stepStateFor("coordinator-entry", 1);
    const { identity, resolution } = resolveForStep(chain, step, st);

    // identity comes from the real runtime lane
    expect(identity.execution_id).toMatch(/^exec-/);
    expect(identity.participant_id).toBe(`${chain.chain_id}::${step.role}`);
    expect(resolution.context.execution.execution_id).toBe(identity.execution_id);
    expect(resolution.context.execution.participant_id).toBe(identity.participant_id);
    expect(resolution.context.execution.attempt).toBe(1);
    expect(resolution.context.execution.assignment_id).toBe(`bead:${chain.root_bead_id}`);
    expect(resolution.context.execution.assignment_version).toBe(1);
    expect(resolution.context.execution.authority_ref).toBe(`bead:${chain.root_bead_id}`);
    // F3 (slice 3): runtime_session_id is read from StepExecutionState.last_pi_session_id
    expect(resolution.context.execution.runtime_session_id).toBe(
      `pi-session-${step.step_id}-1`,
    );
    expect(resolution.context.execution.policy_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(resolution.context.execution.toolchain_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(resolution.context.actor.actor_id).toBe(ACTOR.actor_id);
    expect(resolution.context.principal_set.principal_set_id).toBe(PRINCIPAL_SET.principal_set_id);
  });

  test("participantActorId is deterministic and role-derived", () => {
    const chain = realChain();
    const step = stepById(chain, "reviewer");
    const st = stepStateFor("reviewer", 2);
    const identity = makeIdentity(chain, step, st);
    expect(participantActorId(identity, step)).toBe(`${chain.chain_id}/reviewer`);
    // Sanitized: chain ids containing separator characters never leak into the actor id.
    const oddChain = { ...chain, chain_id: "chain sre::x" };
    const oddStep = { ...step, role: "observability-analyst" as const };
    const oddIdentity = { ...identity, chain_id: oddChain.chain_id, step_id: oddStep.step_id } as ParticipantIdentity;
    expect(participantActorId(oddIdentity, oddStep)).toBe("chain-sre-x/observability-analyst");
  });

  test("retry changes attempt, not participant or assignment (slice 1 semantics preserved)", () => {
    const chain = realChain();
    const step = stepById(chain, "diagnostician");
    const attempt1 = resolveForStep(chain, step, stepStateFor("diagnostician", 1));
    const attempt2 = resolveForStep(chain, step, stepStateFor("diagnostician", 2));
    expect(attempt2.resolution.context.execution.attempt).toBe(2);
    expect(attempt2.resolution.context.execution.participant_id).toBe(
      attempt1.resolution.context.execution.participant_id,
    );
    expect(attempt2.resolution.context.execution.assignment_id).toBe(
      attempt1.resolution.context.execution.assignment_id,
    );
    expect(attempt2.resolution.context.execution.execution_id).not.toBe(
      attempt1.resolution.context.execution.execution_id,
    );
  });

  test("parent execution lineage is preserved when the lane provides it", () => {
    const chain = realChain();
    const step = stepById(chain, "diagnostician");
    const st = stepStateFor("diagnostician", 2);
    const identity = makeIdentity(chain, step, st);
    const resolution = resolveTrustedExecutionContext({
      identity,
      chain,
      step,
      stepState: st,
      registries: REGISTRIES,
      roleActors: ROLE_ACTORS,
      assignment: { id: "bead:xtrm-eq8", version: 1 },
      authorityRef: "bead:xtrm-eq8",
      parentExecutionId: identity.execution_id,
      actorId: ACTOR.actor_id,
      principalSetId: PRINCIPAL_SET.principal_set_id,
    });
    expect(resolution.context.execution.parent_execution_id).toBe(identity.execution_id);
  });

  test("chain fingerprint digests are deterministic", () => {
    const chain = realChain();
    const d1 = chainFingerprintDigests(chain);
    const d2 = chainFingerprintDigests(realChain());
    expect(d1).toEqual(d2);
    expect(d1.policy_digest).not.toBe(d1.toolchain_digest);
  });
});

describe("slice 2 — provenance projection canary (end-to-end)", () => {
  test("trusted context -> envelope -> projection -> platform bind -> receipt validation", async () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const { resolution } = resolveForStep(chain, step, stepStateFor("coordinator-entry", 1));

    const result = await runProvenanceCanary({
      context: resolution.context,
      validationConfig: {
        registry: REGISTRIES.actors,
        principalSets: REGISTRIES.principalSets,
        expected: {
          assignment_id: "bead:xtrm-eq8",
          assignment_version: 1,
        },
      },
      payload: MUTATION_PAYLOAD,
      authorshipMode: "xtrm_web_direct",
      adapter: dryRunGithub,
    });

    // envelope -> the platform adapter bound a returned external object id
    expect(result.bound.target.external_id).toBe(result.external_id);
    expect(result.bound.target.external_id).not.toBeNull();
    expect(result.external_id).toContain(result.envelope.receipt_id);
    // receipt validates against trusted config
    expect(result.validation.ok).toBe(true);
    // no authenticity overclaim: unsigned receipt stays self_attested_web
    expect(result.bound.attribution_strength).toBe("self_attested_web");
    expect(result.bound.integrity.signer).toBeNull();
    expect(result.bound.integrity.signature).toBeNull();
    // projection renders the bounded attribution line + github trailers
    const actorId = result.bound.actor_id!; // canary envelopes are never legacy: actor required
    expect(compactAttributionLine(result.bound)).toContain(actorId);
    const trailers = githubTrailers(result.bound);
    expect(trailers).toContain(`XTRM-Actor: ${actorId}`);
    expect(trailers).toContain(`XTRM-Receipt: ${result.bound.receipt_id}`);
  });

  test("canary with human_direct authorship stays distinct from web attribution", async () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const { resolution } = resolveForStep(chain, step, stepStateFor("coordinator-entry", 1));
    const result = await runProvenanceCanary({
      context: resolution.context,
      validationConfig: {
        registry: REGISTRIES.actors,
        principalSets: REGISTRIES.principalSets,
      },
      payload: MUTATION_PAYLOAD,
      authorshipMode: "human_direct",
      adapter: dryRunGithub,
    });
    expect(result.bound.authorship_mode).toBe("human_direct");
    expect(result.validation.ok).toBe(true);
  });
});

describe("slice 2 — runtime authority safety (identity smuggling)", () => {
  const SMUGGLED_FIELDS = [
    "actor_id",
    "principal_set_id",
    "execution_id",
    "assignment_id",
    "authority_ref",
    "participant_id",
    "parent_execution_id",
    "authorship_mode",
    "attribution_strength",
  ] as const;

  test("every identity-bearing field is rejected if smuggled into the caller payload", async () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const { resolution } = resolveForStep(chain, step, stepStateFor("coordinator-entry", 1));

    for (const field of SMUGGLED_FIELDS) {
      const payload = { ...MUTATION_PAYLOAD, [field]: "forged" };
      expect(findCallerIdentityKeys(payload)).toContain(field);
      expect(() =>
        assembleProvenance(resolution.context, payload, {
          authorship_mode: "xtrm_web_direct",
          binding: PRINCIPAL_SET.bindings[0]!,
        }),
      ).toThrow(/caller_identity_assertion/);
    }
  });

  test("the canary itself rejects smuggled identity fields (payload-only caller surface)", async () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const { resolution } = resolveForStep(chain, step, stepStateFor("coordinator-entry", 1));

    const bad: Record<string, unknown> = { ...MUTATION_PAYLOAD, execution_id: "forged-exec" };
    expect(() =>
      assembleProvenance(resolution.context, bad, {
        authorship_mode: "xtrm_web_direct",
        binding: PRINCIPAL_SET.bindings[0]!,
      }),
    ).toThrow(/caller_identity_assertion/);
  });
});

describe("slice 2 — fail-closed rejection paths", () => {
  function baseInput(chain: ResolvedChain, step: ChainStep, st: StepExecutionState) {
    return {
      chain,
      step,
      stepState: st,
      registries: REGISTRIES,
      roleActors: ROLE_ACTORS,
      assignment: { id: "bead:xtrm-eq8", version: 1 },
      authorityRef: "bead:xtrm-eq8",
      actorId: ACTOR.actor_id,
      principalSetId: PRINCIPAL_SET.principal_set_id,
    };
  }

  test("missing actor fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const identity = makeIdentity(chain, step, stepStateFor("explorer", 1));
    expect(() =>
      resolveTrustedExecutionContext({
        ...baseInput(chain, step, stepStateFor("explorer", 1)),
        identity,
        registries: { actors: {}, principalSets: REGISTRIES.principalSets },
      }),
    ).toThrow(/actor_missing_or_invalid/);
  });

  test("missing principal-set binding fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const identity = makeIdentity(chain, step, stepStateFor("explorer", 1));
    expect(() =>
      resolveTrustedExecutionContext({
        ...baseInput(chain, step, stepStateFor("explorer", 1)),
        identity,
        registries: {
          actors: REGISTRIES.actors,
          principalSets: {},
        },
      }),
    ).toThrow(/principal_set_missing_or_invalid/);
  });

  test("missing authority fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const identity = makeIdentity(chain, step, stepStateFor("explorer", 1));
    expect(() =>
      resolveTrustedExecutionContext({
        ...baseInput(chain, step, stepStateFor("explorer", 1)),
        identity,
        authorityRef: "",
      }),
    ).toThrow(/authority_ref_missing/);
  });

  test("missing assignment id/version fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const identity = makeIdentity(chain, step, stepStateFor("explorer", 1));
    expect(() =>
      resolveTrustedExecutionContext({
        ...baseInput(chain, step, stepStateFor("explorer", 1)),
        identity,
        assignment: { id: "", version: 0 },
      }),
    ).toThrow(/assignment_missing_or_invalid/);
  });

  test("missing execution identity fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const identity = makeIdentity(chain, step, stepStateFor("explorer", 1));
    expect(() =>
      resolveTrustedExecutionContext({
        ...baseInput(chain, step, stepStateFor("explorer", 1)),
        identity: { ...identity, execution_id: "" },
      }),
    ).toThrow(/execution_identity_missing/);
  });

  test("actor not allowed to use the principal set fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const identity = makeIdentity(chain, step, stepStateFor("explorer", 1));
    const restricted = { ...ACTOR, allowed_principal_sets: ["xtrm-local"] };
    expect(() =>
      resolveTrustedExecutionContext({
        ...baseInput(chain, step, stepStateFor("explorer", 1)),
        identity,
        registries: {
          actors: { [ACTOR.actor_id]: restricted },
          principalSets: REGISTRIES.principalSets,
        },
      }),
    ).toThrow(/principal_set_not_allowed/);
  });
});

describe("slice 2 — rebind conflict regression", () => {
  test("same receipt bound to a DIFFERENT external object fails closed", async () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const { resolution } = resolveForStep(chain, step, stepStateFor("coordinator-entry", 1));

    const first = await runProvenanceCanary({
      context: resolution.context,
      validationConfig: { registry: REGISTRIES.actors, principalSets: REGISTRIES.principalSets },
      payload: MUTATION_PAYLOAD,
      authorshipMode: "xtrm_web_direct",
      adapter: dryRunGithub,
    });

    // forged rebind: same receipt, different returned object
    const { bindPlatformResult } = await import("../src/identity/context.ts");
    expect(() =>
      bindPlatformResult(first.bound, {
        system: "github",
        external_id: "xtrm-canary/repo#issue-OTHER",
      }),
    ).toThrow(/rebind_conflict|envelope_hash_mismatch/);
  });

  test("an already-bound receipt cannot be silently rebound", async () => {
    const chain = realChain();
    const step = stepById(chain, "coordinator-entry");
    const { resolution } = resolveForStep(chain, step, stepStateFor("coordinator-entry", 1));
    const result = await runProvenanceCanary({
      context: resolution.context,
      validationConfig: { registry: REGISTRIES.actors, principalSets: REGISTRIES.principalSets },
      payload: MUTATION_PAYLOAD,
      authorshipMode: "xtrm_web_direct",
      adapter: dryRunGithub,
    });
    // once bound, tampering with the target's id breaks integrity verification
    const tampered = {
      ...result.bound,
      target: { ...result.bound.target, external_id: "xtrm-canary/repo#issue-FORGED" },
    };
    const { validateMutation } = await import("../src/identity/validation.ts");
    const res = validateMutation(tampered, {
      registry: REGISTRIES.actors,
      principalSets: REGISTRIES.principalSets,
    });
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("envelope_hash_mismatch");
  });
});

describe("slice 2 — legacy behavior", () => {
  test("historical records without trusted identity remain legacy_unattributed", () => {
    const env = legacyUnattributedEnvelope({
      cursor: "legacy-gh-commit-abc123",
      principal_set_id: "xtrm-web",
      principal_binding: PRINCIPAL_SET.bindings[0]!,
      assignment_id: "bead-legacy",
      assignment_version: 1,
      participant_id: "legacy-participant",
      authority_ref: "legacy:github:abc123",
      target_kind: "github_commit",
      content_sha256: sha("legacy content"),
      created_at: "2026-08-01T00:00:00.000Z",
    });
    expect(env.authorship_mode).toBe("legacy_unattributed");
    expect(env.actor_id).toBeNull();
    expect(env.attribution_strength).toBe("unattributed");
    expect(compactAttributionLine(env)).toContain("legacy_unattributed");
  });

  test("legacy classification proves format consistency only, never authenticity", () => {
    const env = legacyUnattributedEnvelope({
      cursor: "legacy-gh-commit-xyz",
      principal_set_id: "xtrm-web",
      principal_binding: PRINCIPAL_SET.bindings[0]!,
      assignment_id: "bead-legacy",
      assignment_version: 1,
      participant_id: "legacy-participant",
      authority_ref: "legacy:github:xyz",
      target_kind: "github_commit",
      content_sha256: sha("legacy content 2"),
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const res = validateMutation(env, {
      registry: REGISTRIES.actors,
      principalSets: REGISTRIES.principalSets,
    });
    // hash reproduces (format ok) but the envelope still carries no actor
    expect(res.failures.map((f) => f.code)).not.toContain("envelope_hash_mismatch");
    expect(env.actor_id).toBeNull();
    // never upgrades to an authenticated claim
    expect(env.attribution_strength).toBe("unattributed");
  });
});
