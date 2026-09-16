// Substrate stop gate (H1 / ADR §§76-77, §38, bead xtrm-6qu.6). Replaces
// beads-stop-gate.mjs.
//
// Beads nudged on an unclosed claim at stop. The Substrate version evaluates
// the five §77 signals before exit — active claimed work, unrecorded
// meaningful results, pending Specialist asks, missing checkpoint/handoff,
// closure readiness — and emits a documented action. Unfinished work
// checkpoints (or names the missing handoff), retains or releases the claim
// per policy, and the session may end. Completed work is pointed at the
// result → validation/provenance → closure path. Fake completion is never
// required and never performed: the gate never closes an issue.
//
// NOTE: this gate reads the issue claim only; it does not enforce the
// workspace writer lease (§18) — lease enforcement lives in the tool_call /
// dispatch authority path (A6/A7). The gate never blocks exit.
//
// ADR §76: the gate appends no generic Journal entry per invocation. The
// ONLY write is a mechanical checkpoint (J1 kind, not a generic note), and
// only when the session would otherwise leave none. Claim release appends
// an issue event, never a Journal entry. Like its predecessor this gate
// never blocks exit (Stop-hook contract: exit 0; continuity context on
// stdout); allow is always true.

import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";
import { enrichExecutionContext } from "../../src/domain/execution-context.ts";
import { ProvenanceService } from "../../src/service/provenance-service.ts";
import { armPipeDrain } from "../write-and-exit.ts";

export interface StopGateInput {
  cwd?: string;
  session_id?: string;
  issueRef?: string;
  dbPath?: string;
  holder?: string;
  activationId?: string;
  // Release/retain policy (§77): default retains the claim so a resumed
  // session keeps its execution. Pass true (or SUBSTRATE_STOP_RELEASE_CLAIM=1
  // in the process entry) to release the holder's own claim once continuity
  // is secured — stopping one execution, never cancelling the Issue (C1:
  // releaseClaim, not cancelIssue).
  releaseClaim?: boolean;
}

// One value per §77 outcome. "silent" = nothing bound, nothing to say.
// "checkpointed" = unfinished work secured with a stop checkpoint.
// "continuity" = unfinished work already has continuity; next steps named.
// "closure-ready" = a result is recorded and nothing blocks the
// result → validation/provenance → closure path.
export type StopGateAction = "silent" | "checkpointed" | "continuity" | "closure-ready";

// The five §77 signals, consumed from J1 shapes and C1/readiness state —
// never duplicated here. pendingAsks come from the latest J1 checkpoint's
// mechanical.pendingAsks; open blockers from the live graph.
export interface StopGateSignals {
  hasActiveClaim: boolean;
  holder: string | null;
  checkpointsSinceClaim: number;
  handoffsSinceClaim: number;
  resultsSinceClaim: number;
  blockersSinceClaim: number;
  pendingAsks: string[];
  openBlockers: string[];
  readinessState: string | null;
  readinessDispatchable: boolean;
  openReceipts: number;
  closureReady: boolean;
}

export interface StopGateResult {
  allow: boolean;
  issueRef: string | null;
  checkpointed: boolean;
  continuity: string | null;
  action: StopGateAction;
  signals: StopGateSignals | null;
  claimReleased: boolean;
  degraded?: boolean;
}

const SILENT: StopGateResult = {
  allow: true,
  issueRef: null,
  checkpointed: false,
  continuity: null,
  action: "silent",
  signals: null,
  claimReleased: false,
};

