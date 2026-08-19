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
import * as fsp from "node:fs/promises";
import * as pathmod from "node:path";
import { readMessages as _readMessagesUnused } from "./store.ts"; // types-only
import { writeSreTriageBundle, terminalStateOf } from "./finalize.ts";

/**
 * Deterministic per-run evidence bundle written into the state-dir at
 * chain terminalization. Contract: sre-triage-runs.report-log.v1
 * (see ~/.xtrm/skills/default/sre-triage/SKILL.md "Persistent per-run
 * knowledge" section). Not committed — uncommitted patch pending
 * xtrm-pq1.3.
 */
async function writeReportLogJsonSafe(
  ctx: SchedulerContext,
  runState: RunState,
  terminalState: "closed" | "escalated" | "blocked",
): Promise<void> {
  try {
    // rundir = the directory that holds chain/, evidence/, channels/, forensics/…
    // paths.rundir may be undefined if the store shape changes; fall back to inference.
    const anyPaths: any = ctx.paths as any;
    const runDir: string =
      anyPaths.rundir ??
      anyPaths.runDir ??
      anyPaths.chainDir?.replace(/\/chain\/?$/, "") ??
      pathmod.dirname((anyPaths.chainDir ?? anyPaths.forensicsPath ?? ""));
    if (!runDir) return;
    const outPath = pathmod.join(runDir, "report-log.json");

    // Load evidence index (best-effort)
    let evidenceIds: string[] = [];
    let evidenceBySummary: Record<string, string> = {};
    try {
      const ev = pathmod.join(runDir, "evidence", "index.jsonl");
      const txt = await fsp.readFile(ev, "utf8");
      for (const line of txt.split(/\n/).filter(Boolean)) {
        try {
          const r = JSON.parse(line);
          if (r?.evidence_id) {
            evidenceIds.push(r.evidence_id);
            const head = typeof r.summary === "string" ? r.summary.slice(0, 240) : "";
            evidenceBySummary[r.evidence_id] = head;
          }
        } catch { /* skip bad line */ }
      }
    } catch { /* no evidence yet */ }

    // Load target repo HEAD (best-effort)
    let targetSha: string | null = null;
    try {
      const { execSync } = await import("node:child_process");
      targetSha = execSync(`git -C ${JSON.stringify(ctx.targetRepo)} rev-parse HEAD`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim() || null;
    } catch { /* not a git repo or unavailable */ }

    // Compose per-step summary from runState + resolved-chain topology
    const steps = ctx.chain.topology.map((s) => {
      const st = runState.steps[s.step_id] ?? ({} as any);
      return {
        step_id: s.step_id,
        role: s.role,
        class: s.class,
        needs: s.needs,
        model: (s as any).model,
        participant_id: `${ctx.chain.chain_id}::${s.step_id}`,
        execution_id: st.last_execution_id ?? null,
        pi_session_id: st.last_pi_session_id ?? null,
        attempts: st.attempts ?? 0,
        remediation_loops: st.remediation_loops ?? 0,
        status: st.status ?? "unknown",
        last_error: st.last_error ?? null,
        last_agent_end_at: st.last_agent_end_at ?? null,
      };
    });

    const bundle = {
      schema_version: "sre-triage-runs.report-log.v1",
      chain_run_id: runState.chain_run_id ?? (runState as any).chainRunId,
      chain_id: ctx.chain.chain_id,
      chain_epic_id: (runState as any).chain_epic_id ?? null,
      target_repo: ctx.targetRepo,
      target_repo_sha: targetSha,
      terminal_state: terminalState,
      reviewer_verdict: (runState as any).reviewer_verdict ?? null,
      started_at: (runState as any).started_at ?? null,
      ended_at: nowIso(),
      specialist_json_mode: (ctx.chain as any).fingerprint?.specialist_json_mode ?? null,
      baseline_specialists: (ctx.chain as any).fingerprint?.baseline_specialists ?? [],
      steps,
      evidence_index: evidenceIds,
      evidence_summaries: evidenceBySummary,
      notes: "Deterministic evidence bundle emitted by scheduler at terminalization. See sre-triage SKILL 'Persistent per-run knowledge' section for how the coordinator copies this into <target>/.xtrm/skills/infra/service-knowledge/services/sre-triage-runs/runs/<UTC>-<chain_run_id>/report-log.json alongside its hand-written report.md.",
    };

    await fsp.writeFile(outPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");
    ctx.onFact({
      ts: nowIso(),
      chain_id: ctx.chain.chain_id,
      role: "runtime",
      kind: "report.log.written",
      detail: `report-log.json (${terminalState}) at ${outPath}  steps=${steps.length}  evidence=${evidenceIds.length}`,
    } as any);
  } catch (e: any) {
    ctx.onFact({
      ts: nowIso(),
      chain_id: ctx.chain.chain_id,
      role: "runtime",
      kind: "report.log.failed",
      detail: `report-log.json write failed: ${e?.message ?? e}`,
    } as any);
  }
}


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
    "## What you MUST do (exit criteria) — HARD REQUIREMENTS",
    ...(function () {
      // Concrete downstream targets from topology so the model does not have to guess.
      const downstream = args.chain.topology
        .filter((s) => s.needs.includes(args.step.step_id))
        .map((s) => `${args.chain.chain_id}::${s.step_id}`);
      const kindByStep: Record<string, string> = {
        "coordinator-entry": "coordinator.decision",
        "explorer": "topology.map",
        "observability": "observability.snapshot",
        "diagnostician": "diagnostician.report",
        "reviewer": "reviewer.verdict",
        "coordinator-close": "coordinator.decision",
      };
      const expectedKind = kindByStep[args.step.step_id] ?? "step.result";
      const targets = downstream.length ? downstream : [`${args.chain.chain_id}::coordinator-close`];
      const targetsJson = JSON.stringify(targets);

      // Reviewer step has a very specific exit contract per roles/reviewer.md:
      //   evidence.summary MUST contain the bare word PASS | PARTIAL | FAIL,
      //   and the work.turn kind is "work.verdict" (only the reviewer may emit it).
      //   On PASS/FAIL the message targets chain-coordinator; on PARTIAL it targets sre-diagnostician.
      if (args.step.step_id === "reviewer") {
        return [
          "You are the reviewer gate. Follow the reviewer role's checks in the system prompt.",
          "",
          "Before you call agent_end you MUST perform BOTH of these tool calls, in order:",
          "",
          "1. Call the `evidence_publish` tool exactly once with:",
          "   - kind = \"reviewer.verdict\"",
          "   - summary = the bare word \"PASS\" (or \"PARTIAL: <one-line reason>\" or \"FAIL: <one-line reason>\").",
          "     The reducer routes chain progression on this bare word — you MUST include exactly one of PASS, PARTIAL, or FAIL as a whole word in the summary.",
          "   - body = { verdict, checks_run, checks_failed, gaps_for_remediation, rationale }  (see reviewer role prompt).",
          "   The tool RETURNS an evidence_id — remember it. Do not fabricate evidence_ids.",
          "",
          "2. Call the `channel_post` tool exactly once with:",
          `   - kind = "work.verdict"   (only the reviewer may emit this kind — do NOT use "work.turn")`,
          `   - action_targets = ["${args.chain.chain_id}::coordinator-close"]   (on PASS or FAIL — chain will close via the close-coordinator step; on PARTIAL use ["${args.chain.chain_id}::diagnostician"])`,
          "   - evidence_refs = [<the evidence_id returned in step 1>]",
          "   - body.summary = one-line rationale for the verdict",
          "",
          "3. Then call agent_end. Do not respond in plain text alone — the reducer only advances on the evidence in step 1.",
        ];
      }

      // coordinator-close step: closes the chain, emits its own coordinator.decision + system.done.
      if (args.step.step_id === "coordinator-close") {
        return [
          "You are the coordinator's CLOSE turn. Read the reviewer.verdict evidence and every advisor evidence in this ChainRun.",
          "",
          "Before you call agent_end you MUST perform these tool calls, in order:",
          "",
          "1. Call the `evidence_publish` tool exactly once with:",
          "   - kind = \"coordinator.decision\"",
          "   - body = { phase: \"close\", outcome, chosen_verdict, ranked_findings, recommended_actions_read_only }",
          "   - summary = one-line close statement",
          "",
          `2. Call the \`channel_post\` tool exactly once with kind = "system.done", action_targets = [], visibility = "chain", body.summary = one-line closing statement. This is the signal the reducer needs to terminalize the chain.`,
          "",
          "3. Then call agent_end. If you skip step 2 the runtime will not close the chain.",
        ];
      }

      return [
        "Before you call agent_end you MUST perform BOTH of these two tool calls, in order:",
        "",
        "1. Call the `evidence_publish` tool exactly once with kind=\"" + expectedKind + "\".",
        "   The tool RETURNS an evidence_id — remember it. Do not fabricate evidence_ids.",
        "   Body must be a JSON object summarising your work (fields per your role's usual shape).",
        "",
        "2. Call the `channel_post` tool exactly once with:",
        "   - kind = \"work.turn\"",
        `   - action_targets = ${targetsJson}   (EXACTLY these participant_ids, in this order — do not substitute step_ids you invented)`,
        "   - evidence_refs = [<the evidence_id returned in step 1>]",
        "   - body.summary = a one-paragraph handoff",
        "",
        "3. Then call agent_end. agent_end alone does NOT satisfy your step.",
        "   If you skip steps 1 or 2, the reducer will escalate the chain as blocked and your work is discarded.",
      ];
    })(),
  ].flat().join("\n");
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
      await writeReportLogJsonSafe(ctx, newRunState, "closed");
      const term = terminalStateOf(newRunState.status);
      if (term) {
        await writeSreTriageBundle({
          paths: ctx.paths,
          runState: newRunState,
          targetRepo: ctx.targetRepo,
          terminalState: term,
          chainId: ctx.chain.chain_id,
          chainRunId: newRunState.chain_run_id,
          onFact: ctx.onFact,
          startedAt: (run as any).started_at ?? null,
        });
      }
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
      const term = terminalStateOf(newRunState.status);
      if (term) {
        await writeSreTriageBundle({
          paths: ctx.paths,
          runState: newRunState,
          targetRepo: ctx.targetRepo,
          terminalState: term,
          chainId: ctx.chain.chain_id,
          chainRunId: newRunState.chain_run_id,
          onFact: ctx.onFact,
          startedAt: (run as any).started_at ?? null,
        });
      }
      if (newRunState.status !== "escalated") {
        newRunState.status = "blocked";
      }
      await saveRunState(ctx.paths, newRunState);
      await writeReportLogJsonSafe(ctx, newRunState, newRunState.status === "escalated" ? "escalated" : "blocked");
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
