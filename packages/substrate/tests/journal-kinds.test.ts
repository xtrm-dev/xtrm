// XTRM-252.5 (J1): Journal kinds, identity, CLI, resume and the runtime half
// of ADR §51-55. One file for the acceptance clauses a-f so the whole Journal
// contract is provable from a single read.
//
// ADR references are to docs/substrate/sbcloseout4-adr.md.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { JournalService, DEFAULT_CONTEXT_LIMIT } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { JOURNAL_KINDS, validateResultPayload } from "../src/domain/journal.ts";
import { XTRM_SESSION_ID_ENV, XTRM_SESSION_NAME_ENV } from "../src/domain/execution-context.ts";
import { runCli } from "../cli/sb.ts";
import { contract, setup } from "./helpers.ts";

function services(ctx: ReturnType<typeof setup>) {
  const journal = new JournalService(ctx.db, ctx.svc);
  const resume = new ResumeService(ctx.db, ctx.svc, journal);
  return { journal, resume };
}

function workIssue(ctx: ReturnType<typeof setup>, title = "work", parentId?: string) {
  return ctx.svc.createIssue({
    projectId: "prj_xtrm",
    title,
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
    parentId,
  });
}

// ---- VALIDATION a: kind completeness --------------------------------------

describe("Journal kind vocabulary (ADR §22)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("a: the bounded nine-kind vocabulary is complete and enforced", () => {
    assert.equal(JOURNAL_KINDS.length, 9, "exactly nine canonical kinds");
    for (const kind of ["note", "finding", "decision", "blocker", "milestone", "handoff", "result", "checkpoint", "compaction"]) {
      assert.ok((JOURNAL_KINDS as readonly string[]).includes(kind), `missing kind ${kind}`);
    }
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    assert.throws(() => journal.appendEntry(issue.id, { kind: "transcript" as never }), /unknown journal kind/);
    // A result is only legal with a bounded payload, and a non-result kind
    // never carries one.
    assert.throws(() => journal.appendEntry(issue.id, { kind: "result" }), /requires a bounded result payload/);
    assert.throws(
      () => journal.appendEntry(issue.id, { kind: "note", result: { summary: "x" } }),
      /does not carry a result payload/,
    );
  });

  it("a: result payload is bounded and rejects an unbounded body (ADR §39)", () => {
    assert.deepEqual(validateResultPayload({ summary: "ok", outcome: "PASS", findings: ["f1"] }), []);
    assert.match(validateResultPayload({ summary: "" })[0] ?? "", /summary must be a non-empty string/);
    // Unknown keys are the smuggling path for raw model output: reject them.
    assert.match(validateResultPayload({ summary: "ok", rawOutput: "x".repeat(10) })[0] ?? "", /not a bounded result field/);
    assert.match(validateResultPayload({ summary: "x".repeat(5000) })[0] ?? "", /at most 4000/);
    assert.match(
      validateResultPayload({ summary: "ok", findings: Array.from({ length: 101 }, () => "f") })[0] ?? "",
      /at most 100 items/,
    );
    // Zero Git commits: a result is legal without any commit.
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const entry = journal.appendEntry(issue.id, { kind: "result", result: { summary: "non-code outcome", outcome: "PASS_WITH_NOTES" } });
    assert.equal(entry.result?.outcome, "PASS_WITH_NOTES");
    assert.equal(ctx.svc.getIssue(issue.id).lifecycleState, "open", "a result does not close the issue");
  });

  it("a+b: CLI accepts `journal append --kind note` and `issue note --kind result`", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-jk-"));
    const dbPath = join(dir, "state.db");
    const seed = openSubstrate(dbPath);
    new IssueService(seed).createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
    seed.close();
    const cli = (argv: string[]): unknown => {
      const res = runCli(["--db", dbPath, "--json", ...argv]);
      assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
      return (JSON.parse(res.stdout) as { data: unknown }).data;
    };
    try {
      const c = join(dir, "c.json");
      writeFileSync(c, JSON.stringify(contract()));
      const created = cli(["issue", "create", "--project", "prj_xtrm", "--title", "K", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as {
        humanRef: string;
      };
      const note = cli(["journal", "append", created.humanRef, "--kind", "note", "--project", "prj_xtrm"]) as { kind: string };
      assert.equal(note.kind, "note");
      const result = cli(["issue", "note", created.humanRef, "specialist finished", "--kind", "result", "--project", "prj_xtrm"]) as {
        kind: string;
        sequence: number;
      };
      assert.equal(result.kind, "result");
      assert.equal(result.sequence, 2);
      const shown = cli(["journal", "show", created.humanRef]) as Array<{ kind: string; result: { summary: string; outcome: string | null } | null }>;
      const resultRow = shown.find((e) => e.kind === "result");
      assert.equal(resultRow?.result?.summary, "specialist finished", "note text becomes result.summary");
      const bad = runCli(["--db", dbPath, "--json", "issue", "note", created.humanRef, "x", "--kind", "transcript", "--project", "prj_xtrm"]);
      assert.equal(bad.code, 1);
      assert.match((JSON.parse(bad.stdout) as { error?: string }).error ?? "", /unknown note kind/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- VALIDATION b: identity and ordering ----------------------------------

describe("Journal identity and ordering (ADR §32)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("b: entry id is immutable, sequence is monotonic per issue, revision is pinned at append time", () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const first = journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "f1" } });
    assert.equal(first.issueRevision, 1);
    assert.match(first.id, /^jrn_/);
    // A later contract revision must not rewrite an earlier entry.
    ctx.svc.updateContract(issue.id, contract({ problem: "P2" }), "tester");
    const second = journal.appendEntry(issue.id, { kind: "decision", semantic: { summary: "d1" } });
    const third = journal.appendEntry(issue.id, { kind: "milestone", semantic: { summary: "m1" } });
    assert.deepEqual([first.sequence, second.sequence, third.sequence], [1, 2, 3], "sequence is monotonic per issue");
    assert.equal(second.issueRevision, 2, "revision pinned at append time");
    assert.equal(ctx.svc.getIssue(issue.id).currentRevision, 2);
    assert.equal(journal.getEntry(first.id).issueRevision, 1, "earlier entry keeps its pinned revision");
    assert.equal(new Set([first.id, second.id, third.id]).size, 3, "ids are unique");
    // A second issue restarts its own sequence space.
    const other = workIssue(ctx, "other");
    assert.equal(journal.appendEntry(other.id, { kind: "note", semantic: { summary: "n" } }).sequence, 1);
    // No CHECK constraint on kind today: an unknown row persists, so a new
    // kind is readable-compatible at the storage layer...
    ctx.db
      .prepare(
        "INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, kind, refs_json, created_at) VALUES (?, ?, 2, 4, 'future_kind', '[]', ?)",
      )
      .run("jrn_future", issue.id, Date.now());
    const raw = ctx.db.prepare("SELECT kind FROM issue_journal WHERE id = 'jrn_future'").get() as { kind: string };
    assert.equal(raw.kind, "future_kind", "no CHECK constraint on kind");
    // ...but a reader that does not know the kind fails closed.
    assert.throws(() => journal.listEntries(issue.id), /fail-closed: corrupt journal kind/);
  });
});

// ---- XTRM-410: reads project the stored execution identity -----------------
// `issue_journal` stores participant/session/activation/run identity on
// every row it can; every read path must project it instead of dropping it.
// The --json payload is extended additively: existing keys keep working.

describe("Journal identity projection to reads (XTRM-410)", () => {
  type Shown = {
    id: string;
    sequence: number;
    kind: string;
    issueRevision: number;
    hasMechanical: boolean;
    hasSemantic: boolean;
    createdAt: number;
    participantId: string | null;
    activationId: string | null;
    sessionId: string | null;
    runId: string | null;
    executionContext: { participantId?: string | null } | null;
    semantic: { summary: string } | null;
    mechanical: unknown;
    result: unknown;
  };

  function scrubSessionEnv(): () => void {
    // Hermetic identity: ambient session env must not rewrite --session.
    const savedId = process.env[XTRM_SESSION_ID_ENV];
    const savedName = process.env[XTRM_SESSION_NAME_ENV];
    delete process.env[XTRM_SESSION_ID_ENV];
    delete process.env[XTRM_SESSION_NAME_ENV];
    return () => {
      if (savedId === undefined) delete process.env[XTRM_SESSION_ID_ENV];
      else process.env[XTRM_SESSION_ID_ENV] = savedId;
      if (savedName === undefined) delete process.env[XTRM_SESSION_NAME_ENV];
      else process.env[XTRM_SESSION_NAME_ENV] = savedName;
    };
  }

  function seedDb(): { dir: string; dbPath: string; cli: (argv: string[]) => unknown } {
    const dir = mkdtempSync(join(tmpdir(), "sb-j410-"));
    const dbPath = join(dir, "state.db");
    const seed = openSubstrate(dbPath);
    new IssueService(seed).createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
    seed.close();
    const cli = (argv: string[]): unknown => {
      const res = runCli(["--db", dbPath, "--json", ...argv]);
      assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
      return (JSON.parse(res.stdout) as { data: unknown }).data;
    };
    return { dir, dbPath, cli };
  }

  function createIssue(cli: (argv: string[]) => unknown, dir: string): string {
    const c = join(dir, "c.json");
    writeFileSync(c, JSON.stringify(contract()));
    const created = cli(["issue", "create", "--project", "prj_xtrm", "--title", "I", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as {
      humanRef: string;
    };
    return created.humanRef;
  }

  it("show/latest/timeline JSON carry the stored identity; human show names the actor or says none", () => {
    const { dir, dbPath, cli } = seedDb();
    const restoreEnv = scrubSessionEnv();
    try {
      const ref = createIssue(cli, dir);
      cli([
        "journal", "append", ref, "--kind", "finding", "--project", "prj_xtrm",
        "--participant", "specialist::executor", "--activation", "act:410", "--session", "sess-410", "--run", "run-410",
        "--semantic", JSON.stringify({ summary: "identity-bearing finding" }),
      ]);
      // Identity-less row: `issue note` carries no identity flags.
      cli(["issue", "note", ref, "plain note", "--project", "prj_xtrm"]);

      const shown = cli(["journal", "show", ref]) as Shown[];
      assert.equal(shown.length, 2);
      const bearing = shown.find((e) => e.sequence === 1);
      assert.equal(bearing?.participantId, "specialist::executor");
      assert.equal(bearing?.activationId, "act:410");
      assert.equal(bearing?.sessionId, "sess-410");
      assert.equal(bearing?.runId, "run-410");
      assert.equal(bearing?.executionContext?.participantId, "specialist::executor");
      // Compatibility surface: existing fields keep working.
      assert.equal(bearing?.kind, "finding");
      assert.equal(bearing?.semantic?.summary, "identity-bearing finding");
      assert.equal(typeof bearing?.createdAt, "number");
      const bare = shown.find((e) => e.sequence === 2);
      assert.equal(bare?.participantId, null);
      assert.equal(bare?.activationId, null);
      assert.equal(bare?.sessionId, null);
      assert.equal(bare?.runId, null);
      assert.equal(bare?.executionContext, null);

      // latest/timeline share the summary projection.
      const latest = cli(["journal", "latest", ref]) as Shown;
      assert.equal(latest.participantId, null, "latest reads the bare note");
      const timeline = cli(["journal", "timeline", ref]) as { count: number; entries: Shown[] };
      assert.equal(timeline.entries[0]?.participantId, "specialist::executor");

      // Human show names the actor, and marks the absent one explicitly.
      const human = runCli(["--db", dbPath, "journal", "show", ref]);
      assert.equal(human.code, 0, human.stderr);
      assert.ok(human.stdout.includes("· by specialist::executor"), "header names the actor");
      assert.ok(human.stdout.includes("session sess-410"), "body exposes the session");
      assert.ok(human.stdout.includes("activation act:410"), "body exposes the activation");
      assert.ok(human.stdout.includes("actor: (none recorded)"), "identity-less row is explicitly absent");
    } finally {
      restoreEnv();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the projected identity agrees with provenance trace for the same row", () => {
    const { dir, cli } = seedDb();
    const restoreEnv = scrubSessionEnv();
    try {
      const ref = createIssue(cli, dir);
      cli(["journal", "checkpoint", ref, "--project", "prj_xtrm", "--participant", "specialist::executor", "--session", "sess-410"]);
      const trace = cli(["provenance", "trace", ref]) as {
        checkpoints: Array<{ entryId: string; sequence: number }>;
      };
      assert.equal(trace.checkpoints.length, 1);
      const shown = cli(["journal", "show", ref]) as Shown[];
      const same = shown.find((e) => e.sequence === trace.checkpoints[0]?.sequence);
      assert.equal(same?.id, trace.checkpoints[0]?.entryId, "same row in both reads");
      assert.equal(same?.participantId, "specialist::executor");
      assert.equal(same?.sessionId, "sess-410");
    } finally {
      restoreEnv();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- VALIDATION c: note stdin and file ------------------------------------

describe("sb issue note file surfaces (ADR §48)", () => {
  it("c: --file <path> and --file - (stdin) both append bounded notes", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-note-"));
    const dbPath = join(dir, "state.db");
    const seed = openSubstrate(dbPath);
    new IssueService(seed).createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
    seed.close();
    const SB = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "sb.ts");
    const cli = (argv: string[]): unknown => {
      const res = runCli(["--db", dbPath, "--json", ...argv]);
      assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
      return (JSON.parse(res.stdout) as { data: unknown }).data;
    };
    try {
      const c = join(dir, "c.json");
      writeFileSync(c, JSON.stringify(contract()));
      const created = cli(["issue", "create", "--project", "prj_xtrm", "--title", "N", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as {
        humanRef: string;
      };
      const noteFile = join(dir, "note.txt");
      writeFileSync(noteFile, "finding from a file");
      cli(["issue", "note", created.humanRef, "--file", noteFile, "--project", "prj_xtrm"]);
      // Real stdin path: spawn the CLI with fd 0 piped (readFileSync(0)).
      const out = execFileSync(
        process.execPath,
        [SB, "--db", dbPath, "--json", "issue", "note", created.humanRef, "--file", "-", "--project", "prj_xtrm"],
        { encoding: "utf8", input: "note from stdin", env: { ...process.env, SUBSTRATE_DB: dbPath, SUBSTRATE_PROJECT: "prj_xtrm" } },
      );
      assert.ok(JSON.parse(out), "stdin note returned JSON");
      const shown = cli(["journal", "show", created.humanRef]) as Array<{ kind: string; semantic: { summary: string } }>;
      assert.deepEqual(shown.map((e) => e.semantic.summary), ["finding from a file", "note from stdin"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- VALIDATION d: ADR §92 three-session acceptance ------------------------

describe("ADR §92 three-session acceptance", () => {
  it("d: session C reconstructs the whole lineage without old transcripts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-adr92-"));
    const dbPath = join(dir, "state.db");
    let db = openSubstrate(dbPath);
    try {
      let svc = new IssueService(db);
      svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
      // Session A: claim, finding, decision, milestone, checkpoint, end.
      const issue = svc.createIssue({
        projectId: "prj_xtrm",
        title: "adr92",
        kind: "task",
        contract: contract({ problem: "P-adr92", success: "S-adr92" }),
        scrutiny: "LOW",
        authoredBy: "tester",
      });
      svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
      const claim = svc.claimIssue(issue.id, "session-a");
      const journal = new JournalService(db, svc);
      journal.appendEntry(issue.id, { kind: "finding", participantId: "session-a", semantic: { summary: "material finding A" } });
      journal.appendEntry(issue.id, {
        kind: "decision",
        participantId: "session-a",
        semantic: { summary: "use the official SDK" },
      });
      journal.appendEntry(issue.id, { kind: "milestone", participantId: "session-a", semantic: { summary: "implementation complete" } });
      const cpA = await journal.checkpoint(issue.id, {
        participantId: "session-a",
        summarizer: () => ({ summary: "session A baseline", next: ["dispatch specialist"] }),
      });
      svc.releaseClaim(issue.id, "session-a");
      assert.equal(claim.holder, "session-a");

      // Session B: resume -> dispatch -> automatic result -> validate -> receipt -> close.
      const journalB = new JournalService(db, svc);
      const resumeB = new ResumeService(db, svc, journalB);
      const capsuleB = resumeB.buildCapsule(issue.id);
      assert.equal((capsuleB.contract as { problem: string }).problem, "P-adr92", "capsule carries the authorized contract");
      assert.equal(capsuleB.latestCheckpoint?.id, cpA.entry.id);
      const provenance = new ProvenanceService(db, svc, journalB);
      const binding = provenance.dispatch(issue.id, {
        workspace: "/tmp/specialist-ws",
        participantId: "specialist-1",
        activationId: "act-1",
        sessionId: "01a0ac95-8370-74c5-9081-4490653e7e93",
      });
      // Automatic result publication: bounded, zero commits.
      journalB.appendEntry(issue.id, {
        kind: "result",
        participantId: "specialist-1",
        activationId: "act-1",
        sessionId: "01a0ac95-8370-74c5-9081-4490653e7e93",
        result: {
          summary: "reviewed the adapter; one note",
          outcome: "PASS_WITH_NOTES",
          attempted: "adapter review",
          validation: ["pnpm test"],
          findings: ["retry lineage incomplete"],
        },
      });
      const receipt = provenance.allocateReceipt(binding.id, {
        journalCheckpointId: cpA.entry.id,
        validationRefs: [{ kind: "validation", value: "pnpm test" }],
      });
      svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "validator-1" });
      svc.setLifecycleState(issue.id, "done");

      // Session C: fresh handles, no transcript. The CLI show projection
      // reconstructs contract, progress, findings, decisions, result,
      // validation, lineage, artifacts and closure state.
      db.close();
      db = openSubstrate(dbPath);
      svc = new IssueService(db);
      const show = runCli(["--db", dbPath, "--json", "issue", "show", issue.humanRef]);
      assert.equal(show.code, 0, show.stderr);
      const payload = (JSON.parse(show.stdout) as { data: Record<string, unknown> }).data;
      const contractOut = payload["contract"] as { problem: string };
      assert.equal(contractOut.problem, "P-adr92", "session C recovers the authorized contract");
      const ctxOut = payload["operationalContext"] as {
        latestByKind: Array<{ kind: string; summary: string | null; outcome: string | null }>;
        countsByKind: Record<string, number>;
        total: number;
      };
      const kinds = ctxOut.latestByKind.map((e) => e.kind);
      for (const k of ["finding", "decision", "milestone", "checkpoint", "result"]) {
        assert.ok(kinds.includes(k), `show recovers latest ${k}`);
      }
      assert.equal(ctxOut.total, 5, "counts include finding, decision, milestone, checkpoint, result");
      const resultRow = ctxOut.latestByKind.find((e) => e.kind === "result");
      assert.equal(resultRow?.outcome, "PASS_WITH_NOTES", "result outcome survives");
      assert.equal((payload["closure"] as { lifecycleState: string }).lifecycleState, "done");
      const journalC = new JournalService(db, svc);
      const resumeC = new ResumeService(db, svc, journalC);
      const capsuleC = resumeC.buildCapsule(issue.id);
      assert.equal(capsuleC.results.length, 1, "capsule recovers the result");
      assert.deepEqual(capsuleC.results[0]?.artifactRefs, []);
      assert.equal(capsuleC.results[0]?.summary, "reviewed the adapter; one note");
      assert.equal(capsuleC.criticalDecisions[0]?.summary, "use the official SDK", "capsule recovers critical decisions");
      const entry = journalC.latest(issue.id, { kind: "result" });
      assert.equal(entry?.sessionId, "01a0ac95-8370-74c5-9081-4490653e7e93", "execution lineage survives");
      assert.equal(entry?.participantId, "specialist-1");
      assert.equal(entry?.activationId, "act-1");
      assert.ok(receipt.id.startsWith("rcp_"), "receipt allocated");
      // The cross-issue no-leak property is asserted where a body actually
      // exists: test e journals CHILD-JOURNAL-BODY-BLUEBERRY markers into
      // children and requires the parent capsule to exclude them. The honest
      // assertion here is boundedness, which fails if a journal body were ever
      // copied into the capsule by value.
      const capsuleSize = JSON.stringify(capsuleC).length;
      assert.ok(capsuleSize > 0 && capsuleSize < 10_000, `session C capsule stays bounded (${capsuleSize} bytes)`);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- VALIDATION e: ADR §93 coordinator acceptance --------------------------

describe("ADR §93 coordinator acceptance", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("e: root capsule recovers child state by reference without copying child journals", async () => {
    const { journal, resume } = services(ctx);
    const epic = ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: "programme",
      kind: "epic",
      contract: contract(),
      scrutiny: "LOW",
      authoredBy: "tester",
    });
    const markerA = "CHILD-JOURNAL-BODY-BLUEBERRY-91";
    const markerB = "CHILD-JOURNAL-BODY-BLUEBERRY-92";
    const childIds: string[] = [];
    for (const [title, marker] of [["child a", markerA], ["child b", markerB]] as const) {
      const child = workIssue(ctx, title, epic.id);
      childIds.push(child.id);
      journal.appendEntry(child.id, { kind: "result", result: { summary: `child result with ${marker} verbatim`, outcome: "PASS" } });
      await journal.checkpoint(child.id, { summarizer: () => ({ summary: `child checkpoint with ${marker} verbatim` }) });
    }
    // One child blocked by an unrelated blocker issue gives release state a
    // blocker to report.
    const blocker = workIssue(ctx, "blocker");
    ctx.svc.addEdge(blocker.id, childIds[1]!, "blocks");
    ctx.svc.addEdge(blocker.id, epic.id, "blocks");
    journal.appendEntry(epic.id, { kind: "decision", semantic: { summary: "programme decision: single adapter" } });
    journal.appendEntry(epic.id, { kind: "result", result: { summary: "coordinator summary", outcome: "PASS" } });
    await journal.checkpoint(epic.id, {
      summarizer: () => ({ summary: "root state" }),
      pendingAsks: ["confirm integration window"],
    });
    ctx.svc.setLifecycleState(childIds[0]!, "done");

    const capsule = resume.buildCapsule(epic.id);
    assert.equal(capsule.children.length, 2);
    for (const ch of capsule.children) {
      assert.ok(ch.checkpointRef, "child checkpoint recovered by reference");
      assert.ok(ch.latestResult?.ref, "child result recovered by reference");
      assert.equal(ch.latestResult?.outcome, "PASS");
    }
    assert.equal(capsule.release.childrenTotal, 2);
    assert.equal(capsule.release.childrenDone, 1, "partial child completion is visible");
    assert.ok(capsule.release.blockers.length >= 1, "blocker state recovered on the root");
    assert.ok(
      capsule.children.some((ch) => ch.blockedBy.includes(blocker.id)),
      "a child's blocker is recovered by reference",
    );
    assert.equal(capsule.criticalDecisions[0]?.summary, "programme decision: single adapter");
    assert.equal(capsule.results[0]?.summary, "coordinator summary");
    assert.deepEqual(capsule.asks, ["confirm integration window"]);

    const text = resume.renderCapsule(capsule);
    assert.match(text, /RESULTS/);
    assert.match(text, /CRITICAL DECISIONS/);
    assert.match(text, /RELEASE/);
    for (const marker of [markerA, markerB]) {
      assert.ok(!text.includes(marker), `coordinator capsule must not copy a child journal body (${marker})`);
      assert.ok(!JSON.stringify(capsule).includes(marker), "capsule JSON holds references, never child bodies");
    }
  });
});

// ---- VALIDATION f: boundary + bounded show --------------------------------

describe("Issue-versus-Journal boundary and bounded show (ADR §54, §50)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("f: a scope-changing journal entry never mutates the contract or revision", () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const beforeRevision = ctx.svc.getIssue(issue.id).currentRevision;
    const beforeHash = ctx.svc.getIssue(issue.id).currentContractHash;
    const beforeContract = ctx.svc.getRevision(issue.id, beforeRevision).contract;
    journal.appendEntry(issue.id, { kind: "decision", semantic: { summary: "SCOPE: also migrate the live store and expand SUCCESS" } });
    const after = ctx.svc.getIssue(issue.id);
    assert.equal(after.currentRevision, beforeRevision, "journal entry never bumps the revision");
    assert.equal(after.currentContractHash, beforeHash, "journal entry never changes the contract hash");
    assert.deepEqual(ctx.svc.getRevision(issue.id, after.currentRevision).contract, beforeContract);
    // Contract authority changes only through updateContract (planning path).
    ctx.svc.updateContract(issue.id, contract({ scope: ["a", "migrate"] }), "planner");
    assert.equal(ctx.svc.getIssue(issue.id).currentRevision, beforeRevision + 1, "planning path bumps the revision");
  });

  it("f: default show stays bounded for a large journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-bound-"));
    const dbPath = join(dir, "state.db");
    try {
      const seed = openSubstrate(dbPath);
      new IssueService(seed).createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
      seed.close();
      const c = join(dir, "c.json");
      writeFileSync(c, JSON.stringify(contract()));
      const create = runCli(["--db", dbPath, "--json", "issue", "create", "--project", "prj_xtrm", "--title", "B", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]);
      const ref = (JSON.parse(create.stdout) as { data: { humanRef: string } }).data.humanRef;

      const sizeOf = (): number => {
        const env = JSON.parse(runCli(["--db", dbPath, "--json", "issue", "show", ref]).stdout) as {
          data: { operationalContext: { recent: unknown[]; latestByKind: unknown[]; total: number } };
        };
        return JSON.stringify(env.data).length;
      };
      const smallSize = sizeOf();
      const db = openSubstrate(dbPath);
      const svc = new IssueService(db);
      const issue = svc.resolveRef(ref);
      const journal = new JournalService(db, svc);
      const long = "x".repeat(3900);
      for (let i = 0; i < 60; i++) {
        journal.appendEntry(issue.id, { kind: "note", semantic: { summary: `${long} ${i}` } });
      }
      db.close();
      const sixtySize = sizeOf();

      const db2 = openSubstrate(dbPath);
      const svc2 = new IssueService(db2);
      const issue2 = svc2.resolveRef(ref);
      const journal2 = new JournalService(db2, svc2);
      for (let i = 0; i < 100; i++) {
        journal2.appendEntry(issue2.id, { kind: "note", semantic: { summary: `${long} extra ${i}` } });
      }
      db2.close();
      const env = JSON.parse(runCli(["--db", dbPath, "--json", "issue", "show", ref]).stdout) as {
        data: { operationalContext: { recent: unknown[]; latestByKind: unknown[]; total: number } };
      };
      const oneSixtySize = sizeOf();
      const oc = env.data.operationalContext;
      assert.equal(oc.total, 160);
      assert.ok(oc.recent.length <= DEFAULT_CONTEXT_LIMIT, `recent is bounded (got ${oc.recent.length})`);
      assert.ok(oc.latestByKind.length <= 9, "latestByKind is bounded by the kind vocabulary");
      assert.ok(smallSize < 20000, `empty journal show is bounded (${smallSize})`);
      assert.ok(Math.abs(oneSixtySize - sixtySize) < 300, `show size does not track journal size (${sixtySize} -> ${oneSixtySize})`);
      const humanShow = runCli(["--db", dbPath, "issue", "show", ref]);
      assert.equal(humanShow.code, 0, humanShow.stderr);
      assert.ok(humanShow.stdout.length < 8000, `human show is bounded (${humanShow.stdout.length})`);
      assert.match(humanShow.stdout, /OPERATIONAL CONTEXT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- CLI latest/timeline + result read fail-closed -------------------------

describe("journal latest/timeline and fail-closed result reads", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("latest/timeline are bounded reads over one JournalService", async () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "f1" } });
    journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "f2" } });
    journal.appendEntry(issue.id, { kind: "decision", semantic: { summary: "d1" } });
    assert.equal(journal.latest(issue.id)?.sequence, 3);
    assert.equal(journal.latest(issue.id, { kind: "finding" })?.sequence, 2);
    assert.equal(journal.latest(issue.id, { kind: "result" }), null);
    assert.deepEqual(journal.timeline(issue.id, { limit: 2 }).map((e) => e.sequence), [2, 3], "newest window in chronological order");
    assert.deepEqual(journal.timeline(issue.id, { kind: "finding" }).map((e) => e.sequence), [1, 2]);
    assert.throws(() => journal.timeline(issue.id, { limit: 0 }), /positive integer/);
  });

  it("a corrupt result row fails closed on read", () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const entry = journal.appendEntry(issue.id, { kind: "result", result: { summary: "ok" } });
    ctx.db.prepare("UPDATE issue_journal SET result_json = ? WHERE id = ?").run(JSON.stringify({ rawOutput: "leak" }), entry.id);
    assert.throws(() => journal.getEntry(entry.id), /fail-closed: invalid result payload/);
    ctx.db.prepare("UPDATE issue_journal SET result_json = ? WHERE id = ?").run("{not json", entry.id);
    assert.throws(() => journal.getEntry(entry.id), /fail-closed: corrupt result payload/);
  });
});
