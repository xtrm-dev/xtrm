// Substrate stop gate (§38, bead xtrm-6qu.6). Replaces beads-stop-gate.mjs.
//
// Beads nudged on an unclosed claim at stop. The Substrate version checks
// durable continuity before exit: active claim (holder), journal
// checkpoints since the claim, pending blocker/handoff entries. Unfinished
// NOTE: this gate reads the issue claim only; it does not enforce the
// workspace writer lease (§18) — lease enforcement lives in the tool_call /
// dispatch authority path (A6/A7). The gate never blocks exit.
// work may remain open — the requirement is continuity, not fake
// completion. Like its predecessor this gate never blocks exit (Stop-hook
// contract: exit 0; continuity context on stdout); it writes a mechanical
// checkpoint when the session would otherwise leave none.

import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";

export interface StopGateInput {
  cwd?: string;
  session_id?: string;
  issueRef?: string;
  dbPath?: string;
}

export interface StopGateResult {
  allow: boolean;
  issueRef: string | null;
  checkpointed: boolean;
  continuity: string | null;
  degraded?: boolean;
}

export async function handleStopGate(input: StopGateInput = {}): Promise<StopGateResult> {
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  if (!issueRef) return { allow: true, issueRef: null, checkpointed: false, continuity: null };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const claim = handles.svc.getActiveClaim(issueId);
    if (!claim) return { allow: true, issueRef, checkpointed: false, continuity: null };
    const entries = handles.journal.listEntries(issueId);
    const claimedAt = claim.acquiredAt ?? 0;
    const since = entries.filter((e) => (e.createdAt ?? 0) >= claimedAt);
    const checkpoints = since.filter((e) => e.kind === "checkpoint" || e.kind === "compaction").length;
    const blockers = entries.filter((e) => e.kind === "blocker").length;
    const handoffs = entries.filter((e) => e.kind === "handoff").length;
    let checkpointed = false;
    if (checkpoints === 0) {
      try {
        await handles.journal.checkpoint(issueId, { sessionId: input.session_id });
        checkpointed = true;
      } catch {
        checkpointed = false;
      }
    }
    const continuity =
      `session ending with live claim on ${issueRef} (holder ${claim.holder}). ` +
      `continuity: ${checkpoints + (checkpointed ? 1 : 0)} checkpoint(s) since claim${checkpointed ? " (one written at stop)" : ""}, ` +
      `${blockers} blocker(s), ${handoffs} handoff(s) on record. ` +
      `work stays open; resume with \`sb issue resume ${issueRef}\`.`;
    return { allow: true, issueRef, checkpointed, continuity };
  } catch (err) {
    return { allow: true, issueRef, checkpointed: false, continuity: null, degraded: true };
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

const invokedAsMain = process.argv[1]?.endsWith("stop-gate.ts") ?? false;
if (invokedAsMain) {
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
  });
  if (!result.continuity) process.exit(0);
  process.stdout.write(JSON.stringify({ additionalContext: result.continuity }) + "\n");
  process.exit(0);
}
