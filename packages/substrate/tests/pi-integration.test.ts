import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { JOURNAL_SUMMARY_MAX } from "../src/domain/journal.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { openBacking, type Backing } from "../integrations/pi/backing.ts";
import {
  SessionBindings,
  resumeForSession,
  runBeforeCompact,
  toolIssueClaim,
  toolIssueGet,
  toolIssueResume,
  toolIssueSearch,
  toolIssueUpdate,
  toolJournalAppend,
  toolJournalCheckpoint,
  toolProvenanceTrace,
  toPiCompaction,
} from "../integrations/pi/handlers.ts";
import { discoverIssueRef } from "../integrations/claude-code/runtime.ts";
import { contract, tempDir } from "./helpers.ts";

// A command the ssh shim below runs instead of a login: the same binary the
// repository ships, pointed at a scratch store that stands in for a server's.
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "sb.ts");

function setup() {
  const dir = tempDir("substrate-pi-");
  const dbPath = join(dir, "state.db");
  // Seeding stays on the concrete services: the handlers are what moves to the
  // typed service, and a seeding helper that went through it would test itself.
  const db = openSubstrate(dbPath);
  const issues = new IssueService(db);
  const journal = new JournalService(db, issues);
  const resume = new ResumeService(db, issues, journal);
  const provenance = new ProvenanceService(db, issues, journal);
  issues.createProject({ id: "prj_pi", prefix: "PI", name: "pi" });
  const svc = { db, issues, journal, resume, provenance, close: () => db.close() };
  // SUBSTRATE_DB outranks a remote, so the handlers always reach this file.
  const backing: Backing = openBacking({ env: { ...process.env, SUBSTRATE_DB: dbPath } });
  return { dir, dbPath, svc, backing };
}

function readyIssue(svc: { issues: IssueService }, title = "Pi work"): string {
  const issue = svc.issues.createIssue({ projectId: "prj_pi", title, kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "test" });
  svc.issues.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "test" });
  return issue.id;
}

