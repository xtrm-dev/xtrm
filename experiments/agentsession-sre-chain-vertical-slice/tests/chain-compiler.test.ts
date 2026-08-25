/**
 * Pure compiler tests (xtrm-qcy.3).
 *
 * Covers: draft compilation + ResolvedChainSchema validity; fingerprint
 * correctness (spot-computed against canonicalJson); byte-level
 * determinism; scrutiny floor-only-raise; default-deny capability
 * binding; freeze (approve) semantics incl. double-approval rejection;
 * revision discipline (reviseChain, no-structural-change rejection);
 * freeze-integrity verification under topology tampering; invalid-input
 * rejection via NormalizationError; formula-path vs json-path logical
 * equivalence of compiled output.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  CHAIN_SOURCE_SCHEMA_VERSION,
  JsonChainSourceSchema,
  NormalizationError,
  canonicalJson,
  normalizeJsonSource,
  type ChainDefinition,
  type JsonChainSource,
} from "../src/chain-contracts/index.ts";
import { loadFormulaAsset } from "../src/chain-loader/index.ts";
import {
  RESOLVED_CHAIN_SCHEMA_VERSION,
  approveChain,
  compileChain,
  resolveCapabilityGrants,
  reviseChain,
  verifyFreezeIntegrity,
  type GrantsPolicy,
  ResolvedChainSchema,
  type ResolvedChain,
} from "../src/chain-compiler/index.ts";


// ---------------------------------------------------------------------------
// Fixtures — hand-built ChainDefinitions via the qcy.1 json path
// ---------------------------------------------------------------------------

function jsonSource(name: string, topology: Record<string, unknown>, version = "1.0.0"): JsonChainSource {
  return JsonChainSourceSchema.parse({
    schema_version: CHAIN_SOURCE_SCHEMA_VERSION,
    source_id: name,
    name,
    version,
    provenance: { origin: "test:inline" },
    source_kind: "json",
    topology,
  });
}

/** Three-step chain with a gate and verdict routes back into the graph. */
function gateTopology(policyScrutiny?: string): Record<string, unknown> {
  return {
    entry_step: "root",
    ...(policyScrutiny !== undefined ? { policy: { scrutiny: policyScrutiny } } : { policy: {} }),
    steps: [
      { step_id: "root", executor: { kind: "deterministic", ref: "entry" }, depends_on: [], routes: [] },
      {
        step_id: "work",
        specialist: { name: "worker" },
        depends_on: ["root"],
        routes: [],
        capability_requests: { required_tools: ["bash", "read"], required_skills: ["triage"] },
      },
      {
        step_id: "check-gate",
        class: "gate",
        specialist: { name: "gatekeeper" },
        depends_on: ["work"],
        routes: [
          { gate: "check-gate", verdict: "pass", target: "work" },
          { gate: "check-gate", verdict: "fail", target: "root" },
        ],
      },
    ],
  };
}

