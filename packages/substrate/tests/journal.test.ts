// Acceptance D22-D25 + D29 (PRD §49D, Phase 5 bead xtrm-7wc.6):
// mechanical-first ordering, summarizer-failure resumability,
// killed-mid-summarization recovery, cursor correctness, capsule
// reconstruction, root aggregation without transcript copying.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { runCli } from "../cli/sb.ts";
import { contract, setup, tempDir } from "./helpers.ts";

function services(ctx: ReturnType<typeof setup>) {
  const journal = new JournalService(ctx.db, ctx.svc);
  const resume = new ResumeService(ctx.db, ctx.svc, journal);
  return { journal, resume };
}

function workIssue(ctx: ReturnType<typeof setup>, title = "work") {
  return ctx.svc.createIssue({
    projectId: "prj_xtrm",
    title,
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
}

const SEMANTIC = {
  summary: "first slice done",
  completed: ["scaffold"],
  current: "wiring resumability",
  next: ["aggregation"],
};

describe("journal checkpoints (D22, D23 + recovery)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("D22: mechanical checkpoint is durable before semantic summarization starts", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    let observed: string | null = null;
    const result = await journal.checkpoint(issue.id, {
      participantId: "pi-session-1",
      summarizer: (persisted) => {
        // The summarizer observes already-committed state: proof of ordering.
        const latest = journal.latestCheckpoint(issue.id);
        const delta = journal.since(issue.id, persisted.sequence - 1);
        observed = latest?.id ?? null;
        assert.equal(latest?.id, persisted.id, "mechanical row must be readable inside the summarizer");
        assert.ok(delta.entries.some((e) => e.id === persisted.id), "mechanical row must be cursor-visible inside the summarizer");
        assert.equal(persisted.mechanical?.participantId, "pi-session-1");
        return { ...SEMANTIC };
      },
    });
    assert.equal(result.degraded, false);
    assert.equal(observed, result.entry.id);
    assert.ok(result.entry.semantic, "semantic enrichment applied after the mechanical commit");
    assert.equal(result.entry.mechanical?.cursor, result.entry.sequence, "occupied cursor stamped on the durable row");
  });

  it("D23: summarizer failure still leaves resumable mechanical state", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const result = await journal.checkpoint(issue.id, {
      summarizer: () => {
        throw new Error("model overloaded");
      },
    });
    assert.equal(result.degraded, true);
    assert.match(result.reason ?? "", /overloaded/);
    const latest = journal.latestCheckpoint(issue.id);
    assert.equal(latest?.id, result.entry.id);
    assert.ok(latest?.mechanical, "mechanical state survived the summarizer failure");
    assert.equal(latest?.semantic, null);
    const delta = journal.since(issue.id, 0);
    assert.equal(delta.entries.length, 1, "resumed agent finds the mechanical entry via cursor read");
  });

  it("killed-mid-summarization recovery: reopen finds the mechanical entry and enriches it", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    // Persist step commits; the process "dies" before enrichment runs.
    const mechanical = journal.collectMechanical(issue.id, { sessionId: "sess-9" });
    const persisted = journal.appendEntry(issue.id, { kind: "checkpoint", mechanical });
    const dbPath = join(ctx.dir, "state.db");
    ctx.db.close();
    // Hand the reopened handle to the fixture hook: afterEach closes it.
    ctx.db = openSubstrate(dbPath);
    const { IssueService: IssueService2 } = await import("../src/service/issue-service.ts");
    const svc2 = new IssueService2(ctx.db);
    const journal2 = new JournalService(ctx.db, svc2);
    const recovered = journal2.latestCheckpoint(issue.id);
    assert.equal(recovered?.id, persisted.id, "mechanical checkpoint survives restart");
    assert.equal(recovered?.mechanical?.sessionId, "sess-9");
    const enriched = journal2.enrichEntry(persisted.id, { ...SEMANTIC });
    assert.equal(enriched.semantic?.summary, SEMANTIC.summary, "late enrichment finalizes the recovered entry");
  });

  it("checkpoint/compaction kinds require mechanical state; semantic is validated on read", () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    assert.throws(
      () => journal.appendEntry(issue.id, { kind: "checkpoint" }),
      /requires a mechanical checkpoint/,
    );
    assert.throws(() => journal.appendEntry(issue.id, { kind: "nope" as never }), /unknown journal kind/);
    const entry = journal.appendEntry(issue.id, { kind: "finding", semantic: { ...SEMANTIC } });
    assert.equal(entry.semantic?.summary, SEMANTIC.summary);
    ctx.db.prepare("UPDATE issue_journal SET semantic_json = ? WHERE id = ?").run(JSON.stringify({ summary: "" }), entry.id);
    assert.throws(() => journal.getEntry(entry.id), /fail-closed: invalid semantic checkpoint/);
  });

  it("compaction seam falls back to host default without losing the checkpoint", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const degraded = await journal.compactionCheckpoint(issue.id, {
      summarizer: () => {
        throw new Error("timeout");
      },
    });
    assert.equal(degraded.degraded, true);
    assert.equal(degraded.fallbackToDefault, true);
    assert.ok(degraded.entry?.mechanical, "durable checkpoint intact beside the fallback");
    const writeFailure = await journal.compactionCheckpoint("iss_missing", {});
    assert.equal(writeFailure.entry, null);
    assert.equal(writeFailure.fallbackToDefault, true);
  });
});