describe("tool surface over the typed service", () => {
  it("session-only journal paths preserve ambient identity and explicit absence (XTRM-435)", async () => {
    const { svc, backing } = setup();
    const keys = ["XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"];
    const prior = keys.map((key) => process.env[key]);
    try {
      const id = readyIssue(svc);
      for (const key of keys) delete process.env[key];
      for (const present of [true, false]) {
        if (present) {
          process.env["SUBSTRATE_HOLDER"] = "specialist::probe";
          process.env["SUBSTRATE_ACTIVATION_ID"] = "act:23b2212a-c44";
        } else {
          delete process.env["SUBSTRATE_HOLDER"];
          delete process.env["SUBSTRATE_ACTIVATION_ID"];
        }
        const append = await toolJournalAppend(backing, { ref: id, kind: "finding", summary: "pi appends a finding through the typed service", sessionId: "pi-session" });
        const checkpoint = await toolJournalCheckpoint(backing, { ref: id, sessionId: "pi-session" });
        for (const entryId of [append.entryId, checkpoint.entryId]) {
          const row = svc.db.prepare("SELECT participant_id, activation_id, execution_context_json FROM issue_journal WHERE id = ?").get(entryId as string) as {
            participant_id: string | null; activation_id: string | null; execution_context_json: string;
          };
          assert.equal(row.participant_id, present ? "specialist::probe" : null);
          assert.equal(row.activation_id, present ? "act:23b2212a-c44" : null);
          assert.deepEqual(JSON.parse(row.execution_context_json).host, { type: "pi", sessionId: "pi-session" });
        }
      }
    } finally {
      keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; });
      svc.close();
      await backing.close();
    }
  });

  for (const facet of ["specialist", "coordinator"] as const) {
    it(`preserves trusted ${facet} while filling unstated activation (XTRM-435)`, async () => {
      const { svc, backing } = setup();
      const keys = ["XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"];
      const prior = keys.map((key) => process.env[key]);
      try {
        const id = readyIssue(svc);
        for (const key of keys) delete process.env[key];
        process.env["SUBSTRATE_ACTIVATION_ID"] = "act:23b2212a-c44";
        const base = facet === "specialist"
          ? { specialist: { name: "probe" } }
          : { coordinator: { participantId: "parent" } };
        for (const activationId of [undefined, "act:abcdef12-345"]) {
          const appended = await toolJournalAppend(backing, { ref: id, kind: "finding", summary: "pi carries the trusted identity facets", sessionId: "pi-session", activationId, executionContext: base });
          const raw = svc.db.prepare("SELECT activation_id, execution_context_json FROM issue_journal WHERE id = ?").get(appended.entryId as string) as { activation_id: string; execution_context_json: string };
          const ctx = JSON.parse(raw.execution_context_json);
          assert.equal(raw.activation_id, activationId ?? "act:23b2212a-c44");
          if (facet === "specialist") assert.equal(ctx.specialist.name, "probe");
          else assert.deepEqual(ctx.coordinator, { participantId: "parent" });
        }
        const before = svc.journal.listEntries(id).length;
        await assert.rejects(
          toolJournalAppend(backing, {
            ref: id, kind: "finding", summary: "an activation conflict must write nothing", sessionId: "pi-session", activationId: "act:abcdef12-345",
            executionContext: { specialist: { activationId: "act:23b2212a-c44" } },
          }),
          /conflict|activation/i,
        );
        assert.equal(svc.journal.listEntries(id).length, before, "conflict must write nothing");
      } finally {
        keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; });
        svc.close();
        await backing.close();
      }
    });
  }

  it("get/search/claim/update/append/resume/trace round-trip without SQL in the caller", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      const bindings = new SessionBindings();
      const got = await toolIssueGet(backing, { ref: "PI-1" });
      assert.equal(got["humanRef"], "PI-1");
      assert.equal(got["dispatchable"], true);
      const found = await toolIssueSearch(backing, { project: "prj_pi", query: "pi work" });
      assert.equal(found.length, 1);
      const claim = await toolIssueClaim(backing, bindings, { ref: id, holder: "pi-holder", sessionId: "sess-1" });
      assert.equal(claim["holder"], "pi-holder");
      assert.equal(bindings.boundRef("sess-1"), id);
      const updated = await toolIssueUpdate(backing, { ref: "PI-1", contract: { ...contract(), problem: "v2" } });
      assert.equal(updated["revisionCreated"], true);
      const appended = await toolJournalAppend(backing, { ref: "PI-1", kind: "finding", summary: "round trip appends one finding with no SQL in the caller", sessionId: "sess-1" });
      assert.equal(appended["kind"], "finding");
      const capsule = await toolIssueResume(backing, { ref: "PI-1" });
      assert.match(capsule, /PI-1/);
      const trace = (await toolProvenanceTrace(backing, { ref: "PI-1" })) as Record<string, unknown>;
      assert.equal(trace.revision, 2);
      assert.ok(Array.isArray(trace.bindings));
      assert.ok(Array.isArray(trace.receipts));
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("journal append persists supplied text end-to-end (XTRM-720)", async () => {
    const { dbPath, svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      const text = "handoff: the Pi journal tool now carries entry text\nline two stays verbatim";
      const appended = await toolJournalAppend(backing, { ref: "PI-1", kind: "handoff", summary: text, sessionId: "sess-1" });
      assert.equal(appended["summary"], text);
      const stored = svc.journal.getEntry(appended["entryId"] as string);
      assert.deepEqual(stored.semantic, { summary: text }, "same storage as sb issue note");

      // A content kind with no text is refused at the write seam (XTRM-670):
      // the tool may omit the text, but then the entry fails closed instead of
      // occupying a sequence number with nothing in it. The XTRM-720 contract's
      // "kind-only append stays valid" narrows to the response shape — an
      // explicit `summary: null` is only reachable for a kind that carries its
      // own payload, which this tool cannot build.
      const beforeKindOnly = svc.journal.listEntries(id).length;
      await assert.rejects(
        toolJournalAppend(backing, { ref: "PI-1", kind: "milestone", sessionId: "sess-1" }),
        /empty journal entry: kind "milestone" needs content/,
      );
      assert.equal(svc.journal.listEntries(id).length, beforeKindOnly, "the refused entry is not stored");

      // A result kind carries the text in its bounded result payload.
      const resultAppend = await toolJournalAppend(backing, { ref: "PI-1", kind: "result", summary: "shipped the field", sessionId: "sess-1" });
      assert.equal(svc.journal.getEntry(resultAppend["entryId"] as string).result?.summary, "shipped the field");

      // No silent data loss: blank and oversize text fail the call and write nothing.
      const before = svc.journal.listEntries(id).length;
      await assert.rejects(toolJournalAppend(backing, { ref: "PI-1", kind: "note", summary: "   ", sessionId: "sess-1" }), /must not be blank/);
      await assert.rejects(
        toolJournalAppend(backing, { ref: "PI-1", kind: "note", summary: "x".repeat(JOURNAL_SUMMARY_MAX + 1), sessionId: "sess-1" }),
        /at most \d+ characters/,
      );
      assert.equal(svc.journal.listEntries(id).length, before, "a rejected append writes nothing");

      // sb journal show renders the persisted line (the operator-facing surface).
      const shown = spawnSync(process.execPath, [CLI, "--db", dbPath, "journal", "show", "PI-1"], { encoding: "utf8" });
      assert.equal(shown.status, 0, shown.stderr);
      assert.match(shown.stdout, /summary: handoff: the Pi journal tool now carries entry text/);
      assert.doesNotMatch(shown.stdout, /summary: milestone/, "a text-less entry renders no summary line");
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("Pi provenance is the canonical receipt/artifact trace", async () => {
    const { dir, svc, backing } = setup();
    try {
      const id = readyIssue(svc, "Receipt work");
      svc.issues.claimIssue(id, "pi-holder");
      const binding = svc.provenance.dispatch(id, { workspace: dir, participantId: "pi-holder" });
      const receipt = svc.provenance.allocateReceipt(binding.id);
      svc.provenance.bindCommit(receipt.id, "a".repeat(40));
      const trace = (await toolProvenanceTrace(backing, { ref: "PI-1" })) as {
        bindings: Array<{ id: string }>;
        receipts: Array<{ id: string; artifacts: Array<{ kind: string; value: string }> }>;
        commits: string[];
      };
      assert.equal(trace.bindings.length, 1);
      assert.equal(trace.receipts.length, 1);
      assert.equal(trace.receipts[0]?.id, receipt.id);
      assert.deepEqual(trace.commits, ["a".repeat(40)]);
      assert.ok(trace.receipts[0]?.artifacts.some((a) => a.kind === "commit" && a.value === "a".repeat(40)));
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("env fallback rebinds a fresh process", async () => {
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

// Converged env names: SUBSTRATE_ISSUE_REF wins on both surfaces;
// SUBSTRATE_ISSUE is the backcompat alias. Three per surface.

describe("issue-ref env alias", () => {
  function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const prior: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) prior[k] = process.env[k];
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fn();
    } finally {
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("Pi: _REF wins over the legacy name", async () => {
    withEnv({ SUBSTRATE_ISSUE_REF: "PI-REF", SUBSTRATE_ISSUE: "PI-OLD" }, () => {
      assert.equal(new SessionBindings().boundRef("nope"), "PI-REF");
    });
  });

  it("Pi: legacy name still binds when _REF is unset", async () => {
    withEnv({ SUBSTRATE_ISSUE_REF: undefined, SUBSTRATE_ISSUE: "PI-OLD" }, () => {
      assert.equal(new SessionBindings().boundRef("nope"), "PI-OLD");
    });
  });

  it("Pi: neither name binds nothing", async () => {
    withEnv({ SUBSTRATE_ISSUE_REF: undefined, SUBSTRATE_ISSUE: undefined }, () => {
      assert.equal(new SessionBindings().boundRef("nope"), null);
    });
  });

  it("Claude: _REF wins over the legacy name", async () => {
    withEnv({ SUBSTRATE_ISSUE_REF: "C-REF", SUBSTRATE_ISSUE: "C-OLD" }, () => {
      assert.equal(discoverIssueRef(), "C-REF");
    });
  });

  it("Claude: legacy name still resolves when _REF is unset", async () => {
    withEnv({ SUBSTRATE_ISSUE_REF: undefined, SUBSTRATE_ISSUE: "C-OLD" }, () => {
      assert.equal(discoverIssueRef(), "C-OLD");
    });
  });

  it("Claude: neither name resolves nothing", async () => {
    withEnv({ SUBSTRATE_ISSUE_REF: undefined, SUBSTRATE_ISSUE: undefined }, () => {
      assert.equal(discoverIssueRef(), null);
    });
  });
});

describe("D26: compaction failure falls back with the durable checkpoint intact", () => {
  it("summarizer failure degrades to host default; mechanical row stays resumable", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-1",
        summarizer: async () => {
          throw new Error("secondary model down");
        },
      });
      assert.equal(result.degraded, true);
      assert.equal(result.fallbackToDefault, true);
      assert.equal(result.summary, null);
      assert.equal(result.usage, null);
      assert.equal(toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 100 }, result), undefined);
      assert.ok(result.entryId);
      const capsule = svc.resume.buildCapsule(id);
      assert.ok(capsule.latestCheckpoint);
      assert.equal(capsule.latestCheckpoint.id, result.entryId);
      assert.equal((capsule.contract as { problem: string }).problem, "P");
      assert.equal(svc.journal.listEntries(id, { kind: "note" }).length, 0);
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("SQLite write failure never blocks: null entry, fallback, no throw", async () => {
    const { svc, backing } = setup();
    const id = readyIssue(svc);
    svc.close();
      await backing.close();
    const result = await runBeforeCompact(backing, { issueRef: id });
    assert.equal(result.entryId, null);
    assert.equal(result.fallbackToDefault, true);
    assert.equal(result.summary, null);
    assert.equal(result.usage, null);
    assert.equal(toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 100 }, result), undefined);
  });
});

describe("XTRM-440: compaction usage rides alongside the checkpoint, never inside it", () => {
  const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };

  it("summarizer reporting usage: result carries it, host payload includes it, persisted checkpoint omits it", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-usage",
        summarizer: async () => ({ summary: "did work", usage }),
      });
      assert.equal(result.fallbackToDefault, false);
      assert.deepEqual(result.usage, usage);
      const payload = toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 500 }, result);
      assert.deepEqual(payload?.compaction.usage, usage);
      const persisted = svc.journal.listEntries(id, { kind: "compaction" }).at(-1);
      assert.ok(persisted?.semantic);
      assert.equal((persisted?.semantic as unknown as Record<string, unknown>)["usage"], undefined);
      assert.equal(svc.journal.listEntries(id, { kind: "note" }).length, 0);
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("summarizer without usage: result.usage is null, host payload omits usage, one absence note is recorded", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-no-usage",
        summarizer: async () => ({ summary: "did some unrelated work" }),
      });
      assert.equal(result.fallbackToDefault, false);
      assert.equal(result.usage, null);
      assert.ok(!result.summary?.includes("reported no usage"));
      const payload = toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 500 }, result);
      assert.ok(payload);
      assert.equal("usage" in payload.compaction, false);
      const notes = svc.journal.listEntries(id, { kind: "note" });
      assert.equal(notes.length, 1);
      assert.match(notes[0]!.semantic!.summary, /no usage/);
      assert.match(notes[0]!.semantic!.summary, new RegExp(result.entryId as string));
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("fallback (summarizer throws): usage null, toPiCompaction is undefined, no absence note", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-throws",
        summarizer: async () => {
          throw new Error("secondary model down");
        },
      });
      assert.equal(result.fallbackToDefault, true);
      assert.equal(result.usage, null);
      assert.equal(toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 500 }, result), undefined);
      assert.equal(svc.journal.listEntries(id, { kind: "note" }).length, 0);
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("no summarizer: mechanical-only summary, usage null, host payload omits usage, no absence note", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(backing, { issueRef: id, sessionId: "sess-none" });
      assert.equal(result.fallbackToDefault, false);
      assert.ok(result.summary);
      assert.equal(result.usage, null);
      const payload = toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 500 }, result);
      assert.ok(payload);
      assert.equal("usage" in payload.compaction, false);
      assert.equal(svc.journal.listEntries(id, { kind: "note" }).length, 0);
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("checkpoint commits before a usage-reporting summarizer runs", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      let observed: string | null = null;
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-order",
        summarizer: async (persisted) => {
          const rows = svc.journal.listEntries(id, { kind: "compaction" });
          assert.equal(rows.at(-1)?.id, persisted.id, "compaction row must be readable inside the summarizer");
          observed = persisted.id;
          return { summary: "ordered", usage };
        },
      });
      assert.equal(observed, result.entryId);
      assert.deepEqual(result.usage, usage);
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("absence-note append failure never breaks compaction", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const original = svc.journal.appendEntry.bind(svc.journal);
      svc.journal.appendEntry = (issueId, input) => {
        if (input.kind === "note") throw new Error("disk full");
        return original(issueId, input);
      };
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-note-fails",
        summarizer: async () => ({ summary: "did work" }),
      });
      assert.equal(result.fallbackToDefault, false);
      assert.ok(result.summary);
      assert.equal(result.usage, null);
      assert.ok(toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 500 }, result));
    } finally {
      svc.close();
      await backing.close();
    }
  });

  it("synchronous summarizer reporting usage works", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc);
      svc.issues.claimIssue(id, "pi-holder");
      const result = await runBeforeCompact(backing, {
        issueRef: id,
        sessionId: "sess-sync",
        summarizer: () => ({ summary: "sync work", usage }),
      });
      assert.equal(result.fallbackToDefault, false);
      assert.deepEqual(result.usage, usage);
      assert.deepEqual(toPiCompaction({ firstKeptEntryId: "e1", tokensBefore: 500 }, result)?.compaction.usage, usage);
      assert.equal(svc.journal.listEntries(id, { kind: "note" }).length, 0);
    } finally {
      svc.close();
      await backing.close();
    }
  });
});

