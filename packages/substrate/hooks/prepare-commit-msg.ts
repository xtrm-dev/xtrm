#!/usr/bin/env node
// prepare-commit-msg adapter (PRD §28.2): attaches active XTRM trailers to a
// tracked commit message. Host-owned fallback layer: native runtimes call
// ProvenanceService directly; raw `git commit` lands here instead.
// Fail-open when no execution is active (untracked commits pass through);
// fail-closed on corrupt Substrate state (never invent trailers).
// Resolution: the active receipt is host-set env (XTRM_RECEIPT_ID) at
// dispatch time. The agent never chooses provenance metadata.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { armPipeDrain } from "../integrations/write-and-exit.ts";

function dbPath(): string {
  return process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

// XTRM-335: the quiet exits below are the only immediate exits left (proven
// zero-byte: no stream write precedes them). The error path drains via
// exitCode + natural return. armPipeDrain() keeps a closed reader from
// surfacing as an unhandled EPIPE crash.
armPipeDrain();
const messageFile = process.argv[2];
if (!messageFile) process.exit(0);
const receiptId = process.env["XTRM_RECEIPT_ID"];
if (!receiptId) process.exit(0);

let db: ReturnType<typeof openSubstrate> | null = null;
try {
  db = openSubstrate(dbPath());
  const svc = new ProvenanceService(db, new IssueService(db));
  const message = readFileSync(messageFile, "utf8");
  writeFileSync(messageFile, svc.trailersForCommit(receiptId, message));
} catch (err) {
  process.stderr.write(`xtrm prepare-commit-msg: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
} finally {
  try {
    db?.close();
  } catch {
    /* close must not mask the result */
  }
}