describe("journal identity survives every read path (XTRM-410)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("flat identity stored on the row is projected by getEntry/listEntries/since/timeline/latest", () => {
    // The bare-row assertions require no ambient context: scrub the ephemeral
    // identity env so a launcher-exported session cannot be derived here.
    const savedEnv: Record<string, string | undefined> = {};
    for (const key of ["XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"] as const) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    try {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const appended = journal.appendEntry(issue.id, {
      kind: "finding",
      participantId: "specialist::executor",
      activationId: "act:410",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7410",
      runId: "run-410",
      semantic: { ...SEMANTIC },
    });
    const bare = journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "plain" } });
    for (const e of [
      journal.getEntry(appended.id),
      journal.listEntries(issue.id)[0]!,
      journal.since(issue.id, 0).entries[0]!,
      journal.timeline(issue.id)[0]!,
      journal.latest(issue.id, { kind: "finding" })!,
    ]) {
      assert.equal(e.participantId, "specialist::executor");
      assert.equal(e.activationId, "act:410");
      assert.equal(e.sessionId, "01a0ac95-8370-74c5-9081-4490653e7410");
      assert.equal(e.runId, "run-410");
    }
    for (const e of [journal.getEntry(bare.id), journal.latest(issue.id)!]) {
      assert.equal(e.participantId, null);
      assert.equal(e.activationId, null);
      assert.equal(e.sessionId, null);
      assert.equal(e.runId, null);
    }
    } finally {
      for (const key of ["XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"] as const) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    }
  });
});

describe("journal cursors (D24)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("since returns only entries after the supplied cursor", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const first = await journal.checkpoint(issue.id, {});
    journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "f1" } });
    journal.appendEntry(issue.id, { kind: "decision", semantic: { summary: "d1" } });
    const all = journal.since(issue.id, 0);
    assert.equal(all.entries.length, 3);
    assert.equal(all.nextCursor, 3);
    const afterFirst = journal.since(issue.id, first.entry.sequence);
    assert.deepEqual(afterFirst.entries.map((e) => e.sequence), [2, 3]);
    assert.equal(afterFirst.nextCursor, 3);
    const empty = journal.since(issue.id, 3);
    assert.equal(empty.entries.length, 0);
    assert.equal(empty.nextCursor, 3);
    assert.throws(() => journal.since(issue.id, -1), /cursor must be a non-negative integer/);
    assert.throws(() => journal.since(issue.id, 1.5), /cursor must be a non-negative integer/);
  });

  it("before pages backwards and still returns entries in chronological order", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    for (let i = 1; i <= 5; i += 1) {
      journal.appendEntry(issue.id, { kind: i % 2 === 0 ? "finding" : "decision", semantic: { summary: `e${i}` } });
    }
    // The window ends below the cursor: entries 1-2 of a journal that holds 5.
    assert.deepEqual(
      journal.listEntries(issue.id, { before: 3, limit: 2 }).map((e) => e.sequence),
      [1, 2],
    );
    // A forward LIMIT would have kept the newest entries out of reach.
    assert.deepEqual(
      journal.listEntries(issue.id, { before: 6, limit: 2 }).map((e) => e.sequence),
      [4, 5],
    );
    // Kind filtering composes with the cursor.
    assert.deepEqual(
      journal.listEntries(issue.id, { before: 6, limit: 2, kind: "decision" }).map((e) => e.sequence),
      [3, 5],
    );
    assert.deepEqual(journal.listEntries(issue.id, { before: 1, limit: 2 }), []);
    assert.throws(() => journal.listEntries(issue.id, { before: 3 }), /a limit is required with before/);
    assert.throws(() => journal.listEntries(issue.id, { before: 0, limit: 1 }), /before must be a positive integer/);
    assert.throws(() => journal.listEntries(issue.id, { before: 1.5, limit: 1 }), /before must be a positive integer/);
  });
});

