import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { importBeads } from "../src/compatibility/beads/import.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SB = join(here, "..", "cli", "sb.ts");

const EXPORT_LINES = [
  { _type: "issue", id: "bd-epic", title: "Epic bead", description: "PROBLEM: no board\nSUCCESS: board lands", status: "open", priority: 1, issue_type: "epic", created_by: "human:planner", owner: "human:owner" },
  { _type: "issue", id: "bd-thin", title: "Thin bead", status: "open", priority: 0, issue_type: "task", created_by: "human:dev" },
  { _type: "issue", id: "bd-done", title: "Done bead", description: "PROBLEM: x\nSUCCESS: y\nSCOPE:\n- a", status: "closed", priority: 2, issue_type: "bug" },
  { _type: "memory", key: "k", value: "never imported as work" },
];

const EDGE_BATCH = [
  { issue_id: "bd-thin", depends_on_id: "bd-epic", type: "parent-child", created_at: "", created_by: "", metadata: "{}" },
  { issue_id: "bd-done", depends_on_id: "bd-epic", type: "blocks", created_at: "", created_by: "", metadata: "{}" },
];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-mig-"));
  const dbPath = join(dir, "state.db");
  const exportPath = join(dir, "beads.jsonl");
  writeFileSync(exportPath, EXPORT_LINES.map((l) => JSON.stringify(l)).join("\n"));
  const edgesPath = join(dir, "edges.json");
  writeFileSync(edgesPath, JSON.stringify(EDGE_BATCH));
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_mig", prefix: "MIG", name: "m" });
  db.close();
  return { dir, dbPath, exportPath, edgesPath };
}

