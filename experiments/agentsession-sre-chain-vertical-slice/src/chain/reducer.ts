/**
 * Pure reducer per spec §10.
 *
 *   reduceChain(chain, runState, evidenceProjection, channelProjection, now)
 *     -> { newRunState, intents, logs }
 *
 * Hard invariants:
 *   - No IO, no session creation, no bd mutation, no message posting.
 *   - Idempotent scheduler intents (host-supplied idempotency_key).
 *   - agent_end != step satisfied — satisfaction requires validated evidence.
 *   - Advisor parallelism is reducer-driven (both advisors become ready together
 *     as soon as coordinator-entry is satisfied).
 *   - PARTIAL loop cap = 2; exhaustion → escalation, never invented PASS.
 */

import type {
  AuthoritativeInputs,
  ChainStep,
  ReduceOutput,
  RunState,
  RuntimeFact,
  SchedulerIntent,
  StepExecutionState,
} from "./types.ts";
import { idempotencyKey, participantId, nowIso } from "../util/ids.ts";

export const MAX_REMEDIATION_LOOPS = 2;

/** Deep-clone via structuredClone (Bun + Node ≥17). */
function clone<T>(v: T): T {
  return structuredClone(v);
}

function stepReady(step: ChainStep, run: RunState): boolean {
  return step.needs.every((needId) => run.steps[needId]?.status === "satisfied");
}

function emit(logs: RuntimeFact[], f: RuntimeFact): void {
  logs.push(f);
}

export function reduceChain(input: AuthoritativeInputs): ReduceOutput {
  const { chain, evidence, channel, now } = input;
  const newRunState: RunState = clone(input.runState);
  const intents: SchedulerIntent[] = [];
  const logs: RuntimeFact[] = [];
  const processed = new Set(newRunState.processed_intent_keys);

  // Terminal short-circuits: once closed, no more intents.
  if (newRunState.status.startsWith("closed_")) {
    return { newRunState, intents, logs };
  }
  if (channel.system_done_seen && newRunState.status !== "initialized") {
    newRunState.status = newRunState.reviewer_verdict === "PASS" ? "closed_pass" : "closed_inconclusive";
    newRunState.last_reduce_at = now;
    emit(logs, {
      ts: now,
      chain_id: chain.chain_id,
      kind: "chain.close",
      detail: `system.done consumed; final status=${newRunState.status}`,
    });
    return { newRunState, intents, logs };
  }

  // 1) Coordinator entry-gate: satisfy after it produces its coordinator.decision evidence.
  const entry = newRunState.steps[chain.entry_step_id]!;
  if (entry.status === "produced_result") {
    const hasDecision = (evidence.by_step[chain.entry_step_id] ?? []).some(
      (e) => e.kind === "coordinator.decision",
    );
    if (hasDecision) {
      entry.status = "satisfied";
      entry.last_satisfied_at = now;
      emit(logs, factSatisfied(chain.chain_id, chain.entry_step_id, "coordinator-entry"));
    }
  }

  // 2) Advisors + diagnostician + reviewer: mark satisfied when their evidence kind lands.
  const satisfyOn: Array<{ step: string; kind: string }> = [
    { step: "explorer", kind: "topology.map" },
    { step: "observability", kind: "observability.snapshot" },
    { step: "diagnostician", kind: "diagnostician.report" },
    { step: "reviewer", kind: "reviewer.verdict" },
  ];
  for (const { step, kind } of satisfyOn) {
    const st = newRunState.steps[step];
    if (!st) continue;
    if (st.status === "produced_result") {
      const has = (evidence.by_step[step] ?? []).some((e) => e.kind === kind);
      if (has) {
        st.status = "satisfied";
        st.last_satisfied_at = now;
        emit(logs, factSatisfied(chain.chain_id, step, chain.topology.find((s) => s.step_id === step)!.role));
      }
    }
  }

  // 3) Reviewer verdict routing.
  if (newRunState.steps.reviewer?.status === "satisfied") {
    const lastVerdictEv = (evidence.by_step.reviewer ?? [])
      .filter((e) => e.kind === "reviewer.verdict")
      .at(-1);
    if (lastVerdictEv) {
      const verdict = (lastVerdictEv.summary.match(/\b(PASS|PARTIAL|FAIL)\b/)?.[1] ?? "FAIL") as
        | "PASS"
        | "PARTIAL"
        | "FAIL";
      newRunState.reviewer_verdict = verdict;
      emit(logs, {
        ts: now,
        chain_id: chain.chain_id,
        kind: "reviewer.verdict",
        role: "reviewer",
        step_id: "reviewer",
        detail: verdict,
      });

      if (verdict === "PARTIAL") {
        // Bounded remediation: re-open diagnostician if under cap.
        const diag = newRunState.steps.diagnostician!;
        if (diag.remediation_loops < MAX_REMEDIATION_LOOPS) {
          diag.remediation_loops += 1;
          diag.status = "ready";
          diag.attempts += 1;
          // Reviewer must re-run after new diagnostician evidence.
          const rev = newRunState.steps.reviewer!;
          rev.status = "waiting";
          rev.attempts += 1;
          emit(logs, {
            ts: now,
            chain_id: chain.chain_id,
            kind: "coordinator.action",
            role: "runtime",
            detail: `PARTIAL → remediation loop ${diag.remediation_loops}/${MAX_REMEDIATION_LOOPS} (diagnostician re-open)`,
          });
        } else {
          // Exhaustion → escalate.
          newRunState.status = "escalated";
          emit(logs, {
            ts: now,
            chain_id: chain.chain_id,
            kind: "escalation",
            role: "runtime",
            detail: `remediation exhausted (${MAX_REMEDIATION_LOOPS} loops); coordinator will close inconclusive`,
          });
          // Advance coordinator-close to ready.
          const close = newRunState.steps[chain.close_step_id]!;
          if (close.status === "waiting") close.status = "ready";
        }
      } else if (verdict === "FAIL") {
        newRunState.status = "escalated";
        emit(logs, {
          ts: now,
          chain_id: chain.chain_id,
          kind: "escalation",
          role: "runtime",
          detail: "reviewer FAIL → coordinator will close inconclusive/fail",
        });
        const close = newRunState.steps[chain.close_step_id]!;
        if (close.status === "waiting") close.status = "ready";
      } else {
        // PASS → coordinator-close ready.
        const close = newRunState.steps[chain.close_step_id]!;
        if (close.status === "waiting") close.status = "ready";
      }
    }
  }

  // 4) Coordinator-close: satisfied after it produces coordinator.decision.
  const close = newRunState.steps[chain.close_step_id]!;
  if (close.status === "produced_result") {
    const closeEv = (evidence.by_step[chain.close_step_id] ?? []).some(
      (e) => e.kind === "coordinator.decision",
    );
    if (closeEv) {
      close.status = "satisfied";
      close.last_satisfied_at = now;
      const verdict = newRunState.reviewer_verdict;
      newRunState.status =
        verdict === "PASS" ? "closed_pass" : verdict === "FAIL" ? "closed_fail" : "closed_inconclusive";
      newRunState.close_reason = `verdict=${verdict ?? "unknown"}`;
      emit(logs, {
        ts: now,
        chain_id: chain.chain_id,
        kind: "chain.close",
        detail: `${newRunState.status} (${newRunState.close_reason})`,
      });
      newRunState.last_reduce_at = now;
      return { newRunState, intents, logs };
    }
  }

  // 5) Readiness derivation: any waiting step whose needs are satisfied becomes ready.
  for (const step of chain.topology) {
    const st = newRunState.steps[step.step_id]!;
    if (st.status === "waiting" && stepReady(step, newRunState)) {
      st.status = "ready";
      emit(logs, {
        ts: now,
        chain_id: chain.chain_id,
        kind: "step.ready",
        role: step.role,
        step_id: step.step_id,
        detail: "dependencies satisfied",
      });
    }
  }

  // 6) Dispatch intents for every ready step (idempotency-keyed).
  for (const step of chain.topology) {
    const st = newRunState.steps[step.step_id]!;
    if (st.status !== "ready") continue;
    const intent = mkDispatchIntent(chain.chain_id, step, st);
    if (!processed.has(intent.idempotency_key)) {
      intents.push(intent);
    }
  }

  newRunState.status = newRunState.status === "initialized" && anyRunning(newRunState) ? "running" : newRunState.status;
  if (newRunState.status === "initialized" && (entry.status === "ready" || entry.status === "dispatched")) {
    newRunState.status = "running";
  }
  newRunState.last_reduce_at = now;
  return { newRunState, intents, logs };
}

