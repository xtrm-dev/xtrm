/**
 * Pure compiler — ChainDefinition → ResolvedChain (xtrm-qcy.3).
 *
 * Canonical surface per ADR-001 and runtime PRD §2/§3 (R1.1–R1.5,
 * R1.15–R1.17). This module contains ONLY pure functions over plain
 * objects: no model calls, no shelling, no IO, no clocks, no runtime
 * entities. ResolvedChain carries NO job/session/bead IDs, no per-step
 * status, no attempts, no timestamps — materialization happens AFTER
 * freeze elsewhere (ADR-001 §4) and projects Beads IDs into its own
 * projection, never into this contract.
 *
 * Deliberately NOT here: Beads materialization, scheduling/reduction,
 * activation/run state, capability ENFORCEMENT at runtime (this module
 * only computes the grant set), eval harness. Compiler determinism and
 * freeze integrity are Eval Core subjects (ADR-001 consequences).
 *
 * Pure function set:
 *   - compileChain(definition, opts?)        → draft ResolvedChain
 *   - resolveCompiledCapabilityBounds(steps, policy) → per-step compiled bounds
 *   - approveChain(draft)                    → approved ResolvedChain
 *   - reviseChain(approved, nextDef, opts?)  → new draft at revision+1
 *   - verifyFreezeIntegrity(resolved, def?)  → true | throws
 *
 * SCRUTINY DECISION (floor-only-raise): per-step effective scrutiny is
 * the HIGHER-ranked of the chain policy floor (topology.policy.scrutiny)
 * and the step's own policy_inputs.scrutiny declaration (rank order
 * none < low < medium < high). A step may raise itself above the floor;
 * it may never lower the chain floor. When BOTH are absent the key is
 * OMITTED from effective.scrutiny entirely — absence means "unset",
 * never a synthesized "none" (a false "none" would read as a reviewed
 * decision that was never made).
 *
 * GRANTS DECISION (default-deny, no wildcards): a grant is the exact
 * string intersection of a step's capability_requests with the operator
 * GrantsPolicy allowlists. Requests are NEVER copied unfiltered; steps
 * requesting nothing get empty grants; an absent/empty policy denies
 * everything. Wildcards are deliberately NOT supported: "*" in an
 * allowlist or a request is an ordinary string that matches nothing but
 * a literal "*" on both sides — no expansion semantics exist, so the
 * unsafe case (accidental universal grant) is structurally impossible.
 *
 * REVISION RULES: compileChain always emits status "draft". approveChain
 * freezes a draft (rejecting anything else) at the SAME revision,
 * pinning a recomputed structure_fingerprint. Structural change after
 * freeze requires reviseChain: a NEW draft at revision+1 whose topology
 * must differ from the approved one (identical resubmission is rejected
 * with "no structural change"). Fingerprints are sha256 over
 * canonicalJson (qcy.1 helpers), so equivalence is byte-level
 * deterministic.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  ChainDefinitionSchema,
  KebabCase,
  NormalizationError,
  SemVer,
  type ChainDefinition,
} from "../chain-contracts/index.ts";

// ---------------------------------------------------------------------------
// Schema — xtrm.resolved-chain.v1 (.strict() at EVERY level)
// ---------------------------------------------------------------------------

export const RESOLVED_CHAIN_SCHEMA_VERSION = "xtrm.resolved-chain.v1" as const;

const ScrutinyLevel = z.enum(["none", "low", "medium", "high"]);

const CompiledCapabilityBoundsSchema = z
  .object({
    tools: z.array(z.string().min(1)),
    skills: z.array(KebabCase),
  })
  .strict();

export const ResolvedChainSchema = z
  .object({
    schema_version: z.literal(RESOLVED_CHAIN_SCHEMA_VERSION),
    /** Kebab-case chain identity, derived from definition.metadata.name. */
    chain_id: KebabCase,
    revision: z.number().int().min(1),
    status: z.enum(["draft", "approved"]),
    resolved_from: z
      .object({
        source_kind: z.enum(["template", "json", "adhoc", "imported"]),
        source_id: KebabCase,
        source_version: SemVer,
        /** sha256 over canonicalJson of the WHOLE source ChainDefinition. */
        definition_fingerprint: z.string().length(64),
      })
      .strict(),
    /** Structural verbatim copy of the normalized topology. */
    frozen_topology: z
      .object({
        entry_step: KebabCase,
        steps: z.array(z.unknown()),
        policy: z.unknown(),
      })
      .strict(),
    effective: z
      .object({
        scrutiny: z.record(KebabCase, ScrutinyLevel),
        compiled_capability_bounds: z.record(KebabCase, CompiledCapabilityBoundsSchema),
      })
      .strict(),
    /** sha256 over canonicalJson of frozen_topology. */
    structure_fingerprint: z.string().length(64),
  })
  .strict();

