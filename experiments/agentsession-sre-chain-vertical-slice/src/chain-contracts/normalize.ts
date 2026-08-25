/**
 * Deterministic normalization: ChainSource variants → ChainDefinition.
 *
 * Rules (all deterministic, order-independent where possible):
 *   1. Authored step ORDER is preserved (reviewable authored intent).
 *   2. depends_on is deduplicated and sorted lexicographically.
 *   3. routes are sorted by (gate, verdict, target).
 *   4. Defaults are materialized once (class="step", evidence_required=true,
 *      policy={} when absent).
 *   5. Source-specific metadata (source_metadata, vars, overrides,
 *      composition) is dropped; only source_kind/source_id/origin travel
 *      into provenance.
 *   6. Referential validation runs before any definition is produced.
 *
 * TemplateChainSource carries a catalog reference rather than an inline
 * shape; resolving template → inline shape is the ChainLoader's job
 * (xtrm-qcy.2). For that variant this module exposes
 * `normalizeFromResolvedTemplate`, which applies the identical rules to a
 * loader-resolved topology.
 */

import { createHash } from "node:crypto";
import {
  validateInlineTopology,
  type AdHocChainSource,
  type ChainSource,
  type ImportedWorkflowSource,
  type InlineTopology,
  type JsonChainSource,
} from "./chain-source.ts";
import { CHAIN_DEFINITION_SCHEMA_VERSION, type ChainDefinition } from "./chain-definition.ts";

export class NormalizationError extends Error {
  constructor(problems: string[]) {
    super(`invalid chain topology:\n  - ${problems.join("\n  - ")}`);
    this.name = "NormalizationError";
  }
}

function normalizeTopology(t: InlineTopology): ChainDefinition["topology"] {
  const problems = validateInlineTopology(t);
  if (problems.length > 0) throw new NormalizationError(problems);

  return {
    entry_step: t.entry_step,
    policy: { ...t.policy },
    steps: t.steps.map((s) => ({
      ...s,
      depends_on: [...new Set(s.depends_on)].sort(),
      routes: [...s.routes].sort(
        (a, b) => a.gate.localeCompare(b.gate) || a.verdict.localeCompare(b.verdict) || a.target.localeCompare(b.target),
      ),
    })),
  };
}

type SourceEnvelopeFields = Pick<ChainSource, "name" | "version" | "title" | "description" | "provenance">;

function buildDefinition(
  sourceKind: ChainSource["source_kind"],
  envelope: SourceEnvelopeFields & { source_id: string },
  topology: ChainDefinition["topology"],
): ChainDefinition {
  return {
    schema_version: CHAIN_DEFINITION_SCHEMA_VERSION,
    metadata: {
      name: envelope.name,
      version: envelope.version,
      ...(envelope.title !== undefined ? { title: envelope.title } : {}),
      ...(envelope.description !== undefined ? { description: envelope.description } : {}),
    },
    provenance: {
      source_kind: sourceKind,
      source_id: envelope.source_id as ChainDefinition["provenance"]["source_id"],
      origin: envelope.provenance.origin,
    },
    topology,
  };
}

export function normalizeJsonSource(s: JsonChainSource): ChainDefinition {
  return buildDefinition(s.source_kind, s, normalizeTopology(s.topology));
}

export function normalizeAdhocSource(s: AdHocChainSource): ChainDefinition {
  return buildDefinition(s.source_kind, s, normalizeTopology(s.topology));
}

export function normalizeImportedSource(s: ImportedWorkflowSource): ChainDefinition {
  return buildDefinition(s.source_kind, s, normalizeTopology(s.topology));
}

/** Normalize a loader-resolved template into a ChainDefinition (same rules). */
export function normalizeFromResolvedTemplate(
  s: Extract<ChainSource, { source_kind: "template" }>,
  resolved: InlineTopology,
): ChainDefinition {
  return buildDefinition("template", s, normalizeTopology(resolved));
}

// ---------------------------------------------------------------------------
// Canonical serialization / fingerprinting
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Fingerprint of the logical topology — provenance and metadata excluded. */
export function topologyFingerprint(def: ChainDefinition): string {
  return createHash("sha256").update(canonicalJson(def.topology)).digest("hex");
}

/**
 * Logical-topology equivalence: two definitions are equivalent when their
 * topologies match exactly, regardless of source variant or provenance.
 */
export function logicallyEquivalent(a: ChainDefinition, b: ChainDefinition): boolean {
  return topologyFingerprint(a) === topologyFingerprint(b);
}
