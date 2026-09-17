// Substrate edit gate (§38, bead xtrm-6qu.6). Replaces beads-edit-gate.mjs.
//
// Decision inputs (§38): resolved current Issue and live claim. Beads
// blocked edits when the session held no claim; this gate asks the typed
// service instead of bd kv. Substrate provides no workspace-exclusion
// guarantee (XTRM-414): per-issue claim fencing is the only authority here;
// workspace exclusion is owned by the specialists activation layer.
// Library-first: handleEditGate calls IssueService in-process, never execs
// `sb`, never parses CLI text. Fail-open on unreadable state (a corrupt DB
// must not brick the session); fail-closed when a resolved Issue lacks the
// current claim holder + activation authority.

import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";
import { armPipeDrain } from "../write-and-exit.ts";
import { sameHolder } from "../../src/domain/claim.ts";

export interface EditGateInput {
  tool_name?: string;
  tool_input?: { file_path?: string };
  cwd?: string;
  session_id?: string;
  issueRef?: string;
  holder?: string;
  activationId?: string;
  dbPath?: string;
}

export interface EditGateResult {
  allow: boolean;
  issueRef: string | null;
  reason?: string;
  degraded?: boolean;
}

// Pure decision over resolved state (unit-testable; mirrors the retired
// beads decideEditGate shape: bound work without a live claim blocks).
// Holder identity is holder + activation (sameHolder): holder B never
// inherits holder A's claim, and the same holder under a different
// activation is a different execution. A live claim with no current holder
// is fail-closed — without WHO the gate cannot authorize the mutation.
export function evaluateEditState(state: {
  issueRef: string | null;
  claim?: { holder: string; activationId: string | null } | null;
  claimed?: boolean;
  holder?: string | null;
  activationId?: string | null;
}): EditGateResult {
  if (!state.issueRef) return { allow: true, issueRef: null, reason: "no bound issue; nothing to gate" };
  const claim = state.claim ?? null;
  const claimed = claim !== null || state.claimed === true;
  if (!claimed) {
    return {
      allow: false,
      issueRef: state.issueRef,
      reason: `no live claim on ${state.issueRef}; run \`sb issue claim ${state.issueRef} --holder <name>\` first`,
    };
  }
  if (claim) {
    if (!state.holder) {
      return {
        allow: false,
        issueRef: state.issueRef,
        reason: `live claim on ${state.issueRef} held by ${claim.holder}; no current holder supplied, refusing without WHO`,
      };
    }
    if (!sameHolder(claim, state.holder, state.activationId ?? null)) {
      return {
        allow: false,
        issueRef: state.issueRef,
        reason: `live claim on ${state.issueRef} held by ${claim.holder}${claim.activationId ? ` (activation ${claim.activationId})` : ""}; holder ${state.holder} may not mutate`,
      };
    }
  }
  return { allow: true, issueRef: state.issueRef };
}

export function handleEditGate(input: EditGateInput = {}): EditGateResult {
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  if (!issueRef) return { allow: true, issueRef: null, reason: "no bound issue; nothing to gate" };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const claim = handles.svc.getActiveClaim(issueId);
    return evaluateEditState({
      issueRef,
      claim: claim ? { holder: claim.holder, activationId: claim.activationId } : null,
      claimed: claim !== null,
      holder: input.holder ?? null,
      activationId: input.activationId ?? null,
    });
  } catch (err) {
    return { allow: true, issueRef, degraded: true, reason: err instanceof Error ? err.message : String(err) };
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

const invokedAsMain = (process.argv[1]?.endsWith("edit-gate.ts") || process.argv[1]?.endsWith("edit-gate.js")) ?? false;
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
  const toolInput = (hook["tool_input"] as Record<string, unknown> | undefined) ?? undefined;
  const result = handleEditGate({
    tool_name: hook["tool_name"] as string | undefined,
    tool_input: toolInput as EditGateInput["tool_input"],
    cwd: (hook["cwd"] as string | undefined) ?? process.cwd(),
    session_id: hook["session_id"] as string | undefined,
    issueRef: process.env["SUBSTRATE_ISSUE_REF"],
    holder: process.env["SUBSTRATE_HOLDER"],
    activationId: process.env["SUBSTRATE_ACTIVATION_ID"],
  });
  // PreToolUse contract: exit 0 always; a block is JSON on stdout.
  // XTRM-335: the allow exit is a proven zero-byte quiet path; only the
  // write-then-terminate path drains via exitCode.
  if (result.allow) process.exit(0);
  process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason ?? "no live claim" }) + "\n");
  process.exitCode = 0;
}