export type ResolvedChain = z.infer<typeof ResolvedChainSchema>;

/** Compile-time upper bound only — not the final grant authority (ADR-004);
 *  see the complete note at the emission site in compileChain. */
export type CompiledCapabilityBounds = z.infer<typeof CompiledCapabilityBoundsSchema>;

/**
 * Operator policy input for capability binding (R1.15/R1.16). Absent or
 * empty lists deny everything. No wildcard semantics (see docblock).
 */
export interface GrantsPolicy {
  allowed_tools?: string[];
  allowed_skills?: string[];
}

export interface CompileOptions {
  revision?: number;
  grantsPolicy?: GrantsPolicy;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Parse-or-throw helper matching the qcy.2 loader error convention. */
type SafeParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };

function parseOrThrow<T>(schema: { safeParse(v: unknown): SafeParseResult }, v: unknown): T {
  const parsed = schema.safeParse(v);
  if (!parsed.success) {
    throw new NormalizationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return parsed.data as T;
}

const SCRUTINY_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;

type Scrutiny = ChainDefinition["topology"]["policy"]["scrutiny"];
type CompilerStep = ChainDefinition["topology"]["steps"][number];

/** Floor-only-raise: higher of chain floor and step declaration; both absent → undefined. */
function effectiveScrutiny(floor: Scrutiny, step: CompilerStep): Scrutiny {
  const declared = step.policy_inputs?.scrutiny;
  if (declared !== undefined && (floor === undefined || SCRUTINY_RANK[declared] > SCRUTINY_RANK[floor])) {
    return declared;
  }
  return floor;
}

// ---------------------------------------------------------------------------
// Capability binding (R1.15/R1.16)
// ---------------------------------------------------------------------------

/**
 * Bound = step request ∩ operator allowlist, DEFAULT DENY. Steps requesting
 * nothing get empty bounds; requests are never copied unfiltered. Pure; no
 * wildcard expansion (see module docblock).
 */
export function resolveCompiledCapabilityBounds(
  steps: readonly CompilerStep[],
  grantsPolicy: GrantsPolicy | undefined,
): Record<string, CompiledCapabilityBounds> {
  const allowedTools = new Set(grantsPolicy?.allowed_tools ?? []);
  const allowedSkills = new Set(grantsPolicy?.allowed_skills ?? []);
  const out: Record<string, CompiledCapabilityBounds> = {};
  for (const step of steps) {
    const req = step.capability_requests;
    out[step.step_id] = {
      tools: [...new Set((req?.required_tools ?? []).filter((t) => allowedTools.has(t)))].sort(),
      skills: [...new Set((req?.required_skills ?? []).filter((s) => allowedSkills.has(s)))].sort(),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

/**
 * Compile a normalized ChainDefinition into a DRAFT ResolvedChain.
 * Validates the input against ChainDefinitionSchema (garbage in →
 * NormalizationError), snapshots provenance pointers, deep-copies the
 * topology as frozen_topology, applies scrutiny floor-only-raise and
 * default-deny capability binding. Always emits status "draft"; freezing
 * is approveChain's job. Pure and deterministic.
 */
export function compileChain(definition: ChainDefinition, opts: CompileOptions = {}): ResolvedChain {
  const def = parseOrThrow<ChainDefinition>(ChainDefinitionSchema, definition);
  const revision = opts.revision ?? 1;
  if (!Number.isInteger(revision) || revision < 1) {
    throw new NormalizationError([`revision must be an integer >= 1, got: ${revision}`]);
  }
  // Deep copy so later mutation of the caller's definition cannot mutate
  // the frozen snapshot.
  const frozenTopology: ResolvedChain["frozen_topology"] = JSON.parse(JSON.stringify(def.topology));

  const scrutiny: Record<string, Exclude<Scrutiny, undefined>> = {};
  for (const step of def.topology.steps) {
    const s = effectiveScrutiny(def.topology.policy.scrutiny, step);
    if (s !== undefined) scrutiny[step.step_id] = s;
  }

  return {
    schema_version: RESOLVED_CHAIN_SCHEMA_VERSION,
    chain_id: def.metadata.name,
    revision,
    status: "draft",
    resolved_from: {
      source_kind: def.provenance.source_kind,
      source_id: def.provenance.source_id,
      source_version: def.metadata.version,
      definition_fingerprint: sha256(canonicalJson(def)),
    },
    frozen_topology: frozenTopology,
    effective: {
      scrutiny,
      // ADR-004: compiled_capability_bounds is a COMPILE-TIME UPPER BOUND
      // only (requests ∩ operator allowlist). The final ResolvedCapabilityGrant
      // additionally requires SpecialistDefinition requirements,
      // SpecialistActivationProfile, and runtime/sandbox availability —
      // completed at PREPARE/ActivationSupervisor wiring. Runtime consumers
      // MUST NOT treat this artifact as the final grant authority.
      compiled_capability_bounds: resolveCompiledCapabilityBounds(
        def.topology.steps,
        opts.grantsPolicy,
      ),
    },
    structure_fingerprint: sha256(canonicalJson(frozenTopology)),
  };
}

// ---------------------------------------------------------------------------
// Freeze / revise / verify
// ---------------------------------------------------------------------------

/**
 * Freeze a draft into an APPROVED ResolvedChain at the SAME revision.
 * Rejects anything that is not a schema-valid draft (including an
 * already-approved chain — double-approval is a programming error).
 * Recomputes and pins structure_fingerprint from the carried
 * frozen_topology so the approved object is self-verifying. Returns a
 * NEW object; the draft is untouched. Pure.
 */
export function approveChain(resolvedDraft: ResolvedChain): ResolvedChain {
  const draft = parseOrThrow<ResolvedChain>(ResolvedChainSchema, resolvedDraft);
  if (draft.status !== "draft") {
    throw new NormalizationError([`only a draft can be approved; got status '${draft.status}'`]);
  }
  return { ...draft, status: "approved", structure_fingerprint: sha256(canonicalJson(draft.frozen_topology)) };
}

/**
 * Structural change after freeze → NEW draft at revision + 1 (PRD R1.3).
 * Requires a schema-valid APPROVED chain as the base. The next
 * definition must be logically different from the approved topology —
 * identical resubmission is rejected ("no structural change"). The
 * returned draft carries the approved chain's revision + 1 and fresh
 * provenance/fingerprints from nextDefinition. Pure.
 */
export function reviseChain(
  approved: ResolvedChain,
  nextDefinition: ChainDefinition,
  opts: CompileOptions = {},
): ResolvedChain {
  const base = parseOrThrow<ResolvedChain>(ResolvedChainSchema, approved);
  if (base.status !== "approved") {
    throw new NormalizationError([`revision requires an approved base chain; got status '${base.status}'`]);
  }
  const next = compileChain(nextDefinition, opts);
  if (next.structure_fingerprint === base.structure_fingerprint) {
    throw new NormalizationError([
      "no structural change: resubmitted topology is identical to the approved revision",
    ]);
  }
  return { ...next, revision: base.revision + 1 };
}

/**
 * Freeze-integrity check (Eval Core subject). Recomputes
 * structure_fingerprint over the carried frozen_topology and compares it
 * to the pinned value; any post-freeze mutation of the topology (route
 * flip, added field, reordered array) breaks the hash and throws
 * NormalizationError. When a source ChainDefinition is supplied, its
 * whole-object fingerprint is additionally verified against
 * resolved_from.definition_fingerprint. Returns true on success. Pure.
 */
export function verifyFreezeIntegrity(resolved: ResolvedChain, definition?: ChainDefinition): true {
  const r = parseOrThrow<ResolvedChain>(ResolvedChainSchema, resolved);
  const actual = sha256(canonicalJson(r.frozen_topology));
  if (actual !== r.structure_fingerprint) {
    throw new NormalizationError([
      `freeze integrity violated: structure_fingerprint mismatch (expected ${r.structure_fingerprint}, recomputed ${actual})`,
    ]);
  }
  if (definition !== undefined) {
    const defFp = sha256(canonicalJson(parseOrThrow<ChainDefinition>(ChainDefinitionSchema, definition)));
    if (defFp !== r.resolved_from.definition_fingerprint) {
      throw new NormalizationError([
        `freeze integrity violated: definition_fingerprint mismatch (expected ${r.resolved_from.definition_fingerprint}, recomputed ${defFp})`,
      ]);
    }
  }
  return true;
}
