import { describe, test, expect } from "bun:test";
import { reduceChain, initialRunState, MAX_REMEDIATION_LOOPS } from "../src/chain/reducer.ts";
import { newResolvedChain } from "../src/chain/topology.ts";
import type { AuthoritativeInputs, EvidenceEnvelope } from "../src/chain/types.ts";
import { nowIso } from "../src/util/ids.ts";

function seed() {
  const chain = newResolvedChain({
    chain_id: "chain-test",
    root_bead_id: "bd-root",
    fingerprint: {
      pi_package: { name: "pi", version: "0" },
      beads_version: "bd 0",
      experiment_source_dir: "/dev/null",
      experiment_source_dirty: false,
      baseline_specialists: [],
    },
  });
  const run = initialRunState(chain, "run-x");
  return { chain, run };
}

function ev(step: string, kind: EvidenceEnvelope["kind"], summary = "s"): EvidenceEnvelope {
  return {
    evidence_id: `ev-${step}-${kind}`,
    chain_id: "chain-test",
    producer_participant_id: `chain-test::${step}`,
    producer_role: "explorer" as any,
    step_id: step,
    execution_id: "exec-0",
    kind,
    summary,
    schema_version: 1,
    body_ref: `body-${step}.json`,
    created_at: nowIso(),
    scope_refs: [],
  };
}

function project(all: EvidenceEnvelope[]) {
  const by_step: Record<string, EvidenceEnvelope[]> = {};
  const by_kind: Record<string, EvidenceEnvelope[]> = {};
  for (const e of all) {
    (by_step[e.step_id] ??= []).push(e);
    (by_kind[e.kind] ??= []).push(e);
  }
  return { by_step, by_kind };
}

const noChan = { last_message_id: 0, escalation_pending: false, system_done_seen: false } as any;

describe("reducer", () => {
  test("initial state: only coordinator-entry is ready", () => {
    const { run } = seed();
    expect(run.steps["coordinator-entry"]!.status).toBe("ready");
    for (const other of ["explorer", "observability", "diagnostician", "reviewer", "coordinator-close"]) {
      expect(run.steps[other]!.status).toBe("waiting");
    }
  });

  test("dispatch intent for entry step, keyed idempotent", () => {
    const { chain, run } = seed();
    const input: AuthoritativeInputs = {
      chain, runState: run, evidence: project([]), channel: noChan, now: nowIso(),
    };
    const { intents } = reduceChain(input);
    expect(intents.length).toBe(1);
    expect(intents[0]!.step_id).toBe("coordinator-entry");
    expect(intents[0]!.kind).toBe("dispatch");

    // second reduce with same run must not re-emit (host tracks processed_intent_keys)
    const run2 = { ...run, processed_intent_keys: [intents[0]!.idempotency_key] };
    const { intents: intents2 } = reduceChain({ ...input, runState: run2 });
    expect(intents2.length).toBe(0);
  });

  test("advisors become ready in parallel after coordinator-entry satisfied", () => {
    const { chain, run } = seed();
    run.steps["coordinator-entry"]!.status = "produced_result";
    const evs = [ev("coordinator-entry", "coordinator.decision")];
    const { newRunState, intents } = reduceChain({
      chain, runState: run, evidence: project(evs), channel: noChan, now: nowIso(),
    });
    expect(newRunState.steps["coordinator-entry"]!.status).toBe("satisfied");
    expect(newRunState.steps["explorer"]!.status).toBe("ready");
    expect(newRunState.steps["observability"]!.status).toBe("ready");
    const dispatched = intents.filter((i) => i.kind === "dispatch").map((i) => i.step_id).sort();
    expect(dispatched).toEqual(["explorer", "observability"]);
  });

  test("diagnostician waits for BOTH advisors", () => {
    const { chain, run } = seed();
    run.steps["coordinator-entry"]!.status = "satisfied";
    run.steps["explorer"]!.status = "produced_result";
    const evs = [ev("coordinator-entry", "coordinator.decision"), ev("explorer", "topology.map")];
    const { newRunState, intents } = reduceChain({
      chain, runState: run, evidence: project(evs), channel: noChan, now: nowIso(),
    });
    expect(newRunState.steps["explorer"]!.status).toBe("satisfied");
    expect(newRunState.steps["diagnostician"]!.status).toBe("waiting"); // observability not done
    expect(intents.some((i) => i.step_id === "diagnostician")).toBe(false);
  });

  test("PARTIAL routes bounded remediation, caps at MAX_REMEDIATION_LOOPS", () => {
    const { chain, run } = seed();
    // simulate diagnostician + reviewer both produced result, reviewer verdict PARTIAL
    for (const s of ["coordinator-entry", "explorer", "observability", "diagnostician"]) {
      run.steps[s]!.status = "satisfied";
    }
    run.steps["reviewer"]!.status = "produced_result";
    const evs = [
      ev("coordinator-entry", "coordinator.decision"),
      ev("explorer", "topology.map"),
      ev("observability", "observability.snapshot"),
      ev("diagnostician", "diagnostician.report"),
      ev("reviewer", "reviewer.verdict", "PARTIAL: missing evidence"),
    ];
    let state = run;
    for (let i = 0; i < MAX_REMEDIATION_LOOPS; i++) {
      const { newRunState } = reduceChain({
        chain, runState: state, evidence: project(evs), channel: noChan, now: nowIso(),
      });
      expect(newRunState.steps["diagnostician"]!.remediation_loops).toBe(i + 1);
      // simulate diag re-runs + reviewer re-verdict PARTIAL to keep looping
      newRunState.steps["diagnostician"]!.status = "satisfied";
      newRunState.steps["reviewer"]!.status = "produced_result";
      state = newRunState;
    }
    // one more PARTIAL -> escalation
    const { newRunState: finalState } = reduceChain({
      chain, runState: state, evidence: project(evs), channel: noChan, now: nowIso(),
    });
    expect(finalState.status).toBe("escalated");
  });

  test("PASS routes to coordinator-close ready", () => {
    const { chain, run } = seed();
    for (const s of ["coordinator-entry", "explorer", "observability", "diagnostician"]) {
      run.steps[s]!.status = "satisfied";
    }
    run.steps["reviewer"]!.status = "produced_result";
    const evs = [
      ev("coordinator-entry", "coordinator.decision"),
      ev("explorer", "topology.map"),
      ev("observability", "observability.snapshot"),
      ev("diagnostician", "diagnostician.report"),
      ev("reviewer", "reviewer.verdict", "PASS clean"),
    ];
    const { newRunState } = reduceChain({
      chain, runState: run, evidence: project(evs), channel: noChan, now: nowIso(),
    });
    expect(newRunState.reviewer_verdict).toBe("PASS");
    expect(newRunState.steps["coordinator-close"]!.status).toBe("ready");
  });

  test("agent_end alone does not satisfy a step (produced_result without evidence)", () => {
    const { chain, run } = seed();
    run.steps["coordinator-entry"]!.status = "produced_result";
    const { newRunState } = reduceChain({
      chain, runState: run, evidence: project([]), channel: noChan, now: nowIso(),
    });
    expect(newRunState.steps["coordinator-entry"]!.status).toBe("produced_result"); // NOT satisfied
  });
});
