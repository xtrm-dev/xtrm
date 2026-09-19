import { describe, expect, it } from "vitest";
import {
  directionGlyph,
  directionPhrase,
  primitiveName,
  readCriteriaEntries,
  readExperimentSemantics,
  readMetricGlossary,
  readQuestionRefs,
  readResultSummary,
  readRunIntent,
} from "./semantics.ts";

describe("experiment semantics readers", () => {
  const def = {
    description: "why the experiment exists",
    hypothesis: "atomic checks separate ready from draft contracts",
    research_question: "can atomic System One checks decide dispatch readiness?",
    primary_outcomes: ["false_ready_rate", "coverage"],
    success_criteria: ["false-READY rate below the incumbent's"],
    falsification_criteria: ["false-READY rate above the incumbent's"],
    non_claims: ["no production adoption"],
    terminology: { Noul: "P(yes); no separate confidence field.", Choice: "one option from a set." },
    legend: { baseline: "deterministic baseline" },
    metric_glossary: {
      auc: {
        label: "ROC AUC",
        description: "Discrimination / ranking performance.",
        unit: "probability",
        direction: "higher_better",
        interpretation: "0.5 is random ranking, 1.0 is perfect.",
      },
      brier: { label: "Brier", description: "Mean squared error of probability forecasts.", direction: "lower_better" },
      odd: { label: "Odd", description: "No stated direction.", direction: "not_a_direction" },
    },
  };

  it("reads every v2 semantic field, keeping question and hypothesis distinct", () => {
    const s = readExperimentSemantics(def);
    expect(s.researchQuestion).toContain("atomic System One checks");
    expect(s.hypothesis).toContain("separate ready from draft");
    expect(s.primaryOutcomes).toEqual(["false_ready_rate", "coverage"]);
    expect(s.successCriteria).toHaveLength(1);
    expect(s.falsificationCriteria).toHaveLength(1);
    expect(s.nonClaims).toEqual(["no production adoption"]);
    expect(s.terminology).toEqual([
      ["Noul", "P(yes); no separate confidence field."],
      ["Choice", "one option from a set."],
    ]);
  });

  it("renders nothing (rather than throwing) for a pre-v2 definition", () => {
    const s = readExperimentSemantics({ id: "old", version: "v1", description: "d", hypothesis: "h" });
    expect(s.researchQuestion).toBeNull();
    expect(s.primaryOutcomes).toBeNull();
    expect(s.successCriteria).toBeNull();
    expect(s.terminology).toBeNull();
    expect(readMetricGlossary({})).toEqual(new Map());
  });

  it("keeps direction and interpretation from the glossary, and degrades an unknown direction explicitly", () => {
    const g = readMetricGlossary(def);
    expect(g.get("auc")).toMatchObject({ label: "ROC AUC", direction: "higher_better", unit: "probability" });
    expect(g.get("brier")!.direction).toBe("lower_better");
    // An unrecognized direction is 'unspecified', never silently treated as higher-is-better.
    expect(g.get("odd")!.direction).toBe("unspecified");
    expect(directionPhrase("unspecified")).toBe("direction not stated");
    expect(directionGlyph("higher_better")).toBe("↑");
    expect(directionGlyph("lower_better")).toBe("↓");
  });

  it("reads the System One question battery refs and the primitive name of each type", () => {
    const refs = readQuestionRefs({ questions: [{ id: "q.a", version: "v1" }, { id: "q.b", version: "v2" }, { id: "no-version" }] });
    expect(refs).toEqual([
      { id: "q.a", version: "v1" },
      { id: "q.b", version: "v2" },
    ]);
    expect(primitiveName("noul")).toBe("noul");
    expect(primitiveName("choice")).toBe("choice");
    expect(primitiveName("score")).toBe("score");
    expect(primitiveName(null)).toBe("unknown");
  });

  it("reads Noul true/false criteria and Choice option criteria", () => {
    const noul = readCriteriaEntries({ true: "the contract states an observable success", false: "success needs chat context" });
    expect(noul).toEqual([
      ["true", "the contract states an observable success"],
      ["false", "success needs chat context"],
    ]);
    const choice = readCriteriaEntries({ repo_only: { true: "files only", false: "needs a live host" }, live_environment: "" });
    // An empty criterion string carries no boundary, so it is dropped rather than rendered blank.
    expect(choice).toEqual([["repo_only", "true: files only; false: needs a live host"]]);
    expect(readCriteriaEntries(undefined)).toBeNull();
    expect(readCriteriaEntries({})).toBeNull();
  });

  it("reads run intent including the optional rationale", () => {
    expect(readRunIntent({ intent: { purpose: "p", trigger: "change_test", rationale: "first rerun after the Substrate migration" } })).toEqual({
      purpose: "p",
      trigger: "change_test",
      rationale: "first rerun after the Substrate migration",
    });
    expect(readRunIntent({})).toEqual({ purpose: null, rationale: null, trigger: null });
  });

  it("reads the latest structured result summary, and returns null when the run has none", () => {
    const annotations = [
      { kind: "conclusion", text: "prose conclusion" },
      {
        kind: "result_summary",
        evidence_status: "exploratory",
        result_summary: {
          plain_language: "Arm B recovered 91% of ready contracts.",
          supported_claims: ["atomic checks carry signal"],
          unsupported_claims: ["production adoption"],
          caveats: ["labels are adjudicated"],
          decision: "keep the incumbent until outcome labels exist",
        },
      },
      // A later summary supersedes the first; the reader takes the last.
      { kind: "result_summary", evidence_status: "reproducible", result_summary: { plain_language: "later", supported_claims: [], unsupported_claims: [], caveats: [], decision: "d" } },
    ];
    const r = readResultSummary(annotations);
    expect(r!.plainLanguage).toBe("later");
    expect(r!.evidenceStatus).toBe("reproducible");
    expect(readResultSummary([{ kind: "conclusion", text: "x" }])).toBeNull();
    // A result_summary without its structured block cannot be rendered as one.
    expect(readResultSummary([{ kind: "result_summary", text: "prose only" }])).toBeNull();
  });
});