function cli(dbPath: string, argv: string[]): unknown {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

type ReceiptV3 = {
  schema: string;
  dryRun: boolean;
  project: string;
  inputs: { records: number; issues: number; memoriesSkipped: number; inlineEdges: number; fileEdges: number };
  result: {
    created: string[]; skippedPresent: string[]; edgeErrors: string[]; unready: string[];
    hierarchyApplied: Array<{ parent: string; child: string }>; hierarchyErrors: string[]; depFailures: string[];
    edgesFromInline: number; edgesFromFile: number;
    notesApplied: string[]; notesSkipped: string[]; commentsApplied: string[]; commentsSkipped: string[];
    closeReasonCarried: string[]; closeReasonMissing: string[];
  };
  counts: { created: number; skipped: number; edgeRowsBefore: number; edgeRowsAfter: number };
  verifier: { checks: Array<{ check: string; ok: boolean }> };
  verdict: string;
};

describe("G44: import is idempotent", () => {
  it("second run skips every alias without mutating", () => {
    const { dbPath, exportPath, edgesPath } = setup();
    const first = cli(dbPath, ["import", "beads", "--file", exportPath, "--edges-file", edgesPath, "--project", "prj_mig"]) as ReceiptV3;
    assert.equal(first.verdict, "PASS");
    assert.deepEqual([...first.result.created].sort(), ["bd-done", "bd-epic", "bd-thin"]);
    assert.deepEqual(first.result.edgeErrors, []);
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    const count = svc.listIssues("prj_mig").length;
    const edgeRows = svc.listActiveEdges().length;
    const doneEvents = svc.listEvents(svc.resolveRef("bd-done").id).length;
    db.close();
    const second = cli(dbPath, ["import", "beads", "--file", exportPath, "--edges-file", edgesPath, "--project", "prj_mig"]) as ReceiptV3;
    assert.equal(second.verdict, "PASS");
    assert.deepEqual(second.result.created, []);
    assert.deepEqual([...second.result.skippedPresent].sort(), ["bd-done", "bd-epic", "bd-thin"]);
    const db2 = openSubstrate(dbPath);
    const svc2 = new IssueService(db2);
    assert.equal(svc2.listIssues("prj_mig").length, count);
    // Check 7: rerun grows neither issues nor edge rows.
    assert.equal(svc2.listActiveEdges().length, edgeRows);
    assert.equal(second.counts.edgeRowsBefore, second.counts.edgeRowsAfter);
    // Skipped rows are never re-touched: no new lifecycle events on rerun.
    assert.equal(svc2.listEvents(svc2.resolveRef("bd-done").id).length, doneEvents);
    db2.close();
  });
});

describe("G45/G46: aliases resolve, thin work lands unready", () => {
  it("beads IDs resolve; nothing imported is dispatchable", () => {
    const { dbPath, exportPath, edgesPath } = setup();
    const receipt = cli(dbPath, ["import", "beads", "--file", exportPath, "--edges-file", edgesPath, "--project", "prj_mig"]) as ReceiptV3;
    assert.equal(receipt.verdict, "PASS");
    assert.ok(receipt.verifier.checks.every((c) => c.ok));
    const result = receipt.result;
    assert.equal(result.unready.length, result.created.length);
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    try {
      for (const bead of ["bd-epic", "bd-thin", "bd-done"]) {
        const resolved = svc.resolveRef(bead);
        assert.ok(resolved.id.startsWith("iss_"));
        assert.equal(svc.getReadiness(resolved.id).dispatchable, false);
      }
      // Hierarchy + lifecycle preserved: thin is a child, done is done.
      const thin = svc.resolveRef("bd-thin");
      assert.equal(svc.getParent(thin.id)?.humanRef, svc.resolveRef("bd-epic").humanRef);
      assert.equal(svc.resolveRef("bd-done").lifecycleState, "done");
      // Blocks edge preserved with live direction (open epic blocks done).
      assert.deepEqual(svc.unsatisfiedBlockers(svc.resolveRef("bd-done").id), [svc.resolveRef("bd-epic").id]);
      // Import provenance recorded on each row.
      const types = svc.listEvents(thin.id).map((e) => e.type);
      assert.ok(types.includes("beads.imported"));
    } finally {
      db.close();
    }
  });
});

describe("G47 regression: export/import preserves revisions + graph", () => {
  it("snapshot round-trip keeps revision count and edge set", () => {
    const { dbPath, exportPath } = setup();
    cli(dbPath, ["import", "beads", "--file", exportPath, "--project", "prj_mig"]);
    const snap = cli(dbPath, ["export", "--project", "prj_mig"]) as {
      issues: Array<{ issue: { id: string }; revisions: unknown[] }>; edges: Array<{ fromIssue: string; toIssue: string; kind: string }>;
    };
    assert.equal(snap.issues.length, 3);
    for (const e of snap.issues) assert.equal((e.revisions as unknown[]).length, 1);
    // Second database rebuilt from the snapshot is graph-equivalent.
    const dir = mkdtempSync(join(tmpdir(), "substrate-mig2-"));
    const db2Path = join(dir, "s.db");
    const db2 = openSubstrate(db2Path);
    const svc2 = new IssueService(db2);
    svc2.importProject(snap as unknown as Record<string, unknown>);
    assert.equal(svc2.listIssues("prj_mig").length, 3);
    assert.deepEqual(
      svc2.listActiveEdges().map((e) => e.kind).sort(),
      snap.edges.filter((e) => e.kind !== "parent_child" || true).map((e) => e.kind).sort(),
    );
    db2.close();
  });
});

describe("G49: the sb workflow needs no bd binary", () => {
  it("full lifecycle succeeds with bd absent from PATH", () => {
    const { dbPath } = setup();
    const cleanEnv = { ...process.env, PATH: "/usr/bin:/bin", SUBSTRATE_DB: dbPath };
    const run = (args: string[]): unknown => {
      const out = execFileSync(process.execPath, [SB, "--json", ...args], { encoding: "utf8", env: cleanEnv });
      const env = JSON.parse(out) as { ok: boolean; data: unknown };
      assert.equal(env.ok, true);
      return env.data;
    };
    const dir = mkdtempSync(join(tmpdir(), "substrate-mig3-"));
    const c = join(dir, "c.json");
    writeFileSync(c, JSON.stringify(contract()));
    const created = run(["issue", "create", "--project", "prj_mig", "--title", "T", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]) as { humanRef: string };
    run(["issue", "close", created.humanRef]);
    const list = run(["issue", "list", "--project", "prj_mig"]) as unknown[];
    assert.ok(list.length >= 1);
  });
});

describe("G45: human-shaped beads IDs resolve as aliases, not dead human refs", () => {
  it("xtrm-401 style ids fall through to alias lookup", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-mig5-"));
    const db = openSubstrate(join(dir, "s.db"));
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_h", prefix: "H", name: "h" });
    try {
      importBeads(svc, "prj_h", [
        { id: "xtrm-401", title: "Looks like a human ref", status: "open", issue_type: "task" },
      ], []);
      // No XTRM project exists here: resolution must reach the alias.
      assert.equal(svc.resolveRef("xtrm-401").humanRef, "H-1");
      const again = importBeads(svc, "prj_h", [
        { id: "xtrm-401", title: "Looks like a human ref", status: "open", issue_type: "task" },
      ], []);
      assert.deepEqual(again.created, []);
      assert.deepEqual(again.skippedPresent, ["xtrm-401"]);
    } finally {
      db.close();
    }
  });
});

