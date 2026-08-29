/**
 * Real provenance receipt emitter (robot identities slice 3, xtrm-1zv,
 * residual F1 — real mutation call site).
 *
 * Wired into the scheduler loop: after every reduce/reconcile step, when the
 * run opted into provenance (ChainRunInputs.provenance.enabled), this module
 * emits ONE provenance receipt per newly-satisfied step. Each receipt:
 *
 *   1. resolves the trusted ResolvedExecutionContext from the REAL lane
 *      (makeIdentity + StepExecutionState + ResolvedChain, role-bound actor);
 *   2. assembles the envelope from the step's actual evidence content
 *      (mutation caller surface = evidence summary + cursors only);
 *   3. projects + performs a REAL, non-production platform mutation: a git
 *      commit in the designated scratch repo (LocalGitCommitAdapter);
 *   4. binds the returned real commit SHA, validates the receipt, and
 *      writes it under the run's outputs (existing output/event surface).
 *
 * The adapter + scratch repo are the ONLY mutation sink; nothing touches a
 * real GitHub/Jira account, connector or production target.
 */

import * as path from "node:path";
import * as fsp from "node:fs/promises";
import type { EvidenceEnvelope, ResolvedChain, RuntimeFact, RunState, StepExecutionState } from "./types.ts";
import type { Paths } from "./store.ts";
import { makeIdentity } from "./scheduler.ts";
import { stepById } from "./topology.ts";
import { loadRunState, saveRunState } from "./store.ts";
import { loadChainRunInputs, type ProvenanceRunConfig } from "./run-inputs.ts";
import { resolveTrustedExecutionContext } from "./trusted-context.ts";
import { runProvenanceCanary } from "../identity/canary.ts";
import { LocalGitCommitAdapter } from "../identity/adapters/local-git-commit.ts";
import { projectEvidence } from "../evidence/index.ts";
import { nowIso } from "../util/ids.ts";
import { writeJsonAtomic } from "../util/fs.ts";

export interface EmitterContext {
  paths: Paths;
  chain: ResolvedChain;
  onFact: (fact: RuntimeFact) => void;
}

export interface ProvenanceReceiptRecord {
  schema_version: "xtrm.provenance-receipt.v1";
  chain_id: string;
  step_id: string;
  execution_id: string;
  participant_id: string;
  assignment_id: string;
  authority_ref: string;
  receipt_id: string;
  envelope_hash: string;
  external_object_id: string;
  satisfied_at: string;
  emitted_at: string;
}

/**
 * Emit provenance receipts for steps that became satisfied in the latest
 * reduce. Idempotent per step: a step that already holds a receipt is
 * skipped (recorded in run state step entry via last_provenance_receipt_id).
 */
export async function emitStepProvenanceReceipts(
  ctx: EmitterContext,
  prevRun: RunState,
  nextRun: RunState,
): Promise<void> {
  const inputs = await loadChainRunInputs(ctx.paths);
  const provenance = inputs?.provenance;
  if (!provenance?.enabled) return;

  const evidence = await projectEvidence(ctx.paths);
  let changed = false;
  for (const [stepId, next] of Object.entries(nextRun.steps)) {
    const prev = prevRun.steps[stepId];
    if (next.status !== "satisfied" || prev?.status === "satisfied") continue;
    if (next.last_provenance_receipt_id) continue; // already emitted this session

    try {
      const receipt = await emitOne(ctx, provenance, stepId, next, evidence.by_step[stepId] ?? []);
      next.last_provenance_receipt_id = receipt.receipt_id;
      changed = true;
      ctx.onFact({
        ts: nowIso(),
        chain_id: ctx.chain.chain_id,
        role: "runtime",
        step_id: stepId,
        kind: "provenance.receipt",
        detail: `receipt ${receipt.receipt_id} bound to ${receipt.external_object_id}`,
        meta: { receipt_id: receipt.receipt_id, external_object_id: receipt.external_object_id },
      });
    } catch (e: any) {
      // At-most-once semantics: a step that already satisfied is not
      // re-emitted on later iterations (prev.status === "satisfied"), so a
      // failure here leaves the step without a receipt — surfaced via the
      // failed fact for reconciliation rather than retried blind (same
      // discipline as uncertain side effects in slice 1).
      ctx.onFact({
        ts: nowIso(),
        chain_id: ctx.chain.chain_id,
        role: "runtime",
        step_id: stepId,
        kind: "provenance.receipt.failed",
        detail: `receipt emission failed: ${e?.message ?? e}`,
      });
    }
  }
  // Persist the per-step receipt ids so a resume does not re-emit.
  if (changed) {
    await saveRunState(ctx.paths, nextRun);
  }
}

/** Emit and persist ONE receipt for a satisfied step. */
async function emitOne(
  ctx: EmitterContext,
  provenance: ProvenanceRunConfig,
  stepId: string,
  st: StepExecutionState,
  stepEvidence: EvidenceEnvelope[],
): Promise<ProvenanceReceiptRecord> {
  const step = stepById(ctx.chain, stepId);
  const identity = makeIdentity(ctx.chain, step, st);

  const assignmentId = provenance.assignmentId ?? ctx.chain.root_bead_id;
  const assignment = {
    id: assignmentId,
    version: provenance.assignmentVersion ?? 1,
  };
  const authorityRef = provenance.authorityRef ?? ctx.chain.root_bead_id;

  const resolution = resolveTrustedExecutionContext({
    identity,
    chain: ctx.chain,
    step,
    stepState: st,
    registries: provenance.registries,
    roleActors: provenance.roleActors,
    assignment,
    authorityRef,
    actorId: provenance.roleActors[step.role],
    principalSetId: provenance.principalSetId,
  });

  // Mutation caller surface: content + target + cursors ONLY. The content
  // is the REAL evidence this step produced (pointer-first body ref is the
  // cursor). No identity field is caller-supplied.
  const last = stepEvidence.at(-1);
  const content = last?.summary ?? `step ${stepId} satisfied`;
  const source_cursors: Record<string, string> = last
    ? { evidence_id: last.evidence_id }
    : { step_id: stepId };
  const payload = {
    content,
    target: {
      kind: "github_commit",
      repo: provenance.repoDir,
      issue: null,
    },
    source_cursors,
  };

  const adapter = new LocalGitCommitAdapter({
    scratchRoot: provenance.scratchRoot,
    repoDir: provenance.repoDir,
  });

  const result = await runProvenanceCanary({
    context: resolution.context,
    validationConfig: {
      registry: provenance.registries.actors,
      principalSets: provenance.registries.principalSets,
      expected: { assignment_id: assignment.id, assignment_version: assignment.version },
    },
    payload,
    authorshipMode: provenance.authorshipMode,
    adapter,
  });

  const record: ProvenanceReceiptRecord = {
    schema_version: "xtrm.provenance-receipt.v1",
    chain_id: ctx.chain.chain_id,
    step_id: stepId,
    execution_id: result.bound.execution_id,
    participant_id: result.bound.participant_id,
    assignment_id: result.bound.assignment_id,
    authority_ref: result.bound.authority_ref,
    receipt_id: result.bound.receipt_id,
    envelope_hash: result.bound.integrity.envelope_sha256,
    external_object_id: result.external_id,
    satisfied_at: st.last_satisfied_at ?? "",
    emitted_at: nowIso(),
  };

  const outDir = path.join(ctx.paths.outputsDir, "provenance-receipts");
  await writeJsonAtomic(path.join(outDir, `${stepId}-${result.bound.receipt_id}.json`), record);
  return record;
}
