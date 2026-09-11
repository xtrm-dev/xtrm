// Acceptance E30-E37 (PRD §49E, Phase 8 bead xtrm-7wc.9): execution
// bindings, trailers, SHA binding, rewrite reconciliation, both query
// directions, bundle survival, anti-forgery. Plus sb provenance verbs.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { parseTrailers } from "../src/domain/provenance.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-prov-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  return { dir, dbPath, db, svc };
}

// A dispatchable issue: valid contract + scrutiny + attestation + claim.
function readyIssue(svc: IssueService, title = "work") {
  const issue = svc.createIssue({
    projectId: "prj_xtrm", title, kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW", authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  const claim = svc.claimIssue(issue.id, "holder-1");
  return { issue, claim };
}

function cli(dbPath: string, argv: string[]): unknown {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

describe("E30: dispatch binds the exact revision/hash", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("freezes revision/hash/context; later edits bind anew without mutating", () => {
    const { issue } = readyIssue(s.svc);
    const prov = new ProvenanceService(s.db, s.svc);
    const b1 = prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1", attemptId: "a1" });
    assert.equal(b1.issueRevision, 1);
    assert.equal(b1.contractHash, s.svc.getIssue(issue.id).currentContractHash);
    assert.equal(b1.claimId, s.svc.getActiveClaim(issue.id)?.id);
    assert.ok(b1.resolvedContextHash.length >= 16);

    s.svc.updateContract(issue.id, contract({ problem: "v2 problem", success: "v2 success" }), "tester");
    s.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    const b2 = prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1" });
    assert.equal(b2.issueRevision, 2);
    assert.notEqual(b2.contractHash, b1.contractHash);
    assert.equal(prov.getBinding(b1.id).issueRevision, 1, "first binding is immutable");
  });

  it("rejects dispatch of unattested work and foreign claim ids", () => {
    const draft = s.svc.createIssue({ projectId: "prj_xtrm", title: "draft", kind: "task", contract: contract() });
    const prov = new ProvenanceService(s.db, s.svc);
    assert.throws(() => prov.dispatch(draft.id, { workspace: s.dir }), /not dispatchable/);
    const { issue } = readyIssue(s.svc, "other");
    assert.throws(() => prov.dispatch(issue.id, { workspace: s.dir, claimId: 99999 }), /not the live claim/);
  });
});

describe("E31-E33: trailers, SHA binding, rewrite reconciliation", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("trailers attach idempotently; post-commit binds the exact SHA", () => {
    const { issue } = readyIssue(s.svc);
    const prov = new ProvenanceService(s.db, s.svc);
    const binding = prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1" });
    const receipt = prov.allocateReceipt(binding.id);
    assert.equal(receipt.commitSha, null, "open receipt has no SHA yet (§28.3)");

    const msg = prov.trailersForCommit(receipt.id, "do the work\n");
    assert.match(msg, /XTRM-Issue: iss_/);
    assert.match(msg, /XTRM-Issue-Revision: 1/);
    assert.match(msg, new RegExp(`XTRM-Receipt: ${receipt.id}`));
    assert.equal(prov.trailersForCommit(receipt.id, msg), msg, "re-attach is a no-op");

    const bound = prov.bindCommit(receipt.id, SHA_A);
    assert.equal(bound.commitSha, SHA_A);
    assert.ok(bound.finalizedAt !== null);
    assert.equal(prov.bindCommit(receipt.id, SHA_A).commitSha, SHA_A, "hook retry is idempotent");
  });

  it("amend/rebase supersedes the old SHA and moves the receipt head", () => {
    const { issue } = readyIssue(s.svc);
    const prov = new ProvenanceService(s.db, s.svc);
    const receipt = prov.allocateReceipt(prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1" }).id);
    prov.bindCommit(receipt.id, SHA_A);
    const { reconciled } = prov.reconcileRewrite(SHA_A, SHA_B);
    assert.equal(reconciled, 1);
    assert.equal(prov.getReceipt(receipt.id).commitSha, SHA_B);
    assert.deepEqual(prov.findByCommit(SHA_A), [], "old SHA no longer resolves");
    assert.equal(prov.findByCommit(SHA_B)[0]!.receipt.id, receipt.id);
    assert.equal(prov.listArtifacts(receipt.id, { liveOnly: false }).length, 2);
    assert.equal(prov.reconcileRewrite(SHA_A, SHA_B).reconciled, 0, "second pass finds no live rows");
  });
});

describe("E34-E35: both query directions", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("commit -> issue revision and trace -> commits + PR", () => {
    const { issue } = readyIssue(s.svc);
    const journal = new JournalService(s.db, s.svc);
    journal.appendEntry(issue.id, { kind: "checkpoint", mechanical: journal.collectMechanical(issue.id) });
    const prov = new ProvenanceService(s.db, s.svc, journal);
    const receipt = prov.allocateReceipt(prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1", attemptId: "att-1" }).id);
    prov.bindCommit(receipt.id, SHA_A);
    prov.attachArtifact(receipt.id, "pr", "github:xtrm/xtrm#121", { provider: "github" });

    const hits = prov.findByCommit(SHA_A);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.binding.issueRevision, 1);
    assert.equal(hits[0]!.binding.issueId, issue.id);
    assert.deepEqual(prov.findByPr("github:xtrm/xtrm#121")[0]!.receipt.id, receipt.id);

    const t = prov.trace(issue.id);
    assert.equal(t.revision, 1);
    assert.ok(t.attestation !== null);
    assert.equal(t.claims.length, 1);
    assert.equal(t.bindings[0]!.attemptId, "att-1");
    assert.deepEqual(t.commits, [SHA_A]);
    assert.equal(t.prs[0]!.value, "github:xtrm/xtrm#121");
    assert.equal(t.checkpoints.length, 1);
    assert.equal(t.closureRevision, null, "open issue has no closure revision");
    s.svc.setLifecycleState(issue.id, "done");
    assert.equal(prov.trace(issue.id).closureRevision, 1);
  });
});

describe("E36: bundle survives SQLite loss with the exact contract", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("bundle file names the dispatched revision/hash after the DB is gone", () => {
    const { issue } = readyIssue(s.svc);
    const journal = new JournalService(s.db, s.svc);
    const checkpoint = journal.appendEntry(issue.id, {
      kind: "checkpoint",
      mechanical: journal.collectMechanical(issue.id),
      semantic: { summary: "did the thing" },
    });
    void checkpoint;
    const prov = new ProvenanceService(s.db, s.svc, journal);
    const receipt = prov.allocateReceipt(prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1" }).id, {
      validationRefs: [{ kind: "validation", value: "tests green" }],
    });
    prov.bindCommit(receipt.id, SHA_C);
    const repoRoot = join(s.dir, "repo");
    const { bundle, path } = prov.generateBundle(issue.id, { repoRoot });
    assert.match(path, /\.xtrm\/provenance\/bundles\/bnd_.*\.json$/);
    assert.equal(bundle.issueRevision, 1);
    assert.equal(bundle.contractHash, s.svc.getIssue(issue.id).currentContractHash);
    assert.deepEqual(bundle.contract, s.svc.getRevision(issue.id, 1).contract);
    assert.deepEqual(bundle.commitShas, [SHA_C]);
    assert.equal(bundle.checkpointSummaries.length, 1);
    assert.equal(bundle.checkpointSummaries[0]!.summary, "did the thing");

    // Simulate SQLite loss: close, delete the DB, read the bundle cold.
    const expectedHash = bundle.contractHash;
    s.db.close();
    for (const f of ["state.db", "state.db-wal", "state.db-shm"]) {
      try { rmSync(join(s.dir, f), { force: true }); } catch { /* best effort */ }
    }
    const cold = JSON.parse(readFileSync(path, "utf8")) as typeof bundle;
    assert.equal(cold.contractHash, expectedHash);
    assert.equal((cold.contract as { problem: string }).problem, "work problem");
    assert.ok(!("transcript" in cold) && !("journal" in cold), "summaries only, never full journal/transcript");
    s.db = openSubstrate(s.dbPath);
    s.svc = new IssueService(s.db);
  });
});

