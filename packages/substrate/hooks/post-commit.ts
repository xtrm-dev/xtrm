#!/usr/bin/env node
// post-commit adapter (PRD §28.2): finalizes the open receipt to the exact
// SHA git just created (self-reference §28.3). No-op without an active
// receipt; fails closed on corrupt state. XTRM_COMMIT_SHA overrides
// `git rev-parse HEAD` (tests, bound-hook determinism).

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";

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

const receiptId = process.env["XTRM_RECEIPT_ID"];
if (!receiptId) process.exit(0);
const sha = process.env["XTRM_COMMIT_SHA"] ?? headSha(process.env["XTRM_REPO_ROOT"] ?? process.cwd());
if (!sha) {
  process.stderr.write("xtrm post-commit: cannot resolve HEAD SHA\n");
  process.exit(1);
}

let db: ReturnType<typeof openSubstrate> | null = null;
try {
  db = openSubstrate(dbPath());
  const svc = new ProvenanceService(db, new IssueService(db));
  svc.bindCommit(receiptId, sha);
} catch (err) {
  process.stderr.write(`xtrm post-commit: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
} finally {
  try {
    db?.close();
  } catch {
    /* close must not mask the result */
  }
}