function anyRunning(run: RunState): boolean {
  return Object.values(run.steps).some((s) => s.status === "dispatched" || s.status === "running");
}

function mkDispatchIntent(
  chainId: string,
  step: ChainStep,
  st: StepExecutionState,
): SchedulerIntent {
  return {
    kind: "dispatch",
    participant_id: st.participant_id,
    step_id: step.step_id,
    attempt: st.attempts,
    idempotency_key: idempotencyKey(chainId, step.step_id, st.attempts, "dispatch"),
    reason: st.remediation_loops > 0 ? `remediation loop ${st.remediation_loops}` : "ready",
  };
}

function factSatisfied(chainId: string, stepId: string, role: string): RuntimeFact {
  return {
    ts: nowIso(),
    chain_id: chainId,
    kind: "step.satisfied",
    role: role as any,
    step_id: stepId,
    detail: `${stepId} satisfied`,
  };
}

/** Initial RunState builder — creates one StepExecutionState per topology step. */
export function initialRunState(chain: import("./types.ts").ResolvedChain, chainRunId: string): RunState {
  const steps: Record<string, StepExecutionState> = {};
  for (const s of chain.topology) {
    steps[s.step_id] = {
      step_id: s.step_id,
      participant_id: participantId(chain.chain_id, s.role),
      attempts: 1,
      status: s.step_id === chain.entry_step_id ? "ready" : "waiting",
      remediation_loops: 0,
    };
  }
  return {
    chain_run_id: chainRunId,
    chain_id: chain.chain_id,
    status: "initialized",
    steps,
    last_reduce_at: nowIso(),
    processed_intent_keys: [],
  };
}