describe("resume capsules (D25, D29)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("D25: capsule reconstructs current contract + latest checkpoint + deltas", async () => {
    const { journal, resume } = services(ctx);
    const issue = workIssue(ctx);
    const cp = await journal.checkpoint(issue.id, { summarizer: () => ({ ...SEMANTIC }) });
    ctx.svc.updateContract(issue.id, contract({ problem: "P v2" }), "tester");
    journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "post-checkpoint finding" } });
    const capsule = resume.buildCapsule(issue.id);
    assert.equal((capsule.contract as { problem: string }).problem, "P v2", "capsule carries the current contract");
    assert.equal(capsule.revision, 2);
    assert.equal(capsule.latestCheckpoint?.id, cp.entry.id);
    assert.equal(capsule.delta.afterSequence, cp.entry.sequence);
    assert.equal(capsule.delta.entries.length, 1);
    assert.equal(capsule.delta.entries[0]?.kind, "finding");
    const text = resume.renderCapsule(capsule);
    assert.match(text, /ISSUE XTRM-1/);
    assert.match(text, /LATEST CHECKPOINT/);
    assert.match(text, /CHANGES SINCE CHECKPOINT/);
    assert.match(text, /SUMMARY[\s\S]*first slice done/);
  });

  it("D29: root resume summarizes children by reference without copying transcripts", async () => {
    const { journal, resume } = services(ctx);
    const epic = ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: "programme",
      kind: "epic",
      contract: contract(),
      scrutiny: "LOW",
      authoredBy: "tester",
    });
    const markerA = "CHILD-TRANSCRIPT-BLUEBERRY-41";
    const markerB = "CHILD-TRANSCRIPT-BLUEBERRY-42";
    for (const [title, marker] of [["child a", markerA], ["child b", markerB]] as const) {
      const child = ctx.svc.createIssue({
        projectId: "prj_xtrm",
        title,
        kind: "task",
        contract: contract(),
        scrutiny: "LOW",
        parentId: epic.id,
        authoredBy: "tester",
      });
      await journal.checkpoint(child.id, {
        summarizer: () => ({ summary: `child work with ${marker} verbatim transcript detail` }),
      });
    }
    await journal.checkpoint(epic.id, { summarizer: () => ({ summary: "root coordination state" }) });
    const capsule = resume.buildCapsule(epic.id);
    assert.equal(capsule.children.length, 2, "both children summarized");
    for (const ch of capsule.children) {
      assert.ok(ch.checkpointRef, "child carries a checkpoint reference");
      assert.ok(ch.locator && ch.lifecycleState, "child carries a live projection");
    }
    const text = resume.renderCapsule(capsule);
    assert.ok(!text.includes(markerA) && !text.includes(markerB), "no child transcript leaks into the root capsule");
    assert.match(text, /CHILDREN/);
    const json = JSON.stringify(capsule);
    assert.ok(!json.includes(markerA) && !json.includes(markerB), "capsule JSON holds references, never child bodies");
  });
});

