// Substrate commit check (§38, bead xtrm-6qu.6). Replaces beads-commit-gate.mjs.
//
// Beads blocked `git commit` while the session's claim was still open
// (close-first-then-commit). That order is wrong for Substrate: the commit
// SHA binds the receipt AFTER the commit (post-commit hook), so blocking on
// an open claim would invert the provenance flow. Disposition: validate the
// required context (Issue, revision, contract hash, claim, ExecutionBinding,
// receipt/provenance context) and nudge when it is missing, never block —
// the post-commit bind recovers a receipt-less commit. Existing Substrate
// Git provenance owns trailers and SHA binding (prepare-commit-msg,
// post-commit hooks).

import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";
import { ProvenanceService } from "../../src/service/provenance-service.ts";
import { armPipeDrain } from "../write-and-exit.ts";

export interface CommitCheckInput {
  command?: string;
  cwd?: string;
  session_id?: string;
  issueRef?: string;
  receiptId?: string;
  dbPath?: string;
}

export interface CommitCheckResult {
  intercept: boolean;
  allow: boolean;
  issueRef: string | null;
  nudge: string | null;
  degraded?: boolean;
}

export function isGitCommit(command: string): boolean {
  const unquoted = command.replace(/'[^']*'|"[^"]*"/g, "");
  if (/\bspecialists\s+(run|resume|result|feed|stop|status)\b/.test(unquoted)) return false;
  return /\bgit\s+commit\b/.test(unquoted);
}

export function handleCommitCheck(input: CommitCheckInput = {}): CommitCheckResult {
  const cmd = input.command ?? "";
  if (cmd !== "" && !isGitCommit(cmd)) return { intercept: false, allow: true, issueRef: null, nudge: null };
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  if (!issueRef) return { intercept: true, allow: true, issueRef: null, nudge: null };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const claim = handles.svc.getActiveClaim(issueId);
    if (!claim) return { intercept: true, allow: true, issueRef, nudge: null };
    const prov = new ProvenanceService(handles.db, handles.svc, handles.journal);
    const openReceipts = prov.listReceipts(issueId).filter((r) => r.commitSha === null && r.finalizedAt === null);
    const receiptId = input.receiptId ?? process.env["XTRM_RECEIPT_ID"];
    if (receiptId || openReceipts.length > 0) {
      return { intercept: true, allow: true, issueRef, nudge: null };
    }
    const bindings = prov.listBindings(issueId);
    const revision = handles.svc.getIssue(issueId).currentRevision;
    return {
      intercept: true,
      allow: true,
      issueRef,
      nudge: `live claim on ${issueRef} (revision ${revision}) with no dispatch/receipt and no ExecutionBinding context${bindings.length > 0 ? " (prior bindings exist)" : ""}; run \`sb provenance dispatch ${issueRef}\` before committing so trailers attach, or the post-commit bind will recover it`,
    };
  } catch (err) {
    return { intercept: true, allow: true, issueRef, degraded: true, nudge: null };
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

const invokedAsMain = (process.argv[1]?.endsWith("commit-check.ts") || process.argv[1]?.endsWith("commit-check.js")) ?? false;
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
  if ((hook["tool_name"] as string | undefined) !== "Bash") process.exit(0);
  const toolInput = (hook["tool_input"] as Record<string, unknown> | undefined) ?? {};
  const result = handleCommitCheck({
    command: (toolInput["command"] as string | undefined) ?? "",
    cwd: (hook["cwd"] as string | undefined) ?? process.cwd(),
    session_id: hook["session_id"] as string | undefined,
    issueRef: process.env["SUBSTRATE_ISSUE_REF"],
  });
  // XTRM-335: the two exits above are proven zero-byte quiet paths (no write
  // precedes either); only this write-then-terminate path drains via exitCode.
  if (!result.intercept || !result.nudge) process.exit(0);
  process.stdout.write(JSON.stringify({ additionalContext: result.nudge }) + "\n");
  process.exitCode = 0;
}
