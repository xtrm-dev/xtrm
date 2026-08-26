/**
 * SRE data-parity harness (xtrm-clg) — retirement proof for decision-matrix
 * Q27: the sre-team workflow must be expressible as a data-defined
 * JsonChainSource that, through the GENERIC contracts/loader/compiler
 * machinery, yields a structure identical to the hard-coded topology in
 * src/chain/topology.ts — with zero SRE-specific code in the generic layers.
 *
 * Parity verdict: EXACT FINGERPRINT. The authored data file is byte-for-byte
 * equivalent (post-normalization) to the hard-coded STEP_DEFS mapped through
 * the documented translation rules, so topologyFingerprint and
 * structure_fingerprint match exactly. definition_fingerprint diverges BY
 * DESIGN: provenance.origin/metadata differ between "authored JSON file" and
 * "in-test mapped hard-coded source" — provenance is excluded from logical
 * equivalence by contract (normalize.ts).
 *
 * DOCUMENTED TRANSLATION DEVIATIONS (findings, see also data/sre-team.chain.json):
 *   F1. ParticipantClass "coordinator" has no AuthoredStepSchema equivalent
 *       (StepClassSchema = step|gate|advisor). Entry/close coordinator steps
 *       are authored as class "step" on BOTH sides of this comparison. This
 *       is a schema-vocabulary gap, not a harness shortcut — escalation-
 *       relevant if coordinator-class semantics are load-bearing downstream.
 *   F2. Per-step model/fallback_model (topology.ts DEFAULT_MODEL/
 *       DEFAULT_FALLBACK) are not authored-form fields; model binding is a
 *       materialization-time concern per ADR-001 §2. Dropped on both sides.
 *   F3. Reviewer verdict routing from the topology.ts docblock maps to:
 *       PASS → route(pass → coordinator-close); FAIL → route(fail →
 *       coordinator-close, which escalates/closes-fail as coordinator);
 *       PARTIAL → bounded remediation loop back_to diagnostician cap 2.
 *       The legacy verdict vocabulary ("PARTIAL") is richer than
 *       VerdictRouteSchema's pass|fail|escalate; remediation is the authored
 *       equivalent declared in chain-source.ts's recorded precedence rule.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAIN_SOURCE_SCHEMA_VERSION,
  InlineTopologySchema,
  JsonChainSourceSchema,
  canonicalJson,
  logicallyEquivalent,
  normalizeJsonSource,
  topologyFingerprint,
  validateInlineTopology,
  type ChainDefinition,
  type InlineTopology,
} from "../src/chain-contracts/index.ts";
import {
  ResolvedChainSchema,
  approveChain,
  compileChain,
  verifyFreezeIntegrity,
} from "../src/chain-compiler/index.ts";
import { buildFixedSreTopology } from "../src/chain/topology.ts";

const ROOT = join(import.meta.dir, "..");
const DATA_FILE = join(ROOT, "data", "sre-team.chain.json");

// ---------------------------------------------------------------------------
// Hard-coded topology → equivalent InlineTopology (documented mapping)
// ---------------------------------------------------------------------------

/** F1: coordinator class has no authored equivalent; nearest is "step". */
function mapClass(c: string): "step" | "gate" | "advisor" {
  return c === "coordinator" ? "step" : (c as "step" | "gate" | "advisor");
}

/** F3: reviewer routing/remediation per the topology.ts docblock semantics. */
function mapRoutesAndRemediation(stepId: string): Pick<InlineTopology["steps"][number], "routes" | "remediation"> {
  if (stepId !== "reviewer") return { routes: [] };
  return {
    routes: [
      { gate: "reviewer", verdict: "pass", target: "coordinator-close" },
      { gate: "reviewer", verdict: "fail", target: "coordinator-close" },
    ],
    remediation: { back_to: "diagnostician", max_iterations: 2 },
  };
}

/** Derive the authored form FROM the hard-coded topology itself. */
function hardcodedTopologyAsInline(): InlineTopology {
  const steps = buildFixedSreTopology().map((s) => ({
    step_id: s.step_id,
    class: mapClass(s.class),
    specialist: { name: s.role }, // role IS the specialist identity
    depends_on: [...s.needs],
    ...mapRoutesAndRemediation(s.step_id),
  }));
  return InlineTopologySchema.parse({ entry_step: "coordinator-entry", policy: {}, steps });
}