export async function handleStopGate(input: StopGateInput = {}): Promise<StopGateResult> {
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  if (!issueRef) return { ...SILENT };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const claim = handles.svc.getActiveClaim(issueId);
    if (!claim) return { ...SILENT, issueRef };
    const entries = handles.journal.listEntries(issueId);
    const claimedAt = claim.acquiredAt ?? 0;
    const since = entries.filter((e) => (e.createdAt ?? 0) >= claimedAt);
    const checkpoints = since.filter((e) => e.kind === "checkpoint" || e.kind === "compaction").length;
    const handoffs = since.filter((e) => e.kind === "handoff").length;
    const results = since.filter((e) => e.kind === "result").length;
    const blockers = since.filter((e) => e.kind === "blocker").length;
    // J1 shape consumed, not duplicated: pending Specialist asks ride on
    // the latest checkpoint's mechanical payload.
    const latest = handles.journal.latestCheckpoint(issueId);
    const pendingAsks = [...(latest?.mechanical?.pendingAsks ?? [])];
    const openBlockers = handles.svc.unsatisfiedBlockers(issueId);
    // C1 readiness consumed, not duplicated: derived projection + open
    // receipts tell whether the closure path is actionable.
    const readiness = handles.svc.getReadiness(issueId);
    const prov = new ProvenanceService(handles.db, handles.svc, handles.journal);
    const openReceipts = prov.listReceipts(issueId).filter((r) => r.commitSha === null && r.finalizedAt === null).length;
    const closureReady =
      results > 0 && pendingAsks.length === 0 && openBlockers.length === 0 && openReceipts === 0;
    const signals: StopGateSignals = {
      hasActiveClaim: true,
      holder: claim.holder,
      checkpointsSinceClaim: checkpoints,
      handoffsSinceClaim: handoffs,
      resultsSinceClaim: results,
      blockersSinceClaim: blockers,
      pendingAsks,
      openBlockers,
      readinessState: readiness.state,
      readinessDispatchable: readiness.dispatchable,
      openReceipts,
      closureReady,
    };
    // §76: at most one checkpoint, only when the session leaves none.
    let checkpointed = false;
    let checkpointFailed = false;
    if (checkpoints === 0) {
      try {
        await handles.journal.checkpoint(issueId, {
          sessionId: input.session_id,
          executionContext: enrichExecutionContext({
            host: input.session_id ? { type: "claude", sessionId: input.session_id } : null,
          }),
        });
        checkpointed = true;
      } catch {
        // Still never blocks and still exits 0, but the operator must be able
        // to tell "no checkpoint needed" from "the checkpoint write failed".
        checkpointed = false;
        checkpointFailed = true;
      }
    }
    const parts = [
      `session ending with live claim on ${issueRef} (holder ${claim.holder}).`,
      `continuity: ${checkpoints + (checkpointed ? 1 : 0)} checkpoint(s) since claim${checkpointed ? " (one written at stop)" : ""}, ` +
        `${handoffs} handoff(s), ${results} result(s), ${blockers} blocker entr(ies) on record.`,
    ];
    if (results === 0) {
      parts.push(
        `no meaningful result recorded since claim; record one with \`sb issue note ${issueRef} --kind result\` when there is something to record — ending now is fine, work stays open.`,
      );
    }
    if (pendingAsks.length > 0) {
      parts.push(`pending Specialist asks: ${pendingAsks.join("; ")}; hand off or answer before the next dispatch.`);
    }
    if (openBlockers.length > 0) {
      parts.push(`open blockers: ${openBlockers.join(", ")}.`);
    }
    if (checkpointFailed) {
      parts.push(`checkpoint write failed; continuity depends on the entries already on record.`);
    }
    if (openReceipts > 0) {
      parts.push(
        `${openReceipts} receipt(s) are still open; bind or finalize provenance before treating the work as closure-ready.`,
      );
    }
    if (handoffs === 0 && !closureReady) {
      parts.push(`no handoff since claim; write one with \`sb journal append ${issueRef} --kind handoff\` if the next session needs context.`);
    }
    let action: StopGateAction = checkpointed ? "checkpointed" : "continuity";
    if (closureReady) {
      action = "closure-ready";
      parts.push(
        `closure-ready: result → validation/provenance → \`sb issue close ${issueRef} --outcome <completed|…> --reason <why>\`; the gate never closes for you.`,
      );
    } else {
      parts.push(`work stays open; resume with \`sb issue resume ${issueRef}\`.`);
    }
    // Release/retain per policy: release is the holder's own claim only,
    // after continuity is secured. Retain (default) keeps the execution.
    let claimReleased = false;
    const wantRelease = input.releaseClaim ?? process.env["SUBSTRATE_STOP_RELEASE_CLAIM"] === "1";
    if (wantRelease) {
      const holder = input.holder ?? process.env["SUBSTRATE_HOLDER"] ?? claim.holder;
      const activationId = input.activationId ?? process.env["SUBSTRATE_ACTIVATION_ID"] ?? undefined;
      try {
        const released = handles.svc.releaseClaim(issueId, holder, activationId ? { activationId } : undefined);
        if (released) {
          claimReleased = true;
          parts.push(`claim released per stop policy (holder ${holder}); the issue stays open.`);
        } else {
          parts.push(`stop policy asked for release but no open claim remained; the issue stays open.`);
        }
      } catch {
        parts.push(`stop policy asked for release but holder ${holder} does not own the claim; claim retained.`);
      }
    }
    return { allow: true, issueRef, checkpointed, continuity: parts.join(" "), action, signals, claimReleased };
  } catch {
    return { allow: true, issueRef, checkpointed: false, continuity: null, action: "silent", signals: null, claimReleased: false, degraded: true };
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort
    }
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const invokedAsMain = (process.argv[1]?.endsWith("stop-gate.ts") || process.argv[1]?.endsWith("stop-gate.js")) ?? false;
if (invokedAsMain) {
  armPipeDrain(); // XTRM-335: quiet guards below may exit immediately (proven zero-byte); every write path drains via exitCode.
  const raw = await readStdin();
  let hook: Record<string, unknown> = {};
  if (raw.trim() !== "") {
    try {
      hook = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      hook = {};
    }
  }
  const result = await handleStopGate({
    cwd: (hook["cwd"] as string | undefined) ?? process.cwd(),
    session_id: hook["session_id"] as string | undefined,
    issueRef: process.env["SUBSTRATE_ISSUE_REF"],
    holder: process.env["SUBSTRATE_HOLDER"],
    activationId: process.env["SUBSTRATE_ACTIVATION_ID"],
    releaseClaim: process.env["SUBSTRATE_STOP_RELEASE_CLAIM"] === "1",
  });
  // XTRM-335: the no-continuity exit is a proven zero-byte quiet path; only
  // the write-then-terminate path drains via exitCode.
  if (!result.continuity) process.exit(0);
  process.stdout.write(JSON.stringify({ additionalContext: result.continuity }) + "\n");
  process.exitCode = 0;
}
