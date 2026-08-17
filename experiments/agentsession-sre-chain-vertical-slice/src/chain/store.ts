/**
 * Chain-run persistence per spec §9.
 *   <state-dir>/<chain-run-id>/
 *     design-inputs.json
 *     chain/
 *       resolved-chain.json
 *       run-state.json
 *       beads-map.json
 *       scheduler-intents.jsonl
 *     channels/
 *       messages.jsonl
 *       cursors/<participant>.json
 *     evidence/
 *       index.jsonl
 *       <evidence-id>.json
 *     projections/chain-progress.json
 *     forensics/events.jsonl
 *     outputs/<participant>/
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { appendJsonl, ensureDir, readJsonSafe, readJsonl, writeJsonAtomic } from "../util/fs.ts";
import type {
  BeadsMap,
  DesignInputsFingerprint,
  EvidenceEnvelope,
  MessageEnvelope,
  ParticipantCursor,
  ResolvedChain,
  RunState,
  SchedulerIntent,
} from "./types.ts";

export interface Paths {
  root: string;
  designInputs: string;
  chainDir: string;
  resolvedChain: string;
  runState: string;
  beadsMap: string;
  intentsJsonl: string;
  channelsDir: string;
  messagesJsonl: string;
  cursorsDir: string;
  evidenceDir: string;
  evidenceIndex: string;
  projectionsDir: string;
  chainProgress: string;
  forensicsDir: string;
  forensicsEvents: string;
  outputsDir: string;
  piAgentDir: string;
  beadsDbDir: string;
}

export function paths(stateDir: string, chainRunId: string): Paths {
  const root = path.join(stateDir, chainRunId);
  return {
    root,
    designInputs: path.join(root, "design-inputs.json"),
    chainDir: path.join(root, "chain"),
    resolvedChain: path.join(root, "chain", "resolved-chain.json"),
    runState: path.join(root, "chain", "run-state.json"),
    beadsMap: path.join(root, "chain", "beads-map.json"),
    intentsJsonl: path.join(root, "chain", "scheduler-intents.jsonl"),
    channelsDir: path.join(root, "channels"),
    messagesJsonl: path.join(root, "channels", "messages.jsonl"),
    cursorsDir: path.join(root, "channels", "cursors"),
    evidenceDir: path.join(root, "evidence"),
    evidenceIndex: path.join(root, "evidence", "index.jsonl"),
    projectionsDir: path.join(root, "projections"),
    chainProgress: path.join(root, "projections", "chain-progress.json"),
    forensicsDir: path.join(root, "forensics"),
    forensicsEvents: path.join(root, "forensics", "events.jsonl"),
    outputsDir: path.join(root, "outputs"),
    piAgentDir: path.join(root, "pi-agent"),
    beadsDbDir: path.join(root, "beads"),
  };
}

export async function initRunDir(p: Paths): Promise<void> {
  await ensureDir(p.root);
  await ensureDir(p.chainDir);
  await ensureDir(p.channelsDir);
  await ensureDir(p.cursorsDir);
  await ensureDir(p.evidenceDir);
  await ensureDir(p.projectionsDir);
  await ensureDir(p.forensicsDir);
  await ensureDir(p.outputsDir);
  await ensureDir(p.piAgentDir);
  await ensureDir(p.beadsDbDir);
}

export async function saveResolvedChain(p: Paths, chain: ResolvedChain): Promise<void> {
  await writeJsonAtomic(p.resolvedChain, chain);
}
export async function loadResolvedChain(p: Paths): Promise<ResolvedChain | null> {
  return readJsonSafe<ResolvedChain>(p.resolvedChain);
}

export async function saveRunState(p: Paths, run: RunState): Promise<void> {
  await writeJsonAtomic(p.runState, run);
}
export async function loadRunState(p: Paths): Promise<RunState | null> {
  return readJsonSafe<RunState>(p.runState);
}

export async function saveBeadsMap(p: Paths, m: BeadsMap): Promise<void> {
  await writeJsonAtomic(p.beadsMap, m);
}
export async function loadBeadsMap(p: Paths): Promise<BeadsMap | null> {
  return readJsonSafe<BeadsMap>(p.beadsMap);
}

export async function appendIntent(p: Paths, intent: SchedulerIntent): Promise<void> {
  await appendJsonl(p.intentsJsonl, intent);
}

export async function saveDesignInputs(p: Paths, d: DesignInputsFingerprint): Promise<void> {
  await writeJsonAtomic(p.designInputs, d);
}

export async function appendMessage(p: Paths, msg: MessageEnvelope): Promise<void> {
  await appendJsonl(p.messagesJsonl, msg);
}
export async function readMessages(p: Paths): Promise<MessageEnvelope[]> {
  return readJsonl<MessageEnvelope>(p.messagesJsonl);
}

export function cursorPath(p: Paths, participantId: string): string {
  const safe = participantId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(p.cursorsDir, `${safe}.json`);
}
export async function saveCursor(p: Paths, c: ParticipantCursor): Promise<void> {
  await writeJsonAtomic(cursorPath(p, c.participant_id), c);
}
export async function loadCursor(p: Paths, participantId: string): Promise<ParticipantCursor> {
  const existing = await readJsonSafe<ParticipantCursor>(cursorPath(p, participantId));
  return existing ?? { participant_id: participantId, last_read_id: 0, last_acked_id: 0 };
}

export async function appendEvidenceIndex(p: Paths, ev: EvidenceEnvelope): Promise<void> {
  await appendJsonl(p.evidenceIndex, ev);
}
export async function writeEvidenceBody(p: Paths, evidenceId: string, body: unknown): Promise<string> {
  const rel = `${evidenceId}.json`;
  await writeJsonAtomic(path.join(p.evidenceDir, rel), body);
  return rel;
}
export async function readEvidenceIndex(p: Paths): Promise<EvidenceEnvelope[]> {
  return readJsonl<EvidenceEnvelope>(p.evidenceIndex);
}
export async function readEvidenceBody<T = unknown>(p: Paths, bodyRef: string): Promise<T | null> {
  return readJsonSafe<T>(path.join(p.evidenceDir, bodyRef));
}

export async function saveChainProgress(p: Paths, projection: unknown): Promise<void> {
  await writeJsonAtomic(p.chainProgress, projection);
}

export function listExistingRuns(stateDir: string): string[] {
  if (!fs.existsSync(stateDir)) return [];
  return fs
    .readdirSync(stateDir)
    .filter((n) => fs.existsSync(path.join(stateDir, n, "chain", "run-state.json")));
}
