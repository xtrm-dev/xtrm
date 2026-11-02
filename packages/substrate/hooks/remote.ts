// Remote hook adapters (ADR-008): in remote mode the hook writes nothing
// locally; it forwards the same decision to the server's `sb` over the same
// argv surface a person would use.
//
// Hooks are best effort: an unreachable server must not block a commit, so a
// failure is reported on stderr and git proceeds. That is the one deliberate
// divergence from the local adapters, which fail closed on corrupt state —
// local state that is wrong is a defect, a network that is down is weather.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attachTrailers, formatTrailers } from "../src/domain/provenance.ts";
import { selectRemote } from "../src/remote/config.ts";
import {
  clientRepositoryKey,
  openRemoteSession,
  resolveMapping,
  runRemote,
  runRemoteJson,
  type RemoteSession,
} from "../src/remote/session.ts";

// A hook runs inside an operator's commit, so its diagnostics stay one line:
// the candidate list a mapping failure carries belongs to `sb remote setup`,
// not to every `git commit` in a repository the server does not hold.
function warn(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`xtrm: remote: ${message.split(" (candidates: ")[0]!.trim()}\n`);
}

// Malformed configuration is also "not local": writing to the stale local store
// would be worse than doing nothing.
export function remoteHookMode(): boolean {
  try {
    return selectRemote() !== null;
  } catch (err) {
    warn(err);
    return true;
  }
}

function discoverIssueRef(repoRoot: string): string | null {
  const env = process.env["SUBSTRATE_ISSUE_REF"]?.trim() || process.env["SUBSTRATE_ISSUE"]?.trim();
  if (env) return env;
  const file = join(repoRoot, ".substrate-issue");
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8").trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

function headSha(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

interface TraceReceipt {
  id?: string;
  commitSha?: string | null;
  finalizedAt?: number | null;
  executionBindingId?: string;
}

interface TraceBinding {
  id?: string;
  workspace?: string;
}

// Same rule as the local adapter: exactly one open receipt whose binding
// workspace is this checkout resolves. The server recorded either the client
// path it was handed at dispatch or its own checkout, so both are accepted;
// anything else stays unresolved rather than guessing.
function openReceiptId(session: RemoteSession, serverRoot: string, ref: string, clientRoot: string): string | null {
  const data = (runRemoteJson(session, ["provenance", "trace", ref], { cwd: serverRoot })) as {
    receipts?: TraceReceipt[];
    bindings?: TraceBinding[];
  };
  const workspaces = new Map((data.bindings ?? []).map((binding) => [binding.id, binding.workspace]));
  const open = (data.receipts ?? [])
    .filter((receipt) => (receipt.commitSha ?? null) === null && (receipt.finalizedAt ?? null) === null)
    .filter((receipt) => {
      const workspace = workspaces.get(receipt.executionBindingId);
      return workspace === clientRoot || workspace === serverRoot;
    });
  return open.length === 1 && typeof open[0]!.id === "string" ? open[0]!.id : null;
}

export function remotePostCommit(repoRoot: string): void {
  try {
    const session = openRemoteSession();
    if (session === null) return;
    const envReceiptId = process.env["XTRM_RECEIPT_ID"] || null;
    const ref = discoverIssueRef(repoRoot);
    if (envReceiptId === null && ref === null) return;
    const repositoryKey = clientRepositoryKey();
    if (repositoryKey === null) return;
    const mapping = resolveMapping(session, repositoryKey);
    const receiptId = envReceiptId ?? openReceiptId(session, mapping.root, ref!, repoRoot);
    if (receiptId === null) return;
    const sha = process.env["XTRM_COMMIT_SHA"] ?? headSha(repoRoot);
    if (!sha) {
      warn("cannot resolve HEAD SHA");
      return;
    }
    const result = runRemote(session, ["provenance", "bind", receiptId, sha], { cwd: mapping.root });
    if (result.code !== 0) warn(result.stderr.trim() || "provenance bind failed");
  } catch (err) {
    warn(err);
  }
}

export function remotePrepareCommitMsg(messageFile: string): void {
  try {
    const session = openRemoteSession();
    if (session === null) return;
    const receiptId = process.env["XTRM_RECEIPT_ID"];
    if (!receiptId) return;
    const repositoryKey = clientRepositoryKey();
    if (repositoryKey === null) return;
    const mapping = resolveMapping(session, repositoryKey);
    const data = (runRemoteJson(session, ["provenance", "receipt", receiptId], { cwd: mapping.root })) as {
      receipt?: { id?: string; issueId?: string; issueRevision?: number };
    };
    const receipt = data.receipt;
    if (!receipt || typeof receipt.issueId !== "string" || typeof receipt.issueRevision !== "number") return;
    const message = readFileSync(messageFile, "utf8");
    writeFileSync(
      messageFile,
      attachTrailers(message, formatTrailers({ issueId: receipt.issueId, issueRevision: receipt.issueRevision, receiptId: receipt.id ?? receiptId })),
    );
  } catch (err) {
    warn(err);
  }
}

export function remotePostRewrite(pairs: Array<[string, string]>): void {
  if (pairs.length === 0) return;
  // sb 0.2.2 exposes no CLI verb for reconcileRewrite. Reporting the gap is the
  // honest outcome; silently "succeeding" would claim a reconciliation that
  // never happened.
  process.stderr.write(
    `xtrm: remote: ${pairs.length} rewritten commit(s) not reconciled on the server (no CLI verb for rewrite reconciliation in sb 0.2.2); the commit bindings still point at the pre-rewrite SHAs\n`,
  );
}
