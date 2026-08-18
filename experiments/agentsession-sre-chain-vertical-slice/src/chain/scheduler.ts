/**
 * Scheduler / effect executor per spec §10.
 *
 * Consumes SchedulerIntents produced by the pure reducer. Executes only
 * `dispatch` and `terminalize` in this vertical slice (`resume` is folded
 * into `dispatch` since Pi sessions are per-activation). Idempotency keys
 * are recorded in run_state.processed_intent_keys before dispatch to prevent
 * duplicate work on reducer re-runs.
 */

import type {
  AuthoritativeInputs,
  ChainStep,
  ParticipantIdentity,
  ResolvedChain,
  RunState,
  RuntimeFact,
  SchedulerIntent,
  StepExecutionState,
} from "./types.ts";
import type { Paths } from "./store.ts";
import { appendIntent, loadBeadsMap, loadRunState, saveChainProgress, saveRunState } from "./store.ts";
import { reduceChain } from "./reducer.ts";
import { projectEvidence } from "../evidence/index.ts";
import { readMessages } from "../chain/store.ts";
import { dispatchActivation } from "../agents/bridge.ts";
import { runtimePost } from "../channels/index.ts";
import { executionId, nowIso, participantId } from "../util/ids.ts";
import { stepById } from "./topology.ts";
import { chainEpicIdOf, closeBead, noteBead } from "../adapters/beads.ts";

export interface SchedulerContext {
  paths: Paths;
  chain: ResolvedChain;
  channelId: string;
  targetRepo: string;
  onFact: (fact: RuntimeFact) => void;
  maxIterations?: number; // safety cap
}

function makeIdentity(chain: ResolvedChain, step: ChainStep, st: StepExecutionState): ParticipantIdentity {
  const pid = participantId(chain.chain_id, step.role);
  const attempt = st.attempts;
  const exec = executionId(pid, attempt);
  return {
    chain_id: chain.chain_id,
    step_id: step.step_id,
    step_bead_id: "", // filled by caller when a bead map is provided
    role: step.role,
    class: step.class,
    participant_id: pid,
    execution_id: exec,
    attempt,
  };
}

function assignmentPrompt(args: {
  chain: ResolvedChain;
  step: ChainStep;
  identity: ParticipantIdentity;
  incidentBrief: string;
  upstreamEvidence: Array<{ role: string; evidence_id: string; kind: string; summary: string }>;
}): string {
  const upstream = args.upstreamEvidence.length
    ? args.upstreamEvidence
        .map((e) => `- from ${e.role}: evidence_id=${e.evidence_id} kind=${e.kind} summary=${JSON.stringify(e.summary)}`)
        .join("\n")
    : "(none — you are the entry participant)";
  return [
    "## Assignment",
    `chain_id: ${args.chain.chain_id}`,
    `step_id: ${args.step.step_id}`,
    `role: ${args.step.role}`,
    `class: ${args.step.class}`,
    `participant_id: ${args.identity.participant_id}`,
    `execution_id: ${args.identity.execution_id}`,
    `attempt: ${args.identity.attempt}`,
    "",
    "## Incident brief (from operator, verbatim)",
    args.incidentBrief.trim() || "(empty — this is an ambient triage; treat as bare launch)",
    "",
    "## Upstream evidence pointers (dereference via evidence_get when needed)",
    upstream,
    "",
    "## What you MUST do (exit criteria)",
    "1. Publish ONE evidence via `evidence_publish` whose `kind` matches your step contract.",
    "2. Post ONE `work.turn` message via `channel_post` referencing that evidence_id.",
    "3. Then stop — agent_end alone does NOT satisfy your step. Evidence + work.turn is the exit contract.",
  ].join("\n");
}

async function upstreamEvidenceFor(paths: Paths, step: ChainStep) {
  const proj = await projectEvidence(paths);
  const all = Object.values(proj.by_step).flat();
  return all
    .filter((e) => step.needs.includes(e.step_id))
    .map((e) => ({
      role: e.producer_role,
      evidence_id: e.evidence_id,
      kind: e.kind,
      summary: e.summary,
    }));
}

async function projectionChannel(paths: Paths, channelId: string) {
  const msgs = await readMessages(paths);
  const inChan = msgs.filter((m) => m.channel_id === channelId);
  const lastId = inChan.reduce((mx, m) => (m.id > mx ? m.id : mx), 0);
  const lastVerdict = inChan.filter((m) => m.kind === "work.verdict").at(-1);
  return {
    last_message_id: lastId,
    outstanding_verdict: undefined,
    escalation_pending: inChan.some((m) => m.kind === "control.escalation"),
    system_done_seen: inChan.some((m) => m.kind === "system.done"),
  } as const;
}

