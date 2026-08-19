/**
 * Terminal-state bundle writer for sre-triage chain runs.
 *
 * At a terminal state (satisfied `closed_*` OR `escalated`) the scheduler
 * materializes a durable per-run bundle into the target repo at
 * `<target>/.xtrm/skills/infra/service-knowledge/services/sre-triage-runs/
 * <UTC-compact>_<chain_id_short>/`.
 *
 * The bundle SHAPE is owned by mercury/infra epic infra-223r (seed
 * 20260819T015344Z-chain-sre-308163). This writer only materializes it —
 * do not diverge from the declared file list or the chain-report.v1 schema
 * without coordinating the mercury/infra side.
 *
 * Failure semantics: a write failure emits `fact.warning` and never sinks an
 * otherwise-successful chain (scheduler calls this best-effort).
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Paths } from "./store.ts";
import type { RunState, RuntimeFact, EvidenceEnvelope, ResolvedChain } from "./types.ts";
import { nowIso } from "../util/ids.ts";
import { readJsonl, readJsonSafe } from "../util/fs.ts";

/** Terminal states that trigger a bundle write. */
export type TerminalState = "satisfied" | "escalated";

export interface BundleWriteResult {
  bundle_path: string;
  files_written: string[];
  bytes_written: number;
  elapsed_ms: number;
  terminal_state: TerminalState;
}

/** Map a chain status to the bundle's terminal_state label. */
export function terminalStateOf(status: string): TerminalState | null {
  if (status.startsWith("closed_")) return "satisfied";
  if (status === "escalated") return "escalated";
  return null; // blocked / running / initialized — no bundle
}

/** UTC compact, e.g. 20260819T015344Z (matches the mercury/infra seed dir). */
export function utcCompact(tsIso: string): string {
  return tsIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace(/\.\d+\+00:00$/, "Z");
}

function shortIdOf(chainId: string): string {
  return chainId;
}

/**
 * Pure helper: expand every evidence/index.jsonl entry into its body file
 * (one JSON per evidence_id under <bundle>/evidence/). Returns the expanded
 * file names.
 */
export function expandEvidenceIndex(entries: EvidenceEnvelope[]): { filename: string; record: unknown }[] {
  return entries
    .filter((e) => e.evidence_id)
    .map((e) => ({
      filename: `${e.evidence_id}.json`,
      record: e,
    }));
}

