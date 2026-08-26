/**
 * Fail-closed validation of provenance envelopes against trusted config.
 *
 * Validation reads ONLY trusted inputs (actor registry, principal-set
 * config, expected assignment state). It never trusts payload prose,
 * labels or branch names. Any mismatch produces a typed failure reason;
 * callers must treat mismatch as terminal for that mutation attempt —
 * uncertain side effects are reconciled, not retried blind.
 */

import {
  ProvenanceEnvelopeSchema,
  PrincipalSetSchema,
  ActorSchema,
  PROVENANCE_SCHEMA_VERSION,
  type ProvenanceEnvelope,
} from "./schemas.ts";
import { computeEnvelopeHash } from "./context.ts";
import { sha256String } from "../util/fs.ts";
import { shortId } from "../util/ids.ts";

export type ValidationFailureCode =
  | "envelope_schema_invalid"
  | "actor_not_registered"
  | "principal_set_unknown"
  | "principal_set_not_allowed"
  | "binding_system_mismatch"
  | "binding_account_mismatch"
  | "assignment_mismatch"
  | "authority_ref_missing"
  | "content_hash_mismatch"
  | "envelope_hash_mismatch"
  | "secret_material_detected";

export interface ValidationResult {
  ok: boolean;
  failures: Array<{ code: ValidationFailureCode; detail?: string }>;
}

export interface TrustedValidationConfig {
  /** actor_id -> Actor document (schema-checked here, never trusted as-is). */
  registry: Record<string, unknown>;
  /** principal_set_id -> PrincipalSet document (schema-checked here). */
  principalSets: Record<string, unknown>;
  expected?: {
    assignment_id?: string;
    assignment_version?: number;
  };
}

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /ATATT[A-Za-z0-9_-]{20,}/, // Atlassian API tokens
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /(api[_-]?key|password|passwd|secret)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Defense-in-depth scan over the full serialized envelope plus any
 * caller-supplied observed content. The envelope itself carries only a
 * content HASH — raw content never enters it — so a positive on the
 * envelope alone means a field was abused; a positive on observed content
 * means the mutation would publish secret material.
 */
export function containsSecretMaterial(
  env: ProvenanceEnvelope,
  extra?: { content?: string },
): boolean {
  const texts = JSON.stringify(env) + (extra?.content ?? "");
  return SECRET_PATTERNS.some((re) => re.test(texts));
}

/**
 * Validate one envelope against trusted config. Fails closed on any
 * mismatch between envelope claims and registered truth.
 */
export function validateMutation(
  env: unknown,
  cfg: TrustedValidationConfig,
  observed?: { content?: string },
): ValidationResult {
  const failures: ValidationResult["failures"] = [];
  const parsed = ProvenanceEnvelopeSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      failures: [{ code: "envelope_schema_invalid", detail: parsed.error.message }],
    };
  }
  const e = parsed.data;

  // integrity hash must reproduce
  const recomputed = computeEnvelopeHash(e);
  if (recomputed !== e.integrity.envelope_sha256) {
    failures.push({ code: "envelope_hash_mismatch" });
  }

  // secret material never belongs in an envelope (or in published content)
  if (containsSecretMaterial(e, { content: observed?.content })) {
    failures.push({ code: "secret_material_detected" });
  }

  // legacy envelopes validate no further — there is nothing to check against
  if (e.authorship_mode !== "legacy_unattributed") {
    const actorRaw = cfg.registry[e.actor_id as string];
    const actor = ActorSchema.safeParse(actorRaw);
    if (!actor.success) {
      failures.push({ code: "actor_not_registered", detail: e.actor_id ?? undefined });
    } else if (!actor.data.allowed_principal_sets.includes(e.principal_set_id)) {
      failures.push({
        code: "principal_set_not_allowed",
        detail: `${e.actor_id} -> ${e.principal_set_id}`,
      });
    }

    const ps = PrincipalSetSchema.safeParse(cfg.principalSets[e.principal_set_id]);
    if (!ps.success) {
      failures.push({ code: "principal_set_unknown", detail: e.principal_set_id });
    } else {
      const binding = ps.data.bindings.find((b) => b.system === e.principal_binding.system);
      if (!binding) {
        failures.push({ code: "binding_system_mismatch", detail: e.principal_binding.system });
      } else if (
        binding.immutable_account_id !== null &&
        e.principal_binding.immutable_account_id !== null &&
        binding.immutable_account_id !== e.principal_binding.immutable_account_id
      ) {
        failures.push({ code: "binding_account_mismatch" });
      }
    }

    if (cfg.expected?.assignment_id !== undefined && cfg.expected.assignment_id !== e.assignment_id) {
      failures.push({ code: "assignment_mismatch", detail: e.assignment_id });
    }
    if (
      cfg.expected?.assignment_version !== undefined &&
      cfg.expected.assignment_version !== e.assignment_version
    ) {
      failures.push({ code: "assignment_mismatch", detail: String(e.assignment_version) });
    }
    if (!e.authority_ref || e.authority_ref.trim() === "") {
      failures.push({ code: "authority_ref_missing" });
    }
  }

  if (observed?.content !== undefined) {
    const observedHash = `sha256:${sha256String(observed.content)}`;
    if (observedHash !== e.content_sha256) {
      failures.push({ code: "content_hash_mismatch" });
    }
  }

  return { ok: failures.length === 0, failures };
}

/** Deterministic legacy receipt id (no randomness — history is reproducible). */
function legacyReceiptId(cursor: string): string {
  return `xpr-${sha256String(`legacy:${cursor}`).slice(0, 12)}`;
}

/**
 * Honest classification for pre-XTRM history: legacy_unattributed, with no
 * guessed actor and no signature claims. Used by migration tooling only;
 * never by live mutations.
 */
export function legacyUnattributedEnvelope(seed: {
  cursor: string;
  principal_set_id: string;
  principal_binding: ProvenanceEnvelope["principal_binding"];
  assignment_id: string;
  assignment_version: number;
  participant_id: string;
  authority_ref: string;
  target_kind: string;
  content_sha256: string;
  created_at: string;
}): ProvenanceEnvelope {
  const unsigned = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    receipt_id: legacyReceiptId(seed.cursor),
    actor_id: null,
    principal_set_id: seed.principal_set_id,
    principal_binding: seed.principal_binding,
    principal_shared: true,
    authorship_mode: "legacy_unattributed",
    attribution_strength: "unattributed",
    assignment_id: seed.assignment_id,
    assignment_version: seed.assignment_version,
    execution_id: `exec-legacy-${legacyReceiptId(seed.cursor).slice(4)}`,
    parent_execution_id: null,
    participant_id: seed.participant_id,
    authority_ref: seed.authority_ref,
    target: { kind: seed.target_kind, external_id: null },
    content_sha256: seed.content_sha256,
    source_cursors: {},
    created_at: seed.created_at,
    integrity: { envelope_sha256: "", signer: null, signature: null },
  } as ProvenanceEnvelope;
  return computeEnvelopeHashInPlace(unsigned);
}

function computeEnvelopeHashInPlace(env: ProvenanceEnvelope): ProvenanceEnvelope {
  return {
    ...env,
    integrity: { ...env.integrity, envelope_sha256: computeEnvelopeHash(env) },
  };
}
