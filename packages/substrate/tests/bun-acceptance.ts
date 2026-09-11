// Bun in-process acceptance for the Substrate SQLite seam (bead xtrm-6qu.7.4).
// Run: TMPDIR=/var/tmp bun tests/bun-acceptance.ts
// Imports the package root in-process (no Node subprocess, no second store)
// and exercises Issue, Journal, and Provenance services against one database.

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  openSubstrate,
  IssueService,
  JournalService,
  ProvenanceService,
} from "../src/index.ts";

const base = process.env.TMPDIR || "/var/tmp";
const BunVersion = (globalThis as { Bun?: { version?: string } }).Bun?.version;
if (!BunVersion) throw new Error("must run under Bun");
console.log(`bun ${BunVersion}: in-process package import OK`);

// No Node subprocess bridge in the store seam.
for (const f of ["../src/store/sqlite.ts", "../src/store/database.ts"]) {
  const src = readFileSync(new URL(f, import.meta.url).pathname, "utf8");
  assert.ok(!src.includes("child_process") && !src.includes("spawn"), `${f} must not bridge via subprocess`);
}

const dir = mkdtempSync(join(base, "substrate-bun-"));
const dbPath = join(dir, "state.db");
try {
  const db = openSubstrate(dbPath);
  assert.equal(db.constructor.name, "Database", "bun:sqlite driver selected");
  assert.equal(
    (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode,
    "wal",
  );

  // Issue path: project + issue creation, readiness, claim.
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "bun acceptance",
    kind: "task",
    contract: {
      problem: "P", success: "S", scope: ["a"], nonGoals: ["b"],
      constraints: ["c"], validation: [{ check: "v" }], output: [{ artifact: "o" }],
    },
    scrutiny: "LOW",
    authoredBy: "bun-probe",
  });
  assert.ok(issue.id.startsWith("iss_"));
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "bun-probe" });
  assert.equal(svc.assertDispatchable(issue.id).dispatchable, true);
  const claim = svc.claimIssue(issue.id, "bun-holder");
  assert.equal(claim.holder, "bun-holder");
  console.log("issue create/readiness/claim OK:", issue.humanRef);

  // Journal path: mechanical checkpoint append + cursor read.
  const journal = new JournalService(db, svc);
  const mechanical = journal.collectMechanical(issue.id, { sessionId: "bun-sess" });
  const entry = journal.appendEntry(issue.id, { kind: "checkpoint", mechanical });
  assert.equal(journal.latestCheckpoint(issue.id)?.id, entry.id);
  assert.equal(journal.since(issue.id, 0).entries.length, 1);
  console.log("journal append/checkpoint OK:", entry.id);

  // Provenance path: dispatch, receipt, SHA bind, trace.
  const prov = new ProvenanceService(db, svc);
  const binding = prov.dispatch(issue.id, { workspace: dir, participantId: "bun-p" });
  const receipt = prov.allocateReceipt(binding.id);
  prov.bindCommit(receipt.id, "a".repeat(40));
  assert.equal(prov.getReceipt(receipt.id).commitSha, "a".repeat(40));
  assert.ok(prov.trace(issue.id).bindings.length >= 1);
  console.log("provenance dispatch/receipt/trace OK:", binding.id);

  // Close/reopen durability on the one store.
  svc.setLifecycleState(issue.id, "done");
  db.close();
  const db2 = openSubstrate(dbPath);
  try {
    const svc2 = new IssueService(db2);
    assert.equal(svc2.getIssue(issue.id).lifecycleState, "done");
    assert.equal(new JournalService(db2, svc2).latestCheckpoint(issue.id)?.id, entry.id);
    svc2.setLifecycleState(issue.id, "open");
    assert.equal(svc2.getIssue(issue.id).lifecycleState, "open");
  } finally {
    db2.close();
  }
  console.log("close/reopen durability + WAL OK");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("BUN ACCEPTANCE: PASS");
