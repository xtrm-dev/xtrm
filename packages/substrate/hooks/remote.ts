// Remote hook adapters (ADR-008): in remote mode the hook writes nothing
// locally; it forwards the same decision to the server's `sb` over the same
// argv surface a person would use.
//
// Hooks are best effort: an unreachable server must not block a commit, so a
// failure is reported on stderr and git proceeds. That is the one deliberate
// divergence from the local adapters, which fail closed on corrupt state —
// local state that is wrong is a defect, a network that is down is weather.
//
// Two rules keep a hook from costing more than the commit it decorates:
// one budget for the whole hook (not one timeout per call), and no discovery —
// a hook uses a mapping `sb remote setup` already verified, never the
// candidate-checkout walk that costs one round trip per candidate.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeWorkspace } from "../src/domain/claim.ts";
import { attachTrailers, formatTrailers } from "../src/domain/provenance.ts";
import { selectRemote } from "../src/remote/config.ts";
import { ambientEnv, hookMapping, hookSession, localStoreRequested } from "../src/remote/executor.ts";
import { clientRepositoryKey, runRemote, runRemoteJson, type RemoteSession } from "../src/remote/session.ts";

// A hook runs inside an operator's commit, so its diagnostics stay one line:
// the candidate list a mapping failure carries belongs to `sb remote setup`,
// not to every `git commit` in a repository the server does not hold.
function warn(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`xtrm: remote: ${message.split(" (candidates: ")[0]!.trim()}\n`);
}

// A hook has no argv, but it has the environment, and an explicit local store
// wins over every remote setting there too: without this, `SUBSTRATE_DB=X git
// commit` would bind the commit on the server while the caller asked for X.
export function remoteHookMode(): boolean {
  if (localStoreRequested([], process.env) !== null) return false;
  // Malformed configuration is also "not local": writing to the stale local
  // store would be worse than doing nothing.
  try {
    return selectRemote() !== null;
  } catch (err) {
    warn(err);
    return true;
  }
}

// One budget for the whole hook, discovery, mapping and the write included. A
// per-call bound was not a bound: a cold session plus three calls held one
// commit for 24 s (review M8). Past this, reporting the miss is better than
// holding the commit, and the server may still have applied the write.
export const HOOK_BUDGET_MS = 8_000;

// Identifiers that reach a server command line are validated here, not trusted:
// `XTRM_RECEIPT_ID=--db` used to be forwarded as an ssh option-shaped argument
// and created a SQLite file at a path on the server (review M3).
const RECEIPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISSUE_REF = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[0-9a-f]{7,64}$/i;

export function validReceiptId(value: string | undefined | null): string | null {
  const text = (value ?? "").trim();
  return RECEIPT_ID.test(text) ? text : null;
}

function validIssueRef(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  return ISSUE_REF.test(text) ? text : null;
}

function validSha(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  return SHA.test(text) ? text.toLowerCase() : null;
}

// A `.substrate-issue` file states which Issue this checkout is working on, and
// it is only trustworthy when it is operator state rather than repository
// content: a committed marker would let any cloned repository name an Issue the
// commit is then bound to (review M1). Tracked files are ignored.
function isTracked(repoRoot: string, name: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", name], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function discoverIssueRef(repoRoot: string): string | null {
  const env = process.env["SUBSTRATE_ISSUE_REF"]?.trim() || process.env["SUBSTRATE_ISSUE"]?.trim();
  if (env) return env;
  const file = join(repoRoot, ".substrate-issue");
  if (!existsSync(file)) return null;
  if (isTracked(repoRoot, ".substrate-issue")) return null;
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
// workspace is this checkout. The server recorded the client path it was handed
// at dispatch; a receipt bound to the server's own checkout belongs to a session
// that ran there and must not be adopted here (review M1), so only the client
// workspace — compared the way the local adapter compares it — can match.
function openReceiptId(session: RemoteSession, serverRoot: string, ref: string, clientRoot: string): string | null {
  const data = (runRemoteJson(session, ["provenance", "trace", ref, "--json"], { cwd: serverRoot })) as {
    receipts?: TraceReceipt[];
    bindings?: TraceBinding[];
  };
  const wanted = normalizeWorkspace(clientRoot);
  const workspaces = new Map((data.bindings ?? []).map((binding) => [binding.id, binding.workspace]));
  const open = (data.receipts ?? [])
    .filter((receipt) => (receipt.commitSha ?? null) === null && (receipt.finalizedAt ?? null) === null)
    .filter((receipt) => {
      const workspace = workspaces.get(receipt.executionBindingId);
      if (typeof workspace !== "string" || workspace.trim() === "") return false;
      try {
        return normalizeWorkspace(workspace) === wanted;
      } catch {
        return false;
      }
    });
  return open.length === 1 ? validReceiptId(open[0]!.id) : null;
}

function openSession(): RemoteSession | null {
  return hookSession(process.env, { deadlineMs: Date.now() + HOOK_BUDGET_MS });
}

function cachedRoot(session: RemoteSession): string | null {
  const repositoryKey = clientRepositoryKey();
  if (repositoryKey === null) return null;
  const mapping = hookMapping(session, repositoryKey);
  if (mapping === null) {
    throw new Error("no verified server checkout for " + repositoryKey + " is cached; run `sb remote setup " + session.config.remote + "`");
  }
  return mapping.root;
}

export function remotePostCommit(repoRoot: string): void {
  try {
    const session = openSession();
    if (session === null) return;
    const rawReceipt = process.env["XTRM_RECEIPT_ID"] || null;
    const receiptFromEnv = rawReceipt === null ? null : validReceiptId(rawReceipt);
    if (rawReceipt !== null && receiptFromEnv === null) {
      warn("XTRM_RECEIPT_ID " + JSON.stringify(rawReceipt) + " is not a receipt id; nothing was bound");
      return;
    }
    const ref = validIssueRef(discoverIssueRef(repoRoot));
    if (receiptFromEnv === null && ref === null) return;
    const root = cachedRoot(session);
    if (root === null) return;
    const receiptId = receiptFromEnv ?? openReceiptId(session, root, ref!, repoRoot);
    if (receiptId === null) return;
    const sha = validSha(process.env["XTRM_COMMIT_SHA"] ?? headSha(repoRoot));
    if (sha === null) {
      warn("cannot resolve a commit SHA");
      return;
    }
    const result = runRemote(session, ["provenance", "bind", receiptId, sha, "--json"], { cwd: root, env: ambientEnv() });
    if (result.code !== 0) warn(result.stderr.trim() || "provenance bind failed");
  } catch (err) {
    warn(err);
  }
}

export function remotePrepareCommitMsg(messageFile: string): void {
  try {
    const session = openSession();
    if (session === null) return;
    const receiptId = validReceiptId(process.env["XTRM_RECEIPT_ID"]);
    if (receiptId === null) return;
    const root = cachedRoot(session);
    if (root === null) return;
    // --json is not decoration: without it the server answers with a rendered
    // line, the parse found no `receipt`, and the trailer was silently skipped
    // while the commit looked healthy (review H3).
    const data = (runRemoteJson(session, ["provenance", "receipt", receiptId, "--json"], { cwd: root, env: ambientEnv() })) as {
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
