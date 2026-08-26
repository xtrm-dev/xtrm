/**
 * Stable human + machine rendering of provenance envelopes for platform
 * surfaces (Jira comments, GitHub bodies/commit trailers).
 *
 * Rules:
 *   - The compact visible line names actor, execution and authority. It is
 *     presentation; the envelope is the evidence.
 *   - Renderers NEVER emit secret material: they project only schema fields.
 *   - When a platform cannot carry the full envelope (e.g. Jira comment
 *     properties unavailable), the projection downgrades its classification
 *     to `self_attested_web` and carries a bounded machine-readable footer
 *     (receipt id + envelope hash). It never upgrades attribution.
 */

import { canonicalJson } from "../chain-contracts/normalize.ts";
import type { ProvenanceEnvelope } from "./schemas.ts";

/** `jira:ISSUE-84:comment:<id>` -> `ISSUE-84#<id>`. Unknown shapes pass through. */
export function renderAuthorityRef(authorityRef: string): string {
  const m = /^(jira|github):([^:]+):comment:(.+)$/.exec(authorityRef);
  if (m) return `${m[2]}#${m[3]}`;
  return authorityRef;
}

/**
 * Compact visible attribution line (first line of projected comment/body).
 * Legacy/unattributed history renders an honest marker instead of an actor.
 */
export function compactAttributionLine(env: ProvenanceEnvelope): string {
  if (env.authorship_mode === "legacy_unattributed") {
    return `XTRM provenance: legacy_unattributed · authority: ${renderAuthorityRef(env.authority_ref)}`;
  }
  return `XTRM actor: ${env.actor_id} · execution: ${env.execution_id} · authority: ${renderAuthorityRef(env.authority_ref)}`;
}

/** Canonical stable JSON rendering (byte-stable, sorted keys). */
export function renderEnvelopeJson(env: ProvenanceEnvelope): string {
  return canonicalJson(env);
}

/**
 * GitHub commit trailers for commits actually created by the web plane.
 * Legacy envelopes emit exactly one honest marker trailer.
 */
export function githubTrailers(env: ProvenanceEnvelope): string[] {
  if (env.authorship_mode === "legacy_unattributed") {
    return ["XTRM-Provenance: legacy_unattributed"];
  }
  return [
    `XTRM-Actor: ${env.actor_id}`,
    `XTRM-Principal-Set: ${env.principal_set_id}`,
    `XTRM-Execution: ${env.execution_id}`,
    `XTRM-Assignment: ${env.assignment_id}@${env.assignment_version}`,
    `XTRM-Authority: ${env.authority_ref}`,
    `XTRM-Receipt: ${env.receipt_id}`,
  ];
}

/**
 * Mirrors envelope attribution strength honestly; never upgrades.
 * `xtrm_attested` appears here ONLY for envelopes whose schema-level refine
 * guarantees signer+signature; `unattributed` stays unattributed everywhere.
 */
export type JiraClassification = "xtrm_attested" | "self_attested_web" | "unattributed";

function classify(strength: "xtrm_attested" | "self_attested_web" | "unattributed"): JiraClassification {
  if (strength === "xtrm_attested") return "xtrm_attested";
  if (strength === "unattributed") return "unattributed";
  return "self_attested_web";
}

/** Fallback channels cap attestation at self_attested_web; they never upgrade. */
function downgradeForFallback(c: JiraClassification): JiraClassification {
  return c === "xtrm_attested" ? "self_attested_web" : c;
}

export interface JiraCommentProjection {
  /** Full visible comment body including the compact attribution line. */
  body: string;
  /** Set ONLY when the connector supports comment properties. */
  property?: { name: "xtrm.provenance"; value: string };
  /** Honest downgrade when the property channel is unavailable. */
  classification: JiraClassification;
}

/**
 * Project an envelope onto a Jira comment. `visible` is the human content;
 * the attribution line is prepended and, when properties are unsupported,
 * a bounded hidden footer carries receipt + envelope hash.
 */
export function jiraCommentProjection(
  env: ProvenanceEnvelope,
  visible: string,
  opts: { propertiesSupported: boolean },
): JiraCommentProjection {
  if (opts.propertiesSupported) {
    return {
      body: `${compactAttributionLine(env)}\n\n${visible}`,
      property: { name: "xtrm.provenance", value: renderEnvelopeJson(env) },
      classification: classify(env.attribution_strength),
    };
  }
  const footer = `<!-- xtrm.provenance receipt=${env.receipt_id} envelope=${env.integrity.envelope_sha256} -->`;
  return {
    body: `${compactAttributionLine(env)}\n\n${visible}\n${footer}`,
    classification: downgradeForFallback(classify(env.attribution_strength)),
  };
}
