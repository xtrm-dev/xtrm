/**
 * Evidence store — pointer-first per spec §8.
 *
 * Every semantic payload gets an evidence_id, is persisted as an isolated JSON
 * body, and is indexed by an EvidenceEnvelope. Messages carry only evidence_refs.
 */

import type { EvidenceEnvelope, ParticipantRole } from "../chain/types.ts";
import type { Paths } from "../chain/store.ts";
import { appendEvidenceIndex, readEvidenceBody, readEvidenceIndex, writeEvidenceBody } from "../chain/store.ts";
import { nowIso, shortId } from "../util/ids.ts";
import { sha256String } from "../util/fs.ts";

export interface PublishArgs {
  paths: Paths;
  chainId: string;
  stepId: string;
  producerParticipantId: string;
  producerRole: ParticipantRole;
  executionId: string;
  kind: EvidenceEnvelope["kind"];
  summary: string;
  body: unknown;
  scope_refs?: string[];
}

export async function publishEvidence(args: PublishArgs): Promise<EvidenceEnvelope> {
  const bodyStr = JSON.stringify(args.body);
  const evidenceId = `ev-${shortId(args.kind.replace(/[^a-z0-9]+/gi, "-").slice(0, 10), 4)}-${sha256String(bodyStr).slice(0, 8)}`;
  const bodyRef = await writeEvidenceBody(args.paths, evidenceId, args.body);
  const envelope: EvidenceEnvelope = {
    evidence_id: evidenceId,
    chain_id: args.chainId,
    producer_participant_id: args.producerParticipantId,
    producer_role: args.producerRole,
    step_id: args.stepId,
    execution_id: args.executionId,
    kind: args.kind,
    summary: args.summary.slice(0, 300),
    schema_version: 1,
    body_ref: bodyRef,
    created_at: nowIso(),
    scope_refs: args.scope_refs ?? [],
  };
  await appendEvidenceIndex(args.paths, envelope);
  return envelope;
}

export async function projectEvidence(paths: Paths): Promise<import("../chain/types.ts").EvidenceProjection> {
  const all = await readEvidenceIndex(paths);
  const by_step: Record<string, EvidenceEnvelope[]> = {};
  const by_kind: Record<string, EvidenceEnvelope[]> = {};
  for (const ev of all) {
    (by_step[ev.step_id] ??= []).push(ev);
    (by_kind[ev.kind] ??= []).push(ev);
  }
  return { by_step, by_kind };
}

export { readEvidenceBody };
