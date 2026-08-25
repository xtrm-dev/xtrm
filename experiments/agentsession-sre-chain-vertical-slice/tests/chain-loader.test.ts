/**
 * ChainLoader tests (xtrm-qcy.2).
 *
 * Covers: all 15 real shipped formula assets parse/validate/normalize;
 * determinism (fingerprint + canonical JSON across repeated loads); var
 * substitution and deterministic rejection (missing required, unknown
 * token); entry-root rules; needs-cycle rejection via qcy.1 validation;
 * template resolution incl. version-mismatch behavior; change-contract
 * root paths (template-only / inline-only / both / neither);
 * template-path vs formula-path logical equivalence.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildFormulaCatalog,
  loadChangeContractRoot,
  loadFormulaAsset,
  loadTemplate,
  parseFormulaAsset,
} from "../src/chain-loader/index.ts";
import {
  canonicalJson,
  logicallyEquivalent,
  NormalizationError,
  normalizeImportedSource,
  topologyFingerprint,
} from "../src/chain-contracts/index.ts";

const FORMULA_DIR = "/home/dawid/dev/specialists/docs/design/roadmap/chain-templates";

function loadRealCatalog() {
  const files = readdirSync(FORMULA_DIR).filter((f) => f.endsWith(".formula.json")).sort();
  return {
    files,
    catalog: buildFormulaCatalog(
      files.map((f) => ({ bytes: readFileSync(join(FORMULA_DIR, f)), path: join(FORMULA_DIR, f) })),
    ),
  };
}

// Minimal two-step inline asset for targeted fixtures.
function miniAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formula: "mini",
    type: "workflow",
    version: 1,
    description: "Mini {{root_title}} chain.",
    vars: { root_title: { default: "Mini work", required: false }, scope: { default: "src/**", required: false } },
    steps: [
      {
        id: "root",
        title: "{{root_title}}",
        type: "task",
        description: "Root step for {{root_title}}.",
        labels: ["chain-root", "kind:root"],
      },
      {
        id: "worker",
        title: "worker:{{root_title}}",
        type: "task",
        needs: ["root"],
        description: "Worker step in {{scope}}.",
        labels: ["chain-step", "kind:step", "role:explorer", "edge:informs->root", "advisor:pre-impl"],
      },
    ],
    ...overrides,
  };
}

describe("formula assets — all 15 real assets", () => {
  const { files, catalog } = loadRealCatalog();

  test("catalog has exactly 15 entries", () => {
    expect(files.length).toBe(15);
    expect(catalog.size).toBe(15);
  });

  test("every formula parses, validates and normalizes to a valid ChainDefinition", () => {
    for (const name of catalog.keys()) {
      const def = loadTemplate({ template: { name } }, catalog);
      expect(def.schema_version).toBe("xtrm.chain-definition.v1");
      expect(def.provenance.source_id).toBe(name);
      expect(def.topology.steps.length).toBeGreaterThan(0);
      // entry_step is the kind:root step and exists.
      expect(def.topology.steps.some((s) => s.step_id === def.topology.entry_step)).toBe(true);
      // No invented gates/routes/remediation.
      for (const s of def.topology.steps) {
        expect(s.class === "gate" || s.routes.length > 0 || s.remediation !== undefined).toBe(false);
      }
    }
  });

  test("code-with-advisors dangling needs (conditional advisors) are dropped", () => {
    const def = loadTemplate({ template: { name: "code-with-advisors" } }, catalog);
    const executor = def.topology.steps.find((s) => s.step_id === "executor")!;
    // explorer/researcher/overthinker do not exist in the asset; the
    // declared-but-dangling refs must not survive into the definition.
    expect(executor.depends_on).toEqual([]);
    expect(def.topology.steps.some((s) => s.step_id === "explorer")).toBe(false);
  });

  test("triage maps advisors + specialists deterministically", () => {
    const src = parseFormulaAsset(catalog.get("triage")!.asset, { path: "triage.formula.json" });
    expect(src.source_kind).toBe("imported");
    expect(src.import_ref.path).toBe("triage.formula.json");
    expect(src.import_ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    const t = src.topology;
    expect(t.entry_step).toBe("root");
    expect(t.steps.map((s) => s.step_id)).toEqual(["root", "explorer", "overthinker"]);
    expect(t.steps[0]!.executor).toEqual({ kind: "deterministic", ref: "formula-root" });
    expect(t.steps[1]!.class).toBe("advisor"); // advisor:pre-impl label
    expect(t.steps[1]!.specialist).toEqual({ name: "explorer" });
    expect(t.steps[2]!.specialist).toEqual({ name: "overthinker" });
    expect(t.steps[1]!.depends_on).toEqual(["root"]);
  });

  test("import_ref sha256 is over canonical bytes of the raw asset", () => {
    const entry = catalog.get("triage")!;
    const src = parseFormulaAsset(entry.asset, { path: entry.path });
    expect(src.import_ref.sha256).toBe(entry.sha256);
  });
});

describe("determinism", () => {
  test("loading a formula twice yields identical fingerprint and canonical JSON", () => {
    const { catalog } = loadRealCatalog();
    const a = loadTemplate({ template: { name: "code-with-tests" } }, catalog);
    const b = loadTemplate({ template: { name: "code-with-tests" } }, catalog);
    expect(topologyFingerprint(a)).toBe(topologyFingerprint(b));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test("direct-formula path vs imported-normalize path agree", () => {
    const { catalog } = loadRealCatalog();
    const entry = catalog.get("debug")!;
    const direct = loadFormulaAsset(entry.asset, { path: entry.path });
    const viaSource = normalizeImportedSource(parseFormulaAsset(entry.asset, { path: entry.path }));
    expect(logicallyEquivalent(direct, viaSource)).toBe(true);
  });
});

describe("var substitution", () => {
  test("supplied vars override defaults and appear in output text", () => {
    const def = loadFormulaAsset(miniAsset(), { vars: { root_title: "Fix the flux capacitor" } });
    expect(def.metadata.title).toContain("Fix the flux capacitor");
    const root = def.topology.steps.find((s) => s.step_id === "root")!;
    expect(root.title).toBe("Fix the flux capacitor");
  });

  test("defaults apply when no vars supplied", () => {
    const def = loadFormulaAsset(miniAsset());
    expect(def.metadata.title).toContain("Mini work");
  });

  test("missing required var without default is rejected, listing the var", () => {
    expect(() =>
      loadFormulaAsset(
        miniAsset({ vars: { root_title: { required: true } } }),
      ),
    ).toThrow(NormalizationError);
  });

  test("unknown {{token}} is rejected deterministically", () => {
    expect(() =>
      loadFormulaAsset(miniAsset({ steps: [
        {
          id: "root",
          title: "{{nope}}",
          labels: ["kind:root"],
        },
        { id: "w", needs: ["root"], labels: ["role:explorer"] },
      ] })),
    ).toThrow(/var 'nope' has no value/);
  });

  test("supplying an undeclared var is rejected", () => {
    expect(() => loadFormulaAsset(miniAsset(), { vars: { bogus: "x" } })).toThrow(/not declared/);
  });
});

describe("entry-root rules", () => {
  test("no kind:root step is rejected", () => {
    expect(() =>
      loadFormulaAsset(miniAsset({ steps: [{ id: "a", labels: ["role:explorer"] }] })),
    ).toThrow(/no step labeled 'kind:root'/);
  });

  test("two kind:root steps are rejected", () => {
    expect(() =>
      loadFormulaAsset(miniAsset({ steps: [
        { id: "r1", labels: ["kind:root"] },
        { id: "r2", labels: ["kind:root"] },
      ] })),
    ).toThrow(/multiple 'kind:root' steps/);
  });

  test("needs-cycle in a hand-built fixture is rejected by qcy.1 cycle detection", () => {
    const cyc = miniAsset({
      steps: [
        { id: "root", labels: ["kind:root"], needs: ["b"] },
        { id: "b", labels: ["role:explorer"], needs: ["c"] },
        { id: "c", labels: ["role:explorer"], needs: ["root"] },
      ],
    });
    let msg = "";
    try {
      loadFormulaAsset(cyc);
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toContain("dependency cycle");
  });
});

describe("template resolution", () => {
  test("resolves triage by name through the full template path", () => {
    const { catalog } = loadRealCatalog();
    const def = loadTemplate({ template: { name: "triage", catalog_ref: "chain-templates/" } }, catalog);
    expect(def.provenance.source_kind).toBe("template");
    expect(def.provenance.source_id).toBe("triage");
    expect(def.topology.entry_step).toBe("root");
  });

  test("unknown template name is rejected", () => {
    const { catalog } = loadRealCatalog();
    expect(() => loadTemplate({ template: { name: "does-not-exist" } }, catalog)).toThrow(NormalizationError);
  });

  test("version mismatch is an explicit error; matching version passes", () => {
    const { catalog } = loadRealCatalog();
    expect(() =>
      loadTemplate({ template: { name: "triage", version: "2.0.0" } }, catalog),
    ).toThrow(/requested at version 2.0.0; catalog has 1\.0\.0/);
    const ok = loadTemplate({ template: { name: "triage", version: "1.0.0" } }, catalog);
    expect(ok.metadata.version).toBe("1.0.0");
  });

  test("template vars override defaults", () => {
    const { catalog } = loadRealCatalog();
    const def = loadTemplate(
      { template: { name: "triage" }, vars: { root_title: "Q3 board scrub", filter: "status=in_progress" } },
      catalog,
    );
    const root = def.topology.steps.find((s) => s.step_id === "root")!;
    expect(root.title).toBe("Q3 board scrub");
  });
});

describe("change-contract roots (Q25)", () => {
  const { catalog } = loadRealCatalog();

  test("recommended_template-only resolves via the catalog", () => {
    const def = loadChangeContractRoot({ recommended_template: "doc-sync" }, catalog);
    expect(def.provenance.source_kind).toBe("template");
    expect(def.provenance.source_id).toBe("doc-sync");
  });

  test("recommended_template with version + vars", () => {
    const def = loadChangeContractRoot(
      { recommended_template: "triage", recommended_template_version: "1.0.0", vars: { root_title: "Contract-driven scrub" } },
      catalog,
    );
    const root = def.topology.steps.find((s) => s.step_id === "root")!;
    expect(root.title).toBe("Contract-driven scrub");
  });

  test("inline steps only → json-equivalent authored topology", () => {
    const def = loadChangeContractRoot(
      {
        source_id: "my-change",
        version: "1.2.3",
        entry_step: "root",
        steps: [
          { step_id: "root", executor: { kind: "deterministic", ref: "formula-root" } },
          { step_id: "work", specialist: { name: "executor" }, depends_on: ["root"] },
        ],
      },
      catalog,
    );
    expect(def.provenance.source_kind).toBe("json");
    expect(def.metadata.name).toBe("my-change");
    expect(def.metadata.version).toBe("1.2.3");
    expect(def.topology.entry_step).toBe("root");
  });

  test("both template and inline steps → ambiguous error", () => {
    expect(() =>
      loadChangeContractRoot(
        {
          recommended_template: "triage",
          steps: [{ step_id: "root", executor: { kind: "deterministic", ref: "formula-root" } }],
        },
        catalog,
      ),
    ).toThrow(/ambiguous base shape/);
  });

  test("neither → error", () => {
    expect(() => loadChangeContractRoot({ description: "empty" }, catalog)).toThrow(/neither recommended_template nor inline steps/);
  });
});

describe("cross-path equivalence", () => {
  test("definition via template path vs direct formula path are logically equivalent", () => {
    const { catalog } = loadRealCatalog();
    const entry = catalog.get("research-only")!;
    const viaTemplate = loadTemplate({ template: { name: "research-only" } }, catalog);
    const direct = loadFormulaAsset(entry.asset, { path: entry.path });
    expect(logicallyEquivalent(viaTemplate, direct)).toBe(true);
    // Provenance still distinguishes the paths.
    expect(viaTemplate.provenance.source_kind).toBe("template");
    expect(direct.provenance.source_kind).toBe("imported");
  });
});
