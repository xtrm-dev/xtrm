#!/usr/bin/env node
// post-commit adapter (PRD §28.2): finalizes the open receipt to the exact
// SHA git just created (self-reference §28.3). The active receipt is the
// host-set XTRM_RECEIPT_ID when present, else it is resolved from Substrate
// state (§28.2: "the active execution/claim is resolved from Substrate
// state") — the host-owned Issue ref plus the single open receipt whose
// binding workspace is this checkout (XTRM-415). No receipt, or an ambiguous
// one, is a quiet no-op: a missing link is reported, never guessed.
// Fails closed on corrupt state. XTRM_COMMIT_SHA overrides
// `git rev-parse HEAD` (tests, bound-hook determinism).
// In remote mode (ADR-008) the server owns the store: the same decision is
// forwarded as `sb provenance bind`, best effort.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { normalizeWorkspace } from "../src/domain/claim.ts";
import { armPipeDrain } from "../integrations/write-and-exit.ts";
import { remoteHookMode, remotePostCommit } from "./remote.ts";

function dbPath(): string {
  return process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

function headSha(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

// Host-owned Issue ref for this checkout: env first (the hook env an agent
// exports), then the durable `.substrate-issue` marker. Never inferred from
// branch names or commit text.
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

// The open receipt this checkout is executing: unfinalized, unbound to any
// SHA, and pinned to a binding whose workspace is this repo root. Exactly one
// resolves; zero or many stays null, because binding the wrong receipt is
// worse than reporting no link.
function openReceiptId(issues: IssueService, provenance: ProvenanceService, repoRoot: string): string | null {
  const ref = discoverIssueRef(repoRoot);
  if (!ref) return null;
  let issueId: string;
  try {
    issueId = issues.resolveRef(ref).id;
  } catch {
    return null;
  }
  const workspace = normalizeWorkspace(repoRoot);
  const open = provenance
    .listReceipts(issueId)
    .filter((r) => r.commitSha === null && r.finalizedAt === null)
    .filter((r) => normalizeWorkspace(provenance.getBinding(r.executionBindingId).workspace) === workspace);
  return open.length === 1 ? open[0]!.id : null;
}

// XTRM-335: every quiet exit below happens before any stream write (proven
// zero-byte). Paths that write drain via exitCode + natural return.
// armPipeDrain() keeps a closed reader from surfacing as an EPIPE crash.
armPipeDrain();
const repoRoot = process.env["XTRM_REPO_ROOT"] ?? process.cwd();
const envReceiptId = process.env["XTRM_RECEIPT_ID"] || null;

// Quiet guard (zero-byte, before any write): an explicit receipt, or a tracked
// checkout with its Issue ref and an existing store. Everything else, including
// remote mode with nothing to forward, is a no-op.
if (envReceiptId === null && !(discoverIssueRef(repoRoot) !== null && (remoteHookMode() || existsSync(dbPath())))) process.exit(0);

if (remoteHookMode()) {
  remotePostCommit(repoRoot);
} else {
  localPostCommit(repoRoot, envReceiptId);
}

function localPostCommit(root: string, receiptFromEnv: string | null): void {
  // An absent XTRM_RECEIPT_ID is not "nothing to do" (XTRM-415), but recovery
  // must stay side-effect free for the untracked-commit path: it only runs when
  // this checkout carries a host-owned Issue ref and the store already exists.
  if (receiptFromEnv === null && !(discoverIssueRef(root) !== null && existsSync(dbPath()))) return;

  let db: ReturnType<typeof openSubstrate> | null = null;
  try {
    db = openSubstrate(dbPath());
    const svc = new IssueService(db);
    const provenance = new ProvenanceService(db, svc);
    const receiptId = receiptFromEnv ?? openReceiptId(svc, provenance, root);
    // No open receipt for this checkout is a quiet no-op, not an error: a
    // guessed bind would be worse than a reported absence.
    if (receiptId !== null) {
      const sha = process.env["XTRM_COMMIT_SHA"] ?? headSha(root);
      if (!sha) {
        process.stderr.write("xtrm post-commit: cannot resolve HEAD SHA\n");
        process.exitCode = 1;
      } else {
        provenance.bindCommit(receiptId, sha);
      }
    }
  } catch (err) {
    process.stderr.write(`xtrm post-commit: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    try {
      db?.close();
    } catch {
      /* close must not mask the result */
    }
  }
}