describe("A9 receipt parity: dry-run and apply share inputs + envelope", () => {
  it("identical inputs census and envelope keys on both paths", () => {
    const { dbPath, exportPath, edgesPath } = setup();
    const dry = cli(dbPath, ["import", "beads", "--file", exportPath, "--edges-file", edgesPath, "--project", "prj_mig", "--dry-run"]) as ReceiptV3;
    assert.equal(dry.dryRun, true);
    const applied = cli(dbPath, ["import", "beads", "--file", exportPath, "--edges-file", edgesPath, "--project", "prj_mig"]) as ReceiptV3;
    assert.equal(applied.dryRun, false);
    assert.equal(applied.verdict, "PASS");
    assert.deepEqual(applied.inputs, dry.inputs);
    assert.equal(applied.schema, "substrate-import-receipt/v1");
    assert.equal(dry.schema, "substrate-import-receipt/v1");
  });
});

describe("A9 verdict: FAIL exits nonzero with the receipt attached", () => {
  it("unknown edge endpoint fails closed with ok:false + data", () => {
    const { exportPath } = setup();
    const dir = mkdtempSync(join(tmpdir(), "substrate-migf-"));
    const badEdges = join(dir, "bad.json");
    writeFileSync(badEdges, JSON.stringify([{ issue_id: "bd-thin", depends_on_id: "ghost", type: "blocks" }]));
    const dbPath2 = join(dir, "s.db");
    const fail = runCli(["--db", dbPath2, "--json", "import", "beads", "--file", exportPath, "--edges-file", badEdges, "--project", "prj_mig", "--create-project", "MIG:Migration"]);
    assert.equal(fail.code, 1);
    const env = JSON.parse(fail.stdout) as { schema: string; ok: boolean; error: string; data: ReceiptV3 };
    assert.equal(env.schema, SCHEMA_VERSION);
    assert.equal(env.ok, false);
    assert.ok(env.error.includes("FAIL"));
    assert.equal(env.data.verdict, "FAIL");
    assert.equal(env.data.result.edgeErrors.length, 1);
  });
});

