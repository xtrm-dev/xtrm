#!/usr/bin/env node
// post-rewrite adapter (PRD §28.2): reconciles amended/rebased commit
// identities. Git feeds `<old> <new> <extra>` lines on stdin; every pair
// reconciles through ProvenanceService. No-op without stdin pairs.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { isValidSha } from "../src/domain/provenance.ts";

function dbPath(): string {
  return process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

const pairs: Array<[string, string]> = [];
for (const line of readFileSync(0, "utf8").split("\n")) {
  const [oldSha, newSha] = line.trim().split(/\s+/);
  if (isValidSha(oldSha) && isValidSha(newSha) && oldSha !== newSha) pairs.push([oldSha, newSha]);
}
if (pairs.length === 0) process.exit(0);

let db: ReturnType<typeof openSubstrate> | null = null;
try {
  db = openSubstrate(dbPath());
  const svc = new ProvenanceService(db, new IssueService(db));
  for (const [oldSha, newSha] of pairs) svc.reconcileRewrite(oldSha, newSha);
} catch (err) {
  process.stderr.write(`xtrm post-rewrite: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
} finally {
  try {
    db?.close();
  } catch {
    /* close must not mask the result */
  }
}
