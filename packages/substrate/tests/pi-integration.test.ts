import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import {
  SessionBindings,
  openServices,
  resumeForSession,
  runBeforeCompact,
  toolIssueClaim,
  toolIssueGet,
  toolIssueResume,
  toolIssueSearch,
  toolIssueUpdate,
  toolJournalAppend,
  toolProvenanceTrace,
} from "../integrations/pi/handlers.ts";
import { contract } from "./helpers.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-pi-"));
  const dbPath = join(dir, "state.db");
  const svc = openServices(dbPath);
  svc.issues.createProject({ id: "prj_pi", prefix: "PI", name: "pi" });
  return { dir, dbPath, svc };
}

function readyIssue(svc: ReturnType<typeof openServices>, title = "Pi work"): string {
  const issue = svc.issues.createIssue({ projectId: "prj_pi", title, kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "test" });
  svc.issues.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "test" });
  return issue.id;
}

describe("tool surface over the typed service", () => {
  it("get/search/claim/update/append/resume/trace round-trip without SQL in the caller", () => {
    const { svc } = setup();
    try {
      const id = readyIssue(svc);
      const bindings = new SessionBindings();
      const got = toolIssueGet(svc, { ref: "PI-1" });
      assert.equal(got["humanRef"], "PI-1");
      assert.equal(got["dispatchable"], true);
      const found = toolIssueSearch(svc, { project: "prj_pi", query: "pi work" });
      assert.equal(found.length, 1);
      const claim = toolIssueClaim(svc, bindings, { ref: id, holder: "pi-holder", sessionId: "sess-1" });
      assert.equal(claim["holder"], "pi-holder");
      assert.equal(bindings.boundRef("sess-1"), id);
      const updated = toolIssueUpdate(svc, { ref: "PI-1", contract: { ...contract(), problem: "v2" } });
      assert.equal(updated["revisionCreated"], true);
      const appended = toolJournalAppend(svc, { ref: "PI-1", kind: "finding", sessionId: "sess-1" });
      assert.equal(appended["kind"], "finding");
      const capsule = toolIssueResume(svc, { ref: "PI-1" });
      assert.match(capsule, /PI-1/);
      const trace = toolProvenanceTrace(svc, { ref: "PI-1" });
      assert.equal(trace["revision"], 2);
      assert.ok((trace["eventTypes"] as string[]).includes("issue.attested"));
    } finally {
      svc.close();
    }
  });

  it("env fallback rebinds a fresh process", () => {
    const bindings = new SessionBindings();
    assert.equal(bindings.boundRef("nope"), null);
    process.env["SUBSTRATE_ISSUE"] = "PI-9";
    try {
      assert.equal(bindings.boundRef("nope"), "PI-9");
    } finally {
      delete process.env["SUBSTRATE_ISSUE"];
    }
  });
});

describe("D26: compaction failure falls back with the durable checkpoint intact", () => {
  it("summarizer failure degrades to host default; mechanical row stays resumable", async () => {
    const { svc } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(svc, {
        issueRef: id,
        sessionId: "sess-1",
        summarizer: async () => {
          throw new Error("secondary model down");
        },
      });
      assert.equal(result.degraded, true);
      assert.equal(result.fallbackToDefault, true);
      assert.equal(result.summary, null);
      assert.ok(result.entryId);
      // The durable checkpoint survives: resume restores contract + checkpoint.
      const capsule = svc.resume.buildCapsule(id);
      assert.ok(capsule.latestCheckpoint);
      assert.equal(capsule.latestCheckpoint.id, result.entryId);
      assert.equal((capsule.contract as { problem: string }).problem, "P");
    } finally {
      svc.close();
    }
  });

  it("SQLite write failure never blocks: null entry, fallback, no throw", async () => {
    const { svc } = setup();
    const id = readyIssue(svc);
    svc.close();
    const result = await runBeforeCompact(svc, { issueRef: id });
    assert.equal(result.entryId, null);
    assert.equal(result.fallbackToDefault, true);
    assert.equal(result.summary, null);
  });
});

describe("lifecycle: compact mid-execution, resume restores contract + checkpoint", () => {
  it("checkpoint then capsule round-trip through the compaction handler", async () => {
    const { svc } = setup();
    try {
      const id = readyIssue(svc, "Lifecycle work");
      svc.issues.claimIssue(id, "pi-holder", { activationId: "act-1" });
      const result = await runBeforeCompact(svc, {
        issueRef: id,
        sessionId: "sess-9",
        summarizer: async () => ({
          summary: "halfway through lifecycle work",
          completed: ["scaffold"],
          current: "wiring",
          next: ["verify"],
          blocked: [],
          openQuestions: [],
          keyDecisions: ["thin adapter"],
          materialFindings: [],
        }),
      });
      assert.equal(result.degraded, false);
      assert.equal(result.fallbackToDefault, false);
      assert.ok(result.summary?.includes("CHECKPOINT"));
      assert.ok(result.summary?.includes("halfway through lifecycle work"));
      // A later session resumes from durable state, not the compacted chat.
      const bindings = new SessionBindings();
      bindings.bind("sess-10", id);
      const resumed = resumeForSession(svc, bindings, "sess-10");
      assert.ok(resumed?.includes("PI-1"));
      assert.ok(resumed?.includes(result.entryId as string));
      assert.ok(resumed?.includes("scaffold"));
      assert.equal(resumeForSession(svc, new SessionBindings(), "unbound"), null);
    } finally {
      svc.close();
    }
  });
});

describe("journal service seam untouched", () => {
  it("compactionCheckpoint fallback contract still holds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-pi-"));
    const db = openSubstrate(join(dir, "s.db"));
    const issues = new IssueService(db);
    issues.createProject({ id: "prj_x", prefix: "X", name: "x" });
    const journal = new JournalService(db, issues);
    const issue = issues.createIssue({ projectId: "prj_x", title: "T", kind: "task", contract: contract() });
    const r = await journal.compactionCheckpoint(issue.id, { kind: "compaction" });
    assert.equal(r.fallbackToDefault, false);
    assert.ok(r.entry);
    db.close();
  });
});