/** Best-effort narrative body from the run's coordinator.decision evidence. */
export function narrativeBody(evidence: EvidenceEnvelope[], bodyByRef: Map<string, unknown>): string {
  const coord = evidence.filter((e) => e.kind === "coordinator.decision").at(-1);
  if (!coord) return "";
  const body = bodyByRef.get(coord.body_ref);
  if (!body) return "";
  try {
    return typeof body === "string" ? body : JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

/**
 * Write the full sre-triage-runs bundle for a terminal run.
 *
 * Never throws into the scheduler: all failures are captured and returned as
 * a fact.warning via onFact. Return null on write failure (after emitting the
 * warning fact).
 */
export async function writeSreTriageBundle(args: {
  paths: Paths;
  runState: RunState;
  targetRepo: string;
  terminalState: TerminalState;
  chainId: string;
  chainRunId: string;
  onFact: (fact: RuntimeFact) => void;
  startedAt?: string | null;
}): Promise<BundleWriteResult | null> {
  const { paths: p, runState, targetRepo, terminalState, chainId, chainRunId, onFact, startedAt } = args;
  const t0 = Date.now();
  const fail = (detail: string): null => {
    try {
      onFact({
        ts: nowIso(),
        chain_id: chainId,
        role: "runtime",
        kind: "fact.warning",
        detail: `sre-triage bundle write failed: ${detail}`,
      } as any);
    } catch {
      /* best-effort */
    }
    return null;
  };

  // --- Load run artifacts (best-effort; missing inputs = warning, not crash).
  let evidenceEntries: EvidenceEnvelope[] = [];
  try {
    evidenceEntries = await readJsonl<EvidenceEnvelope>(p.evidenceIndex);
  } catch (e: any) {
    return fail(`evidence index unreadable: ${e?.message ?? e}`);
  }

  const roleByStep = new Map<string, string>();
  try {
    const chain = await readJsonSafe<ResolvedChain>(p.resolvedChain);
    for (const s of chain?.topology ?? []) roleByStep.set(s.step_id, s.role);
  } catch {
    /* leave empty */
  }


  const bodyByRef = new Map<string, unknown>();
  for (const e of evidenceEntries) {
    if (!e.body_ref) continue;
    try {
      const body = await readJsonSafe(path.join(p.evidenceDir, e.body_ref));
      if (body) bodyByRef.set(e.body_ref, body);
    } catch {
      /* leave missing body */
    }
  }

  let messagesLines = "";
  try {
    messagesLines = await fsp.readFile(p.messagesJsonl, "utf8");
  } catch (e: any) {
    return fail(`messages.jsonl unreadable: ${e?.message ?? e}`);
  }
  let forensicsLines = "";
  try {
    forensicsLines = await fsp.readFile(p.forensicsEvents, "utf8");
  } catch (e: any) {
    return fail(`forensics/events.jsonl unreadable: ${e?.message ?? e}`);
  }

  // --- Compose the deterministic bundle.
  const utc = utcCompact(nowIso());
  const runDir = path.join(
    targetRepo,
    ".xtrm/skills/infra/service-knowledge/services/sre-triage-runs",
    `${utc}_${shortIdOf(chainId)}`,
  );
  const evidenceDir = path.join(runDir, "evidence");

  // chain-report.v1.json — seed chain-report.json shape + schema key + next_actions[].
  const steps = runState.steps;
  const chainReport = {
    schema: "chain-report.v1",
    chain_run_id: chainRunId,
    chain_id: chainId,
    chain_epic_id: (runState as any).chain_epic_id ?? null,
    target_repo: targetRepo,
    target_repo_sha: (runState as any).target_repo_sha ?? null,
    started_at: startedAt ?? null,
    ended_at: nowIso(),
    terminal_state: terminalState,
    terminal_detail: `chain status ${runState.status} (verdict=${runState.reviewer_verdict ?? "-"})`,
    steps: Object.entries(steps).map(([stepId, st]) => ({
      step_id: stepId,
      role: roleByStep.get(stepId) ?? "",
      status: st.status,
      evidence: (evidenceEntries.filter((e) => e.step_id === stepId)).map((e) => e.evidence_id),
    })),
    evidence_index: evidenceEntries.map((e) => e.evidence_id),
    prior_runs_cited: [],
    plan_phase: extractPlanPhase(evidenceEntries, bodyByRef),
    next_actions: extractNextActions(evidenceEntries, bodyByRef),
  };

  // report.md — coordinator narrative from the coordinator.decision body.
  const narrative = narrativeBody(evidenceEntries, bodyByRef);
  const reportMd = [
    `# SRE triage report — ${chainRunId} (${chainId})`,
    "",
    `> Terminal state: ${terminalState} (${runState.status}). Generated by the chain runtime writer.`,
    "",
    "## Coordinator narrative",
    "",
    narrative || "(no coordinator.decision evidence body available)",
    "",
    "## Next actions",
    "",
    ...((chainReport.next_actions as string[]).map((a) => `- ${a}`) || ["(none)"]),
    "",
  ].join("\n");

  // gotchas.jsonl — derived from evidence summaries + coordinator body.
  const gotchas = buildGotchas(evidenceEntries, bodyByRef);

  // --- Write files.
  const files: Array<[string, string]> = [
    ["chain-report.v1.json", JSON.stringify(chainReport, null, 2) + "\n"],
    ["report.md", reportMd],
    ["gotchas.jsonl", gotchas.map((g) => JSON.stringify(g)).join("\n") + (gotchas.length ? "\n" : "")],
    ["forensics.jsonl", forensicsLines],
    ["messages.jsonl", messagesLines],
  ];

  try {
    await fsp.mkdir(evidenceDir, { recursive: true });
    for (const e of evidenceEntries) {
      if (!e.evidence_id) continue;
      const rec = bodyByRef.get(e.body_ref) ?? e;
      await fsp.writeFile(path.join(evidenceDir, `${e.evidence_id}.json`), JSON.stringify(rec, null, 2) + "\n", "utf8");
    }

    const written: string[] = [];
    let bytes = 0;
    for (const [name, content] of files) {
      await fsp.writeFile(path.join(runDir, name), content, "utf8");
      written.push(name);
      bytes += Buffer.byteLength(content);
    }
    // evidence/*.json counted separately
    const evFiles = evidenceEntries.map((e) => `evidence/${e.evidence_id}.json`);
    for (const f of evFiles) {
      const buf = await fsp.readFile(path.join(runDir, f));
      bytes += buf.length;
    }
    written.push(...evFiles);

    const result: BundleWriteResult = {
      bundle_path: runDir,
      files_written: written,
      bytes_written: bytes,
      elapsed_ms: Date.now() - t0,
      terminal_state: terminalState,
    };
    onFact({
      ts: nowIso(),
      chain_id: chainId,
      role: "runtime",
      kind: "sre-triage.bundle.written",
      detail: `bundle at ${runDir} (${terminalState}) files=${written.length} bytes=${bytes}`,
      meta: {
        chain_id: chainId,
        chain_run_id: chainRunId,
        bundle_path: runDir,
        terminal_state: terminalState,
        files_written: written,
        bytes_written: bytes,
        elapsed_ms: result.elapsed_ms,
      },
    } as any);
    return result;
  } catch (e: any) {
    return fail(`write threw: ${e?.message ?? e}`);
  }
}

/** Derive gotchas.jsonl entries from the run's evidence + coordinator body. */
export function buildGotchas(evidence: EvidenceEnvelope[], bodyByRef: Map<string, unknown>): Array<{
  kind: string;
  resource: string;
  symptom: string;
  evidence_ref: string;
  fix_applied: string;
  worked: boolean;
  prior_run_refs: string[];
}> {
  const out: Array<{
    kind: string;
    resource: string;
    symptom: string;
    evidence_ref: string;
    fix_applied: string;
    worked: boolean;
    prior_run_refs: string[];
  }> = [];
  for (const e of evidence) {
    const body = bodyByRef.get(e.body_ref);
    const gotchas = (body as any)?.gotchas;
    if (Array.isArray(gotchas) && gotchas.length > 0) {
      for (const g of gotchas) {
        if (typeof g !== "object" || g === null) continue;
        out.push({
          kind: String(g.kind ?? "finding"),
          resource: String(g.resource ?? e.producer_role ?? "unknown"),
          symptom: String(g.symptom ?? e.summary ?? ""),
          evidence_ref: e.evidence_id,
          fix_applied: String(g.fix_applied ?? ""),
          worked: Boolean(g.worked ?? false),
          prior_run_refs: Array.isArray(g.prior_run_refs) ? g.prior_run_refs : [],
        });
      }
    } else {
      // Fallback: one gotcha per evidence with a non-empty summary.
      const summary = e.summary?.trim();
      if (summary) {
        out.push({
          kind: "finding",
          resource: e.producer_role,
          symptom: summary.slice(0, 300),
          evidence_ref: e.evidence_id,
          fix_applied: "",
          worked: false,
          prior_run_refs: [],
        });
      }
    }
  }
  return out;
}

/** next_actions[] for chain-report.v1.json — from coordinator body or empty. */
export function extractNextActions(evidence: EvidenceEnvelope[], bodyByRef: Map<string, unknown>): string[] {
  const coord = evidence.filter((e) => e.kind === "coordinator.decision").at(-1);
  const body = coord ? bodyByRef.get(coord.body_ref) : undefined;
  const na = (body as any)?.next_actions;
  if (Array.isArray(na) && na.every((x) => typeof x === "string")) return na;
  const rec = (body as any)?.recommended_next_actions;
  if (Array.isArray(rec)) return rec.map((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)));
  return [];
}

/** plan_phase for chain-report.v1.json — best-effort from coordinator body. */
export function extractPlanPhase(
  evidence: EvidenceEnvelope[],
  bodyByRef: Map<string, unknown>,
): Record<string, unknown> | null {
  const coord = evidence.filter((e) => e.kind === "coordinator.decision").at(-1);
  const body = coord ? bodyByRef.get(coord.body_ref) : undefined;
  const plan = (body as any)?.plan_phase;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) return plan as Record<string, unknown>;
  return null;
}
