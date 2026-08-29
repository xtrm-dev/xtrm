/**
 * Provenance projection canary (robot identities slice 2, xtrm-eq8).
 *
 * One bounded, non-production canary path that proves:
 *
 *   trusted context (src/chain/trusted-context.ts)
 *     → assembleProvenance (caller supplies only content/target/cursors)
 *     → platform projection (src/identity/projection.ts)
 *     → platform mutation adapter (dry-run/test fixture)
 *     → returned platform object identity binding (bindPlatformResult)
 *     → receipt validation (validateMutation)
 *
 * The platform adapter is injected: production adapters stay out of scope
 * (no connector cutover). The caller of runProvenanceCanary supplies a
 * dry-run adapter or an explicitly designated non-production test target.
 *
 * Honesty boundary: unsigned receipts classify self_attested_web. This
 * canary does NOT implement a signer and never claims authenticated or
 * attested provenance.
 */

import type { ResolvedExecutionContext } from "./context.ts";
import type { PrincipalBinding } from "./schemas.ts";
import { MutationPayloadSchema, assembleProvenance, bindPlatformResult, type MutationPayload } from "./context.ts";
import { validateMutation, type TrustedValidationConfig } from "./validation.ts";

/** Minimal platform mutation adapter surface (injected; never built here). */
export interface PlatformMutationAdapter {
  readonly system: "github" | "jira";
  /**
   * Project the assembled envelope to the non-production target and return
   * the platform-assigned object identity. Content hash passes through for
   * platform-side verification where the adapter supports it.
   */
  project(args: {
    envelope: import("./schemas.ts").ProvenanceEnvelope;
    target: { kind: string; issue?: string | null; repo?: string | null };
  }): Promise<{ external_id: string; content_sha256?: string }>;
}

export interface ProvenanceCanaryArgs {
  context: ResolvedExecutionContext;
  /** Registered validation config (registry, principal sets, assignments). */
  validationConfig: TrustedValidationConfig;
  /** Caller-supplied mutation payload: content + target ONLY (strict caller schema). */
  payload: MutationPayload;
  /** Logical authorship mode for this lane (direct/relay; never legacy here). */
  authorshipMode: "human_direct" | "xtrm_web_direct" | "xtrm_local_direct" | "xtrm_host_direct" | "xtrm_relay";
  /** Platform adapter (dry-run/test fixture in the canary). */
  adapter: PlatformMutationAdapter;
}

export interface ProvenanceCanaryResult {
  envelope: import("./schemas.ts").ProvenanceEnvelope;
  bound: import("./schemas.ts").ProvenanceEnvelope;
  external_id: string;
  validation: ReturnType<typeof validateMutation>;
}

/**
 * Run the bounded canary path end-to-end. Throws on any fail-closed step
 * (missing identity fields, smuggling, invalid platform result, rebind
 * conflict) so a canary failure is loud.
 */
export async function runProvenanceCanary(
  args: ProvenanceCanaryArgs,
): Promise<ProvenanceCanaryResult> {
  // The binding is chosen from the TRUSTED principal set for the adapter's
  // platform system — never from caller input.
  const binding: PrincipalBinding | undefined = args.context.principal_set.bindings.find(
    (b) => b.system === args.adapter.system,
  );
  if (!binding) {
    throw new Error(
      `binding_system_unavailable: principal set ${args.context.principal_set.principal_set_id} has no ${args.adapter.system} binding`,
    );
  }

  // Parse the caller payload through the strict caller schema at the canary
  // boundary: any smuggled identity key fails here, before assembly.
  const payload = MutationPayloadSchema.parse(args.payload);
  const envelope = assembleProvenance(
    args.context,
    payload,
    {
      authorship_mode: args.authorshipMode,
      binding,
    },
  );

  const projected = await args.adapter.project({
    envelope,
    target: payload.target,
  });

  const bound = bindPlatformResult(envelope, {
    system: args.adapter.system,
    external_id: projected.external_id,
    ...(projected.content_sha256 !== undefined
      ? { content_sha256: projected.content_sha256 }
      : {}),
  });

  const validation = validateMutation(bound, args.validationConfig, {
    content: payload.content,
  });
  if (!validation.ok) {
    throw new Error(
      `canary_validation_failed: ${validation.failures.map((f) => f.code).join(",")}`,
    );
  }

  return { envelope, bound, external_id: projected.external_id, validation };
}