export async function runToCompletion(
  ctx: SchedulerContext,
  incidentBrief: string,
): Promise<void> {
  const maxIters = ctx.maxIterations ?? 40;
  for (let iter = 0; iter < maxIters; iter++) {
    const run = (await loadRunState(ctx.paths))!;
    const evidence = await projectEvidence(ctx.paths);
    const channel = await projectionChannel(ctx.paths, ctx.channelId);
    const input: AuthoritativeInputs = {
      chain: ctx.chain,
      runState: run,
      evidence,
      channel,
      now: nowIso(),
    };
    const { newRunState, intents, logs } = reduceChain(input);
    for (const l of logs) ctx.onFact(l);
    await saveRunState(ctx.paths, newRunState);
    await saveChainProgress(ctx.paths, projectChainProgress(newRunState));

    // Reconcile beads for any newly-satisfied steps (spec §11: bounded Bead evidence/note).
    await reconcileBeads(ctx, run, newRunState, evidence);

    if (newRunState.status.startsWith("closed_")) {
      const beadsMap = await loadBeadsMap(ctx.paths);
      if (beadsMap) {
        const epicId = chainEpicIdOf(beadsMap);
        await closeBead(
          ctx.paths.beadsDbDir,
          epicId,
          `chain closed: ${newRunState.status} (verdict=${newRunState.reviewer_verdict ?? "-"})`,
        ).catch((e: any) => {
          // Surface — never silently swallow chain-authority disagreement.
          process.stderr.write(`[scheduler] closing ChainRun Epic ${epicId} failed: ${e?.message ?? e}\n`);
        });
        ctx.onFact({
          ts: nowIso(),
          chain_id: ctx.chain.chain_id,
          role: "runtime",
          kind: "chain.close",
          detail: `ChainRun Epic ${epicId} closed`,
        });
      }
      ctx.onFact({
        ts: nowIso(),
        chain_id: ctx.chain.chain_id,
        kind: "chain.close",
        role: "runtime",
        detail: `terminal: ${newRunState.status}`,
      });
      return;
    }
    if (intents.length === 0) {
      // Nothing to dispatch — either everything is running (should never happen in synchronous scheduler) or blocked
      ctx.onFact({
        ts: nowIso(),
        chain_id: ctx.chain.chain_id,
        kind: "escalation",
        role: "runtime",
        detail: "reducer produced no intents and chain not closed — blocked",
      });
      newRunState.status = "blocked";
      await saveRunState(ctx.paths, newRunState);
      return;
    }

    // Execute each dispatch intent sequentially in this vertical slice.
    // (Parallel advisor dispatch would happen naturally because the reducer
    // produces both advisor dispatch intents in the same batch; we honor that
    // by running them concurrently with Promise.all.)
    const dispatchIntents = intents.filter((i) => i.kind === "dispatch");
    const terminalIntents = intents.filter((i) => i.kind === "terminalize");

    for (const t of terminalIntents) {
      await appendIntent(ctx.paths, t);
    }

    if (dispatchIntents.length > 0) {
      // Persist idempotency keys BEFORE running so a crash mid-run doesn't rerun them.
      const persistedRun = { ...newRunState };
      persistedRun.processed_intent_keys = Array.from(
        new Set([...(persistedRun.processed_intent_keys ?? []), ...dispatchIntents.map((i) => i.idempotency_key)]),
      );
      for (const stepId of dispatchIntents.map((i) => i.step_id)) {
        persistedRun.steps[stepId]!.status = "dispatched";
      }
      await saveRunState(ctx.paths, persistedRun);
      for (const i of dispatchIntents) await appendIntent(ctx.paths, i);

      await Promise.all(
        dispatchIntents.map(async (intent) => {
          const step = stepById(ctx.chain, intent.step_id);
          const st = persistedRun.steps[intent.step_id]!;
          const identity = makeIdentity(ctx.chain, step, st);
          ctx.onFact({
            ts: nowIso(),
            chain_id: ctx.chain.chain_id,
            role: step.role,
            step_id: step.step_id,
            participant_id: identity.participant_id,
            kind: "step.start",
            detail: `exec=${identity.execution_id} attempt=${identity.attempt}`,
          });
          const upstream = await upstreamEvidenceFor(ctx.paths, step);
          try {
            const res = await dispatchActivation({
              paths: ctx.paths,
              channelId: ctx.channelId,
              identity,
              model: step.model,
              fallbackModel: step.fallback_model,
              targetRepo: ctx.targetRepo,
              assignmentPrompt: assignmentPrompt({
                chain: ctx.chain,
                step,
                identity,
                incidentBrief,
                upstreamEvidence: upstream,
              }),
              onFact: ctx.onFact,
            });
            ctx.onFact({
              ts: nowIso(),
              chain_id: ctx.chain.chain_id,
              role: step.role,
              step_id: step.step_id,
              participant_id: identity.participant_id,
              kind: res.agent_end_ok ? "step.done" : "step.failed",
              detail: res.agent_end_ok
                ? `agent_end ok, ${res.final_state_message_count} messages, pi_session=${res.pi_session_id ?? "?"}`
                : `agent_end error: ${res.agent_end_error}`,
              meta: {
                execution_id: res.execution_id,
                pi_session_id: res.pi_session_id,
              },
            });
            // Mark step as produced_result (evidence check happens in reducer).
            const nowRun = (await loadRunState(ctx.paths))!;
            const s = nowRun.steps[step.step_id]!;
            s.last_execution_id = res.execution_id;
            s.last_pi_session_id = res.pi_session_id;
            s.last_agent_end_at = nowIso();
            s.status = res.agent_end_ok ? "produced_result" : "failed";
            s.last_error = res.agent_end_error;
            await saveRunState(ctx.paths, nowRun);
          } catch (e: any) {
            const nowRun = (await loadRunState(ctx.paths))!;
            nowRun.steps[step.step_id]!.status = "failed";
            nowRun.steps[step.step_id]!.last_error = String(e?.message ?? e);
            await saveRunState(ctx.paths, nowRun);
            ctx.onFact({
              ts: nowIso(),
              chain_id: ctx.chain.chain_id,
              role: step.role,
              step_id: step.step_id,
              kind: "step.failed",
              detail: `dispatch threw: ${String(e?.message ?? e)}`,
            });
          }
        }),
      );
    }
  }

  ctx.onFact({
    ts: nowIso(),
    chain_id: ctx.chain.chain_id,
    kind: "escalation",
    role: "runtime",
    detail: `scheduler hit max iterations (${maxIters}) — bailing`,
  });
}