describe("A9 intake: inline deps authoritative; notes/comments to journal", () => {
  it("inline dependencies[] apply without --edges-file; history lands in journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-migi-"));
    const dbPath = join(dir, "s.db");
    const exportPath = join(dir, "beads.jsonl");
    const lines = [
      { _type: "issue", id: "w-epic", title: "Epic", description: "PROBLEM: p\nSUCCESS: s", status: "open", priority: 1, issue_type: "epic", created_by: "human:x" },
      {
        _type: "issue", id: "w-task", title: "Task", description: "plain carried text", status: "closed", priority: 0,
        issue_type: "task", created_by: "human:y", notes: "historical note body",
        comments: [{ id: "c1", issue_id: "w-task", author: "human:z", created_at: "2026-01-01", text: "first comment" }],
        close_reason: "shipped", dependencies: [{ issue_id: "w-task", depends_on_id: "w-epic", type: "parent-child" }],
      },
    ];
    writeFileSync(exportPath, lines.map((l) => JSON.stringify(l)).join("\n"));
    const receipt = cli(dbPath, ["import", "beads", "--file", exportPath, "--project", "prj_mig", "--create-project", "MIG:Migration"]) as ReceiptV3;
    assert.equal(receipt.verdict, "PASS");
    assert.equal(receipt.inputs.inlineEdges, 1);
    assert.equal(receipt.result.hierarchyApplied.length, 1);
    assert.equal(receipt.result.notesApplied.length, 1);
    assert.equal(receipt.result.commentsApplied.length, 1);
    assert.equal(receipt.result.closeReasonCarried.length, 1);
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      const taskId = svc.resolveRef("w-task").id;
      assert.equal(svc.getParent(taskId)?.humanRef, svc.resolveRef("w-epic").humanRef);
      assert.equal(svc.resolveRef("w-task").lifecycleState, "done");
      const journal = new JournalService(db, svc);
      const entries = journal.listEntries(taskId, { kind: "note" });
      const keys = entries.flatMap((e) => e.refs.map((r) => r.key));
      assert.ok(keys.includes("beads-note:w-task"));
      assert.ok(keys.includes("beads-comment:c1"));
      const rev = svc.getRevision(taskId, svc.getIssue(taskId).currentRevision);
      const problem = String((rev.contract as { problem: string }).problem);
      assert.ok(!problem.includes("historical note body"));
      assert.ok(!problem.includes("first comment"));
      const second = cli(dbPath, ["import", "beads", "--file", exportPath, "--project", "prj_mig"]) as ReceiptV3;
      assert.equal(second.verdict, "PASS");
      assert.equal(journal.listEntries(taskId, { kind: "note" }).length, entries.length);
      // Bulk notes surface: export-project carries journal so verifiers
      // confirm history survival without per-issue reads (Core #649).
      const snap = cli(dbPath, ["export", "--project", "prj_mig"]) as {
        issues: Array<{ issue: { id: string }; journal: Array<{ kind: string; summary: string | null; refs: Array<{ kind: string; key: string }> }> }>;
      };
      const taskSnap = snap.issues.find((e) => svc.resolveRef("w-task").id === e.issue.id);
      assert.ok(taskSnap);
      const snapKeys = taskSnap!.journal.flatMap((j) => j.refs.map((r) => r.key));
      assert.ok(snapKeys.includes("beads-note:w-task"));
      assert.ok(snapKeys.includes("beads-comment:c1"));
      assert.ok(taskSnap!.journal.some((j) => j.summary === "first comment"));
    } finally {
      db.close();
    }
  });

  it("array-form notes ingest with indexed keys; unhandled shapes count skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-migi-arr-"));
    const dbPath = join(dir, "s.db");
    const exportPath = join(dir, "beads.jsonl");
    const lines = [
      {
        _type: "issue", id: "w-arr", title: "Arr", description: "plain", status: "open",
        issue_type: "task", created_by: "human:y",
        notes: [
          { id: "n1", author: "human:a", created_at: "2026-02-01", text: "first array note" },
          { text: "second array note" },
          { id: "n3" },
        ],
      },
      {
        _type: "issue", id: "w-odd", title: "Odd", description: "plain", status: "open",
        issue_type: "task", created_by: "human:y", notes: 42,
      },
    ];
    writeFileSync(exportPath, lines.map((l) => JSON.stringify(l)).join("\n"));
    const receipt = cli(dbPath, ["import", "beads", "--file", exportPath, "--project", "prj_mig", "--create-project", "MIG:Migration"]) as ReceiptV3;
    assert.equal(receipt.verdict, "PASS");
    assert.equal(receipt.result.notesApplied.length, 1);
    assert.deepEqual(receipt.result.notesSkipped, ["w-odd"]);
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      const journal = new JournalService(db, svc);
      const keys = journal.listEntries(svc.resolveRef("w-arr").id, { kind: "note" })
        .flatMap((e) => e.refs.map((r) => r.key));
      assert.ok(keys.includes("beads-note:w-arr:n1"));
      assert.ok(keys.some((k) => k.startsWith("beads-note:w-arr:index:")));
    } finally {
      db.close();
    }
  });
});

describe("importer unit: section mapping without the CLI", () => {
  it("PROBLEM/SUCCESS sections map; unknown edge endpoints collect errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-mig4-"));
    const db = openSubstrate(join(dir, "s.db"));
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_u", prefix: "U", name: "u" });
    try {
      const r = importBeads(svc, "prj_u", [
        { id: "b1", title: "T1", description: "PROBLEM: p1\nSUCCESS: s1\nSCOPE:\n- x", status: "open", issue_type: "research", created_by: "human:a" },
      ], [{ issue_id: "b1", depends_on_id: "missing", type: "blocks" }]);
      assert.deepEqual(r.created, ["b1"]);
      assert.equal(r.edgeErrors.length, 1);
      const rev = svc.getRevision(svc.resolveRef("b1").id, 1);
      assert.equal((rev.contract as { problem: string }).problem, "p1");
      assert.equal((rev.authoredBy), "human:a");
    } finally {
      db.close();
    }
  });
});