function compileGateChain(policyScrutiny?: string, grantsPolicy?: GrantsPolicy): ResolvedChain {
  return compileChain(normalizeJsonSource(jsonSource("gate-chain", gateTopology(policyScrutiny))), {
    ...(grantsPolicy !== undefined ? { grantsPolicy } : {}),
  });
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Compilation & fingerprints
// ---------------------------------------------------------------------------

describe("compileChain", () => {
  test("valid definition compiles to a schema-valid draft with correct fingerprints", () => {
    const def = normalizeJsonSource(jsonSource("gate-chain", gateTopology()));
    const resolved = compileChain(def);

    expect(resolved.status).toBe("draft");
    expect(resolved.schema_version).toBe(RESOLVED_CHAIN_SCHEMA_VERSION);
    expect(resolved.chain_id).toBe("gate-chain");
    expect(resolved.revision).toBe(1);
    expect(ResolvedChainSchema.safeParse(resolved).success).toBe(true);

    // Spot-compute both fingerprints independently.
    expect(resolved.structure_fingerprint).toBe(sha256(canonicalJson(resolved.frozen_topology)));
    expect(resolved.resolved_from.definition_fingerprint).toBe(sha256(canonicalJson(def)));

    // Provenance pointers only.
    expect(resolved.resolved_from).toEqual({
      source_kind: "json",
      source_id: "gate-chain",
      source_version: "1.0.0",
      definition_fingerprint: sha256(canonicalJson(def)),
    });

    // Verbatim structural copy.
    expect(resolved.frozen_topology).toEqual(def.topology);
  });

  test("determinism: two compilations produce identical canonical JSON bytes", () => {
    const a = compileGateChain("medium");
    const b = compileGateChain("medium");
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test("no runtime entities anywhere in the output", () => {
    const resolved = compileGateChain();
    const text = canonicalJson(resolved);
    for (const forbidden of ['"job_id"', '"bead_id"', '"pi_session_id"', '"attempts"', '"status_per_step"', '"created_at"']) {
      expect(text.includes(forbidden)).toBe(false);
    }
  });

  test("garbage input → NormalizationError", () => {
    expect(() => compileChain({ nonsense: true } as unknown as ChainDefinition)).toThrow(NormalizationError);
    expect(() => compileChain(null as unknown as ChainDefinition)).toThrow(NormalizationError);
  });
});

// ---------------------------------------------------------------------------
// Scrutiny floor-only-raise
// ---------------------------------------------------------------------------

describe("scrutiny floor-only-raise", () => {
  test("step high raises above chain floor medium", () => {
    const def = normalizeJsonSource(
      jsonSource("scr-chain", {
        entry_step: "s1",
        policy: { scrutiny: "medium" },
        steps: [
          {
            step_id: "s1",
            specialist: { name: "worker" },
            depends_on: [],
            routes: [],
            policy_inputs: { scrutiny: "high" },
          },
        ],
      }),
    );
    expect(compileChain(def).effective.scrutiny["s1"]).toBe("high");
  });

  test("step low cannot lower chain floor medium", () => {
    const def = normalizeJsonSource(
      jsonSource("scr-chain2", {
        entry_step: "s1",
        policy: { scrutiny: "medium" },
        steps: [
          {
            step_id: "s1",
            specialist: { name: "worker" },
            depends_on: [],
            routes: [],
            policy_inputs: { scrutiny: "low" },
          },
        ],
      }),
    );
    expect(compileChain(def).effective.scrutiny["s1"]).toBe("medium");
  });

  test("no declarations at all → keys absent (absence = unset)", () => {
    const r = compileGateChain(); // no chain floor, no step declarations
    expect(Object.keys(r.effective.scrutiny).length).toBe(0);
    expect("work" in r.effective.scrutiny).toBe(false);
  });

  test("floor applies to unscrutinized steps", () => {
    const def = normalizeJsonSource(
      jsonSource("scr-chain3", {
        entry_step: "s1",
        policy: { scrutiny: "high" },
        steps: [{ step_id: "s1", specialist: { name: "worker" }, depends_on: [], routes: [] }],
      }),
    );
    expect(compileChain(def).effective.scrutiny["s1"]).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Capability grants — default deny
// ---------------------------------------------------------------------------

describe("resolveCapabilityGrants", () => {
  test("requested ∩ allowed granted; unrequested-but-allowed NOT granted; requested-but-unallowed NOT granted", () => {
    const r = compileGateChain(undefined, {
      allowed_tools: ["bash", "write"], // write allowed but never requested
      allowed_skills: ["triage"],
    });
    // bash+read requested, only bash allowed → grant is exactly [bash].
    expect(r.effective.capability_grants["work"]).toEqual({ tools: ["bash"], skills: ["triage"] });
    // Steps requesting nothing get empty grants.
    expect(r.effective.capability_grants["root"]).toEqual({ tools: [], skills: [] });
    expect(r.effective.capability_grants["check-gate"]).toEqual({ tools: [], skills: [] });
  });

  test("default deny without a policy → all grants empty", () => {
    const r = compileGateChain();
    for (const g of Object.values(r.effective.capability_grants)) {
      expect(g).toEqual({ tools: [], skills: [] });
    }
  });

  test("requests never leak into grants unfiltered", () => {
    const steps = [
      {
        step_id: "greedy",
        specialist: { name: "w" },
        depends_on: [],
        routes: [],
        capability_requests: { required_tools: ["bash", "net"], required_skills: ["exfil"] },
      },
    ] as unknown as Parameters<typeof resolveCapabilityGrants>[0];
    const grants = resolveCapabilityGrants(steps, { allowed_tools: ["read"], allowed_skills: [] });
    expect(grants["greedy"]).toEqual({ tools: [], skills: [] });
  });

  test("'*' has no wildcard semantics — literal intersection only", () => {
    const steps = [
      {
        step_id: "star",
        specialist: { name: "w" },
        depends_on: [],
        routes: [],
        capability_requests: { required_tools: ["*"] },
      },
    ] as unknown as Parameters<typeof resolveCapabilityGrants>[0];
    // Allowlist "*" matches only a literal "*" request here — but real
    // tool requests are not expanded, so nothing else leaks.
    const grants = resolveCapabilityGrants(steps, { allowed_tools: ["*"] });
    expect(grants["star"]!.tools).toEqual(["*"]);
    expect(resolveCapabilityGrants(steps, { allowed_tools: ["bash"] })["star"]!.tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Freeze semantics
// ---------------------------------------------------------------------------

describe("approveChain", () => {
  test("draft → approved at same revision, fingerprint recomputed and pinned", () => {
    const draft = compileGateChain("medium");
    const approved = approveChain(draft);
    expect(approved.status).toBe("approved");
    expect(approved.revision).toBe(draft.revision);
    expect(approved.structure_fingerprint).toBe(sha256(canonicalJson(approved.frozen_topology)));
    expect(approved.structure_fingerprint).toBe(draft.structure_fingerprint);
    // Input untouched.
    expect(draft.status).toBe("draft");
  });

  test("double-approval rejected", () => {
    const approved = approveChain(compileGateChain());
    expect(() => approveChain(approved as unknown as ResolvedChain)).toThrow(NormalizationError);
    expect(() => approveChain(approved)).toThrow(/only a draft can be approved/);
  });

  test("verifyFreezeIntegrity passes on untampered approved chain", () => {
    const def = normalizeJsonSource(jsonSource("gate-chain", gateTopology()));
    const approved = approveChain(compileChain(def));
    expect(verifyFreezeIntegrity(approved)).toBe(true);
    expect(verifyFreezeIntegrity(approved, def)).toBe(true);
  });

  test("tampered frozen_topology (flipped route target) → throws", () => {
    const approved = approveChain(compileGateChain());
    const tampered = structuredClone(approved);
    const gateStep = tampered.frozen_topology.steps.find((s: unknown) => (s as { step_id: string }).step_id === "check-gate") as {
      routes: Array<{ verdict: string; target: string }>;
    };
    // Normalized routes sort (fail→root) before (pass→work); flip the
    // fail-route target so the mutation is a real change.
    gateStep.routes[0]!.target = "work"; // was "root"
    expect(() => verifyFreezeIntegrity(tampered)).toThrow(NormalizationError);
    expect(() => verifyFreezeIntegrity(tampered)).toThrow(/freeze integrity violated/);
  });

  test("added field in frozen_topology → throws (strict schema + hash mismatch)", () => {
    const approved = approveChain(compileGateChain());
    const tampered = structuredClone(approved) as unknown as Record<string, unknown>;
    (tampered.frozen_topology as Record<string, unknown>)["injected"] = true;
    expect(() => verifyFreezeIntegrity(tampered as unknown as ResolvedChain)).toThrow();
  });

  test("definition_fingerprint verified when source definition supplied", () => {
    const def = normalizeJsonSource(jsonSource("gate-chain", gateTopology()));
    const approved = approveChain(compileChain(def));
    const otherDef = normalizeJsonSource(jsonSource("gate-chain", gateTopology("high")));
    expect(() => verifyFreezeIntegrity(approved, otherDef)).toThrow(/definition_fingerprint mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Revision discipline
// ---------------------------------------------------------------------------

describe("reviseChain", () => {
  test("changed structure → new DRAFT at revision+1", () => {
    const v1 = normalizeJsonSource(jsonSource("rev-chain", gateTopology()));
    const approved = approveChain(compileChain(v1));

    const topoV2 = gateTopology() as { entry_step: string; policy: Record<string, unknown>; steps: Record<string, unknown>[] };
    topoV2.steps[1]!.capability_requests = {
      required_tools: ["bash", "read", "write"],
      required_skills: ["triage"],
    };
    const v2def = normalizeJsonSource(jsonSource("rev-chain", topoV2));
    const revised = reviseChain(approved, v2def);

    expect(revised.status).toBe("draft");
    expect(revised.revision).toBe(approved.revision + 1);
    expect(revised.structure_fingerprint).not.toBe(approved.structure_fingerprint);
  });

  test("identical resubmission rejected ('no structural change')", () => {
    const def = normalizeJsonSource(jsonSource("rev-chain", gateTopology()));
    const approved = approveChain(compileChain(def));
    expect(() => reviseChain(approved, def)).toThrow(/no structural change/);
  });

  test("revision requires an approved base", () => {
    const def = normalizeJsonSource(jsonSource("rev-chain", gateTopology()));
    const draft = compileChain(def);
    expect(() => reviseChain(draft, def)).toThrow(/approved base/);
  });
});

// ---------------------------------------------------------------------------
// Cross-variant equivalence: formula path vs json path
// ---------------------------------------------------------------------------

describe("cross-variant equivalence", () => {
  function miniAsset(): Record<string, unknown> {
    return {
      formula: "mini",
      type: "workflow",
      version: 1,
      description: "Mini chain.",
      steps: [
        { id: "root", title: "Root", type: "task", labels: ["chain-root", "kind:root"] },
        {
          id: "worker",
          title: "Worker",
          type: "task",
          needs: ["root"],
          labels: ["chain-step", "kind:step", "role:explorer"],
        },
      ],
    };
  }

  test("formula-loaded and json-loaded same shape compile to equal structure_fingerprints", () => {
    const viaFormula = loadFormulaAsset(miniAsset(), { path: "test/mini.formula.json" });
    const viaJson = normalizeJsonSource(
      jsonSource("mini", {
        entry_step: "root",
        policy: {},
        steps: [
          { step_id: "root", title: "Root", executor: { kind: "deterministic", ref: "formula-root" }, depends_on: [], routes: [] },
          { step_id: "worker", title: "Worker", specialist: { name: "explorer" }, depends_on: ["root"], routes: [] },
        ],
      }),
    );
    expect(viaFormula.provenance.source_kind).toBe("imported");
    expect(viaJson.provenance.source_kind).toBe("json");

    const rf = compileChain(viaFormula);
    const rj = compileChain(viaJson);
    expect(rf.structure_fingerprint).toBe(rj.structure_fingerprint);
    expect(canonicalJson(rf.frozen_topology)).toBe(canonicalJson(rj.frozen_topology));
    // Provenance still differs per variant — pointers, never structure.
    expect(rf.resolved_from.definition_fingerprint).not.toBe(rj.resolved_from.definition_fingerprint);
  });
});