/** Note evidence + close beads for steps newly transitioned to satisfied (spec §11). */
async function reconcileBeads(
  ctx: SchedulerContext,
  prevRun: RunState,
  nextRun: RunState,
  evidence: import("./types.ts").EvidenceProjection,
): Promise<void> {
  const beadsMap = await loadBeadsMap(ctx.paths);
  if (!beadsMap) return;
  for (const [stepId, next] of Object.entries(nextRun.steps)) {
    const prev = prevRun.steps[stepId];
    if (next.status !== "satisfied" || prev?.status === "satisfied") continue;
    const beadId = beadsMap.step_bead_ids[stepId];
    if (!beadId) continue;
    const stepEvidence = evidence.by_step[stepId] ?? [];
    const note = [
      `chain=${ctx.chain.chain_id} step=${stepId} exec=${next.last_execution_id ?? "-"}`,
      `attempts=${next.attempts} remediation_loops=${next.remediation_loops}`,
      "evidence:",
      ...stepEvidence.map((e) => `  ${e.evidence_id} kind=${e.kind}: ${e.summary}`),
    ].join("\n");
    try {
      await noteBead(ctx.paths.beadsDbDir, beadId, note);
      await closeBead(ctx.paths.beadsDbDir, beadId, `step ${stepId} satisfied by chain runtime`);
      ctx.onFact({
        ts: nowIso(),
        chain_id: ctx.chain.chain_id,
        role: "runtime",
        step_id: stepId,
        kind: "step.satisfied",
        detail: `bead ${beadId} noted + closed (${stepEvidence.length} evidence)`,
      });
    } catch (e: any) {
      ctx.onFact({
        ts: nowIso(),
        chain_id: ctx.chain.chain_id,
        role: "runtime",
        step_id: stepId,
        kind: "step.failed",
        detail: `bead ${beadId} note/close failed: ${e?.message ?? e}`,
      });
    }
  }
}

function projectChainProgress(run: RunState) {
  return {
    chain_run_id: run.chain_run_id,
    status: run.status,
    reviewer_verdict: run.reviewer_verdict,
    last_reduce_at: run.last_reduce_at,
    steps: Object.fromEntries(
      Object.entries(run.steps).map(([k, v]) => [
        k,
        {
          status: v.status,
          attempts: v.attempts,
          remediation_loops: v.remediation_loops,
          last_execution_id: v.last_execution_id,
        },
      ]),
    ),
  };
}

/**
 * Convenience: emit runtime `system.done` when the coordinator-close has been satisfied
 * and no further work remains. Not currently called by the scheduler loop — the reducer
 * transitions to closed_* directly on evidence — but exposed for external drivers.
 */
export async function emitSystemDone(
  paths: Paths,
  channelId: string,
  finalStatus: string,
): Promise<void> {
  await runtimePost(paths, channelId, "system.done", { final_status: finalStatus });
}
