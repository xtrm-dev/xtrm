#!/usr/bin/env node
// post-rewrite adapter (PRD §28.2): reconciles amended/rebased commit
// identities. Git feeds `<old> <new> <extra>` lines on stdin; every pair
// reconciles through ProvenanceService. No-op without stdin pairs.
// In remote mode (ADR-008) there is no CLI verb for rewrite reconciliation in
// sb 0.2.2, so the pairs are reported and left alone rather than pretended
// reconciled.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { isValidSha } from "../src/domain/provenance.ts";
import { armPipeDrain } from "../integrations/write-and-exit.ts";
import { remoteHookMode, remotePostRewrite } from "./remote.ts";

function dbPath(): string {
  return process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

// XTRM-335: the quiet no-pairs exit below is the only immediate exit left
// (proven zero-byte: no stream write precedes it). The error path drains via
// exitCode + natural return. armPipeDrain() keeps a closed reader from
// surfacing as an unhandled EPIPE crash.
armPipeDrain();
const pairs: Array<[string, string]> = [];
for (const line of readFileSync(0, "utf8").split("\n")) {
  const [oldSha, newSha] = line.trim().split(/\s+/);
  if (isValidSha(oldSha) && isValidSha(newSha) && oldSha !== newSha) pairs.push([oldSha, newSha]);
}
if (pairs.length === 0) process.exit(0);

if (remoteHookMode()) {
  remotePostRewrite(pairs);
} else {
  localPostRewrite(pairs);
}

function localPostRewrite(rewrites: Array<[string, string]>): void {
  let db: ReturnType<typeof openSubstrate> | null = null;
  try {
    db = openSubstrate(dbPath());
    const svc = new ProvenanceService(db, new IssueService(db));
    for (const [oldSha, newSha] of rewrites) svc.reconcileRewrite(oldSha, newSha);
  } catch (err) {
    process.stderr.write(`xtrm post-rewrite: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    try {
      db?.close();
    } catch {
      /* close must not mask the result */
    }
  }
}