describe("lifecycle: compact mid-execution, resume restores contract + checkpoint", () => {
  it("checkpoint then capsule round-trip through the compaction handler", async () => {
    const { svc, backing } = setup();
    try {
      const id = readyIssue(svc, "Lifecycle work");
      svc.issues.claimIssue(id, "pi-holder", { activationId: "act-1" });
      const result = await runBeforeCompact(backing, {
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
      const bindings = new SessionBindings();
      bindings.bind("sess-10", id);
      const resumed = await resumeForSession(backing, bindings, "sess-10");
      assert.ok(resumed?.includes("PI-1"));
      assert.ok(resumed?.includes(result.entryId as string));
      assert.ok(resumed?.includes("scaffold"));
      assert.equal(await resumeForSession(backing, new SessionBindings(), "unbound"), null);
    } finally {
      svc.close();
      await backing.close();
    }
  });
});

describe("journal service seam untouched", () => {
  it("compactionCheckpoint fallback contract still holds", async () => {
    const dir = tempDir("substrate-pi-");
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

describe("the backing picks the store the configuration names (XTRM-691)", () => {
  function remoteFixture(): { dir: string; dbPath: string; configPath: string; shimDir: string } {
    const dir = tempDir("pi-remote-");
    const dbPath = join(dir, "server.db");
    const repo = join(dir, "repo");
    spawnSync("git", ["init", "-q", repo]);
    spawnSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:xtrm-dev/pi-probe.git"]);
    spawnSync(process.execPath, [CLI, "init", "--db", dbPath], { cwd: repo });
    const configPath = join(dir, "substrate.json");
    writeFileSync(
      configPath,
      JSON.stringify({ remote: "ssh:probe", remoteSb: "/nonexistent/sb", serverVersion: "0.2.5", checkouts: {} }),
    );
    const shimDir = join(dir, "bin");
    spawnSync("mkdir", ["-p", shimDir]);
    return { dir, dbPath, configPath, shimDir };
  }

  it("resolves an issue on a configured remote instead of the local store", async () => {
    const fixture = remoteFixture();
    // The shim stands in for ssh: it serves the scratch store with the shipped CLI,
    // so the handler exercises the real client, frames and handshake.
    const shim = join(fixture.shimDir, "ssh");
    writeFileSync(shim, `#!/bin/sh\nexec ${process.execPath} ${CLI} serve --stdio --db ${fixture.dbPath}\n`);
    chmodSync(shim, 0o755);
    const seed = openSubstrate(fixture.dbPath);
    const issues = new IssueService(seed);
    issues.createProject({ id: "prj_probe", prefix: "PROBE", name: "probe" });
    const issue = issues.createIssue({
      projectId: "prj_probe",
      title: "on the server",
      kind: "task",
      contract: contract(),
      scrutiny: "LOW",
      authoredBy: "test",
    });
    seed.close();

    const backing = openBacking({
      env: {
        ...process.env,
        PATH: `${fixture.shimDir}:${process.env["PATH"] ?? ""}`,
        SUBSTRATE_REMOTE_CONFIG: fixture.configPath,
        SUBSTRATE_DB: undefined,
        SUBSTRATE_LOCAL_DB: undefined,
      },
    });
    try {
      assert.equal(backing.kind, "remote");
      const got = await toolIssueGet(backing, { ref: issue.id });
      assert.equal(got["title"], "on the server");
      assert.equal(got["humanRef"], "PROBE-1");
    } finally {
      await backing.close();
    }
  });

  it("fails closed when the configured remote is unreachable, never reading the local store", async () => {
    const fixture = remoteFixture();
    const shim = join(fixture.shimDir, "ssh");
    writeFileSync(shim, '#!/bin/sh\nprintf "ssh: connect to host probe port 22: Connection refused\\n" >&2\nexit 255\n');
    chmodSync(shim, 0o755);
    const backing = openBacking({
      env: {
        ...process.env,
        PATH: `${fixture.shimDir}:${process.env["PATH"] ?? ""}`,
        SUBSTRATE_REMOTE_CONFIG: fixture.configPath,
        SUBSTRATE_DB: undefined,
        SUBSTRATE_LOCAL_DB: undefined,
      },
    });
    try {
      await assert.rejects(toolIssueGet(backing, { ref: "PROBE-1" }), (error: Error & { code?: string }) => {
        assert.equal(error.code, "connection_lost", "the transport's own code, not a local answer");
        return true;
      });
    } finally {
      await backing.close();
    }
  });
});