function inlineAsJsonSource(t: InlineTopology) {
  return JsonChainSourceSchema.parse({
    schema_version: CHAIN_SOURCE_SCHEMA_VERSION,
    source_kind: "json",
    source_id: "sre-team-hardcoded-mapped",
    name: "sre-team",
    version: "1.0.0",
    provenance: { origin: "test:mapped-hardcoded-topology" },
    topology: t,
    source_metadata: {},
  });
}

// ---------------------------------------------------------------------------
// 1. Data file parses + validates through the generic pipeline
// ---------------------------------------------------------------------------

describe("sre-team.chain.json data file", () => {
  const raw = readFileSync(DATA_FILE, "utf-8");
  const parsed = JsonChainSourceSchema.parse(JSON.parse(raw));

  test("schema_version is xtrm.chain-source.v1 and source is kebab 'sre-team'", () => {
    expect(parsed.schema_version).toBe(CHAIN_SOURCE_SCHEMA_VERSION);
    expect(parsed.source_kind).toBe("json");
    expect(parsed.source_id).toBe("sre-team");
    expect(parsed.provenance.origin).toContain("migration");
  });

  test("inline topology passes referential validation (no problems)", () => {
    expect(validateInlineTopology(parsed.topology)).toEqual([]);
  });

  test("entry step is coordinator-entry with no dependencies", () => {
    expect(parsed.topology.entry_step).toBe("coordinator-entry");
    const entry = parsed.topology.steps.find((s) => s.step_id === parsed.topology.entry_step);
    expect(entry?.depends_on).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Compile → frozen ResolvedChain, deterministic round-trip
// ---------------------------------------------------------------------------

describe("compile determinism and freeze integrity", () => {
  const raw = readFileSync(DATA_FILE, "utf-8");
  const definition = normalizeJsonSource(JsonChainSourceSchema.parse(JSON.parse(raw)));

  test("compiles to a schema-valid draft ResolvedChain", () => {
    const resolved = compileChain(definition);
    expect(ResolvedChainSchema.safeParse(resolved).success).toBe(true);
    expect(resolved.status).toBe("draft");
    expect(resolved.resolved_from.source_id).toBe("sre-team");
  });

  test("approve freezes at same revision; freeze integrity verifies", () => {
    const approved = approveChain(compileChain(definition));
    expect(approved.status).toBe("approved");
    expect(approved.revision).toBe(1);
    expect(verifyFreezeIntegrity(approved, definition)).toBe(true);
  });

  test("byte-level deterministic: parse → normalize → compile twice is identical", () => {
    const compile = (): string =>
      compileChain(normalizeJsonSource(JsonChainSourceSchema.parse(JSON.parse(readFileSync(DATA_FILE, "utf-8")))))
        .structure_fingerprint;
    expect(compile()).toBe(compile());
    const a = compileChain(definition);
    const b = compileChain(definition);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

// ---------------------------------------------------------------------------
// 3. Structural parity: data file vs hard-coded topology (same path)
// ---------------------------------------------------------------------------

describe("structural parity: data-defined vs hard-coded topology", () => {
  const dataDef: ChainDefinition = normalizeJsonSource(
    JsonChainSourceSchema.parse(JSON.parse(readFileSync(DATA_FILE, "utf-8"))),
  );
  const mappedDef: ChainDefinition = normalizeJsonSource(inlineAsJsonSource(hardcodedTopologyAsInline()));

  const edgesOf = (d: ChainDefinition): Array<[string, string]> =>
    d.topology.steps.flatMap((s) => [...new Set(s.depends_on)].sort().map((dep) => [s.step_id, dep] as [string, string])).sort();

  const bindingsOf = (d: ChainDefinition): Record<string, string> =>
    Object.fromEntries(d.topology.steps.map((s) => [s.step_id, s.specialist?.name ?? s.executor?.ref ?? "<none>"]));

  test("identical entry_step", () => {
    expect(dataDef.topology.entry_step).toBe(mappedDef.topology.entry_step);
  });

  test("identical step-id sets (same order after normalization)", () => {
    expect(dataDef.topology.steps.map((s) => s.step_id)).toEqual(mappedDef.topology.steps.map((s) => s.step_id));
  });

  test("identical dependency-edge sets", () => {
    expect(edgesOf(dataDef)).toEqual(edgesOf(mappedDef));
  });

  test("identical specialist bindings", () => {
    expect(bindingsOf(dataDef)).toEqual(bindingsOf(mappedDef));
  });

  test("identical classes under the documented coordinator mapping (F1)", () => {
    expect(dataDef.topology.steps.map((s) => s.class)).toEqual(mappedDef.topology.steps.map((s) => s.class));
  });

  test("identical routes and remediation on the reviewer gate (F3)", () => {
    const revData = dataDef.topology.steps.find((s) => s.step_id === "reviewer");
    const revMapped = mappedDef.topology.steps.find((s) => s.step_id === "reviewer");
    expect(revData?.routes).toEqual(revMapped?.routes);
    expect(revData?.remediation).toEqual(revMapped?.remediation);
  });

  // EXACT-FINGERPRINT verdict
  test("EXACT fingerprint parity: topologyFingerprint matches", () => {
    expect(topologyFingerprint(dataDef)).toBe(topologyFingerprint(mappedDef));
    expect(logicallyEquivalent(dataDef, mappedDef)).toBe(true);
  });

  test("EXACT fingerprint parity: compiled structure_fingerprint matches; definition_fingerprint diverges only via provenance", () => {
    const a = compileChain(dataDef);
    const b = compileChain(mappedDef);
    expect(a.structure_fingerprint).toBe(b.structure_fingerprint);
    // Documented divergence cause: whole-definition hash covers metadata +
    // provenance, which legitimately differ (file vs mapped in-test source).
    expect(a.resolved_from.definition_fingerprint).not.toBe(b.resolved_from.definition_fingerprint);
    expect(a.frozen_topology).toEqual(b.frozen_topology);
  });

  test("hard-coded topology shape sanity (guard against upstream drift)", () => {
    const t = buildFixedSreTopology();
    expect(t.map((s) => s.step_id)).toEqual([
      "coordinator-entry",
      "explorer",
      "observability",
      "diagnostician",
      "reviewer",
      "coordinator-close",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Zero-topology-code proof (Q27): generic layers carry zero SRE identifiers
// ---------------------------------------------------------------------------

const GENERIC_DIRS = [
  "src/chain-contracts",
  "src/chain-loader",
  "src/chain-compiler",
  "src/channel-comm",
  "src/obligation",
  "src/waiting",
  "src/finalize",
];

/** SRE-specific identifiers that must never appear in generic module CODE. */
const SRE_IDENTIFIERS = /explorer|diagnostician|observability|\bsre\b|sre-team/i;
/** Exports of the hard-coded topology module that must never be imported by generic layers. */
const HARDCODED_TOPOLOGY_REFS = /buildFixedSreTopology|newResolvedChain|stepById|chain\/topology/;

/** Strip block comments, line comments and string literals so docblocks don't mask code hits. */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

function* tsFiles(dir: string): Generator<string> {
  for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* tsFiles(p);
    else if (e.name.endsWith(".ts")) yield p;
  }
}

describe("zero-topology-code proof (Q27)", () => {
  test("generic layers contain zero SRE-specific identifiers in code (comments excluded)", () => {
    const offenders: string[] = [];
    for (const dir of GENERIC_DIRS) {
      for (const file of tsFiles(join(ROOT, dir))) {
        const code = stripCommentsAndStrings(readFileSync(file, "utf-8"));
        if (SRE_IDENTIFIERS.test(code)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("generic layers never import or reference the hard-coded sre topology", () => {
    const offenders: string[] = [];
    for (const dir of GENERIC_DIRS) {
      for (const file of tsFiles(join(ROOT, dir))) {
        const code = stripCommentsAndStrings(readFileSync(file, "utf-8"));
        if (HARDCODED_TOPOLOGY_REFS.test(code)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