describe("E37: executor cannot forge host-owned receipts", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("model-controlled text creates no authority", () => {
    const { issue } = readyIssue(s.svc);
    const prov = new ProvenanceService(s.db, s.svc);
    // Forged trailer text names a receipt the host never allocated.
    const forged = `fix it\n\nXTRM-Issue: ${issue.id}\nXTRM-Issue-Revision: 1\nXTRM-Receipt: rcp_forged-by-model\n`;
    const parsed = parseTrailers(forged);
    assert.equal(parsed.receiptId, "rcp_forged-by-model");
    assert.throws(() => prov.getReceipt(parsed.receiptId!), /unknown receipt/);
    assert.deepEqual(prov.findByCommit(SHA_A), [], "no host binding, no resolution");
    assert.throws(() => prov.bindCommit("rcp_forged-by-model", SHA_A), /unknown receipt/);
    assert.throws(() => prov.bindCommit(prov.allocateReceipt(prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1" }).id).id, "not-a-sha"), /invalid commit SHA/);
    assert.throws(() => prov.attachArtifact(prov.allocateReceipt(prov.listBindings(issue.id)[0]!.id).id, "commit", SHA_B), /use bindCommit/);
  });

  it("receipts freeze the binding revision even after the issue advances", () => {
    const { issue } = readyIssue(s.svc);
    const prov = new ProvenanceService(s.db, s.svc);
    const binding = prov.dispatch(issue.id, { workspace: s.dir, participantId: "holder-1" });
    s.svc.updateContract(issue.id, contract({ problem: "v2", success: "v2s" }), "tester");
    const receipt = prov.allocateReceipt(binding.id);
    assert.equal(receipt.issueRevision, 1, "copied from binding, not live state");
    assert.equal(receipt.contractHash, binding.contractHash);
  });
});

describe("sb provenance verbs", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("dispatch -> trace -> commit -> receipt -> pr -> bundle over the CLI", () => {
    const { issue } = readyIssue(s.svc);
    const humanRef = issue.humanRef;
    const d = cli(s.dbPath, ["provenance", "dispatch", humanRef, "--workspace", s.dir, "--participant", "holder-1"]) as { bindingId: string; revision: number };
    assert.equal(d.revision, 1);

    // Receipt + commit binding happen host-side (service), then queries run via CLI.
    const db = openSubstrate(s.dbPath);
    try {
      const svc = new IssueService(db);
      const prov = new ProvenanceService(db, svc);
      const binding = prov.listBindings(svc.resolveRef(humanRef).id)[0]!;
      const receipt = prov.allocateReceipt(binding.id);
      prov.bindCommit(receipt.id, SHA_A);
      prov.attachArtifact(receipt.id, "pr", "github:xtrm/xtrm#1", { provider: "github" });
      writeFileSync(join(s.dir, "receipt.txt"), receipt.id);
    } finally {
      db.close();
    }
    const receiptId = readFileSync(join(s.dir, "receipt.txt"), "utf8");

    const t = cli(s.dbPath, ["provenance", "trace", humanRef]) as { commits: string[]; prs: Array<{ value: string }> };
    assert.deepEqual(t.commits, [SHA_A]);
    assert.equal(t.prs[0]!.value, "github:xtrm/xtrm#1");
    const c = cli(s.dbPath, ["provenance", "commit", SHA_A]) as Array<{ receipt: string }>;
    assert.equal(c[0]!.receipt, receiptId);
    const r = cli(s.dbPath, ["provenance", "receipt", receiptId]) as { receipt: { id: string } };
    assert.equal(r.receipt.id, receiptId);
    const p = cli(s.dbPath, ["provenance", "pr", "github:xtrm/xtrm#1"]) as Array<{ receipt: string }>;
    assert.equal(p[0]!.receipt, receiptId);
    const b = cli(s.dbPath, ["provenance", "bundle", humanRef, "--repo-root", s.dir]) as { bundleId: string; contractHash: string };
    assert.match(b.bundleId, /^bnd_/);
    assert.equal(b.contractHash, s.svc.getIssue(issue.id).currentContractHash);
  });
});