describe("sb journal verbs + issue resume", () => {
  it("append/checkpoint/show/since/render/resume round-trip through the CLI", () => {
    const dir = tempDir("sb-journal-");
    const dbPath = join(dir, "state.db");
    // runCli opens the DB per invocation, so seed with one short-lived handle.
    const seed = openSubstrate(dbPath);
    new IssueService(seed).createProject({ id: "prj_demo", prefix: "DEMO", name: "journal cli" });
    seed.close();
    const cli = (argv: string[]): unknown => {
      const res = runCli(["--db", dbPath, "--json", ...argv]);
      assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
      const env = JSON.parse(res.stdout) as { ok: boolean; data: unknown };
      assert.equal(env.ok, true);
      return env.data;
    };
    try {
      const c1 = join(dir, "c1.json");
      writeFileSync(c1, JSON.stringify(contract({ problem: "CLI journal", success: "verbs work" })));
      const created = cli(["issue", "create", "--project", "prj_demo", "--title", "J", "--kind", "task", "--contract", c1, "--scrutiny", "LOW"]) as {
        humanRef: string;
      };
      const appended = cli(["journal", "append", created.humanRef, "--kind", "finding", "--semantic", '{"summary":"finding recorded to prove the cli append round trip"}', "--project", "prj_demo"]) as {
        sequence: number; kind: string;
      };
      assert.equal(appended.sequence, 1);
      assert.equal(appended.kind, "finding");
      const semFile = join(dir, "sem.json");
      writeFileSync(semFile, JSON.stringify({ summary: "cli checkpoint" }));
      const cp = cli(["journal", "checkpoint", created.humanRef, "--semantic", semFile, "--project", "prj_demo"]) as {
        sequence: number; degraded: boolean;
      };
      assert.equal(cp.sequence, 2);
      assert.equal(cp.degraded, false);
      const shown = cli(["journal", "show", created.humanRef]) as Array<{ sequence: number }>;
      assert.equal(shown.length, 2);
      const tail = cli(["journal", "show", created.humanRef, "--tail", "1"]) as Array<{ sequence: number }>;
      assert.deepEqual(tail.map((e) => e.sequence), [2]);
      const before = cli(["journal", "show", created.humanRef, "--before", "2", "--limit", "1"]) as Array<{ sequence: number }>;
      assert.deepEqual(before.map((e) => e.sequence), [1]);
      assert.throws(() => cli(["journal", "show", created.humanRef, "--tail", "1", "--limit", "1"]), /cannot be combined/);
      const delta = cli(["journal", "since", created.humanRef, "1"]) as {
        nextCursor: number; entries: Array<{ sequence: number }>;
      };
      assert.equal(delta.nextCursor, 2);
      assert.deepEqual(delta.entries.map((e) => e.sequence), [2]);
      const rendered = cli(["journal", "render", created.humanRef]) as { sequence: number; text: string };
      assert.equal(rendered.sequence, 2);
      assert.match(rendered.text, /cli checkpoint/);
      const badSem = join(dir, "bad.json");
      writeFileSync(badSem, JSON.stringify({ summary: "" }));
      const degraded = cli(["journal", "checkpoint", created.humanRef, "--semantic", badSem, "--project", "prj_demo"]) as {
        degraded: boolean; reason: string;
      };
      assert.equal(degraded.degraded, true);
      assert.ok(degraded.reason);
      const capsule = cli(["issue", "resume", created.humanRef]) as {
        humanRef: string; latestCheckpoint: { sequence: number } | null;
      };
      assert.equal(capsule.humanRef, "DEMO-1");
      assert.ok(capsule.latestCheckpoint, "resume names the latest checkpoint");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("XTRM-410 / XTRM-412 / XTRM-417: journal identity is captured and read back", () => {
  const SESSION = "01a0ac95-8370-74c5-9081-4490653e7e92";
  const EPHEMERAL_ENV = ["XTRM_SESSION_ID", "XTRM_SESSION_NAME", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID"] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of EPHEMERAL_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of EPHEMERAL_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("derives identity from the current execution context, and never inherits it", () => {
    const ctx = setup();
    try {
      const issue = workIssue(ctx);
      const { journal } = services(ctx);
      process.env["XTRM_SESSION_ID"] = SESSION;
      process.env["SUBSTRATE_HOLDER"] = "specialist::executor";
      process.env["SUBSTRATE_ACTIVATION_ID"] = "act:23b2212a-c44";
      const attributed = journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "inside a session" } });
      assert.equal(attributed.participantId, "specialist::executor");
      assert.equal(attributed.sessionId, SESSION);
      assert.equal(attributed.activationId, "act:23b2212a-c44");
      delete process.env["XTRM_SESSION_ID"];
      delete process.env["SUBSTRATE_HOLDER"];
      delete process.env["SUBSTRATE_ACTIVATION_ID"];
      const bare = journal.appendEntry(issue.id, { kind: "decision", semantic: { summary: "outside any session" } });
      assert.equal(bare.participantId, null);
      assert.equal(bare.sessionId, null);
      assert.equal(bare.activationId, null);
      assert.equal(journal.getEntry(bare.id).participantId, null, "a previous entry's identity is never inherited");
      assert.equal(journal.getEntry(bare.id).sessionId, null);
    } finally {
      ctx.db.close();
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });

  it("accepts a tmux session id as --session and stores the row", () => {
    const ctx = setup();
    const dbPath = join(ctx.dir, "state.db");
    try {
      const issue = workIssue(ctx, "gate work");
      // $N is the launcher-surfaced tmux session id, a legitimate session form.
      const res = runCli([
        "--db", dbPath, "journal", "append", issue.humanRef,
        "--kind", "note", "--semantic", '{"summary":"note recorded to prove tmux session ids are accepted"}', "--session", "$2", "--project", "prj_xtrm",
      ]);
      assert.equal(res.code, 0, `the write is accepted: ${res.stderr}`);
      const journal = new JournalService(ctx.db, ctx.svc);
      const rows = journal.listEntries(issue.id);
      assert.equal(rows.length, 1, "the row is stored");
      assert.equal(rows[0]?.sessionId, "$2");
    } finally {
      ctx.db.close();
      rmSync(ctx.dir, { recursive: true, force: true });
    }
  });
});
