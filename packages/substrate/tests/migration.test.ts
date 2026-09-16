import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { extractSectionsDetailed, importBeads } from "../src/compatibility/beads/import.ts";
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
    run(["issue", "close", created.humanRef, "--project", "prj_mig"]);
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

// -- XTRM-405: Beads import fidelity -----------------------------------------
// The importer previously recognized labeled `KEY:` headers only, so on real
// markdown exports zero sections were extracted and the whole description fell
// through to `problem`; and every verifier check reconciled the parsed union
// against lists derived from that same union, so a parse-blind export shrank
// both sides equally and still reported PASS.

type FullReceipt = {
  verdict: string;
  counts: {
    created: number;
    skipped: number;
    censusEdges: number;
    accountedEdges: number;
    edgeRowsBefore: number;
    edgeRowsAfter: number;
    unrepresentableEdges: number;
    downgradedEdges: number;
    unresolvedEntries: number;
  };
  result: {
    unrepresentableEdges: Array<{ type: string; from: string; to: string }>;
    downgradedEdges: Array<{ type: string; kind: string }>;
  };
  verifier: { checks: Array<{ check: string; ok: boolean; expected: unknown; actual: unknown }> };
};

const REAL_EXPORT = join(here, "..", "..", "..", ".xtrm", "board-audit", "exports", "export-20260810T174008", "raw-beads.jsonl");

describe("XTRM-405: section extraction handles the real markdown convention", () => {
  it("recognizes ATX headings, prose bodies, hyphenated and combined section names", () => {
    const ex = extractSectionsDetailed(
      [
        "Loose preamble that is not a section.",
        "## PROBLEM",
        "Real prose problem, not a bullet.",
        "Second line of the same paragraph.",
        "## SCOPE (agreed model)",
        "- first boundary",
        "- second boundary",
        "## NON-GOALS",
        "No speculative work.",
        "## VALIDATION",
        "`bun test` is green.",
        "## OUTPUT",
        "A commit.",
        "## REFERENCES",
        "unmapped body content",
      ].join("\n"),
    );
    assert.deepEqual(ex.recognized, ["PROBLEM", "SCOPE", "NON_GOALS", "VALIDATION", "OUTPUT"]);
    // Headings keep their qualifier text out of the section name.
    assert.deepEqual(ex.sections.PROBLEM, ["Real prose problem, not a bullet.\nSecond line of the same paragraph."]);
    assert.deepEqual(ex.sections.SCOPE, ["first boundary", "second boundary"]);
    assert.deepEqual(ex.sections.NON_GOALS, ["No speculative work."]);
    assert.deepEqual(ex.sections.VALIDATION, ["`bun test` is green."]);
    assert.deepEqual(ex.sections.OUTPUT, ["A commit."]);
    // An unmapped heading is reported, never silently absorbed or invented.
    assert.deepEqual(ex.unmapped, [{ heading: "## REFERENCES", lines: 1 }]);
  });

  it("populates both fields for the combined NON_GOALS / CONSTRAINTS heading", () => {
    const ex = extractSectionsDetailed("## NON_GOALS / CONSTRAINTS\n- one rule\n## PROBLEM\np");
    assert.deepEqual(ex.sections.NON_GOALS, ["one rule"]);
    assert.deepEqual(ex.sections.CONSTRAINTS, ["one rule"]);
  });

  it("treats an unrecognized colon label as prose, not as a section break", () => {
    const ex = extractSectionsDetailed("## PROBLEM\nNote: this is prose inside the problem.\nmore text");
    assert.deepEqual(ex.sections.PROBLEM, ["Note: this is prose inside the problem.\nmore text"]);
  });
});

describe("XTRM-405: parse-blind dependency export fails the receipt", () => {
  it("a rewritten depends_on_id key produces FAIL with named unreconciled entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-drift-"));
    const dbPath = join(dir, "state.db");
    const fixture = join(here, "fixtures", "beads-parse-blind-dependencies.jsonl");
    const raw = readFileSync(fixture, "utf8");
    // Precondition: the fixture really is the parse-blind shape.
    assert.ok(!raw.includes("depends_on_id"), "fixture must not carry depends_on_id");
    assert.ok(raw.includes("target_id"), "fixture must carry target_id");
    const res = runCli([
      "--db", dbPath, "--json",
      "import", "beads", "--file", fixture, "--project", "prj_drift", "--create-project", "DRF:Drift",
    ]);
    assert.notEqual(res.code, 0, "a parse-blind import must not exit 0");
    const env = JSON.parse(res.stdout) as { ok: boolean; data: FullReceipt };
    assert.equal(env.ok, false);
    assert.equal(env.data.verdict, "FAIL");
    const failed = env.data.verifier.checks.filter((c) => !c.ok).map((c) => c.check);
    assert.ok(failed.includes("0c-unreconciled-inline-entries"), `expected 0c to fail, got ${failed.join(",")}`);
    const c0c = env.data.verifier.checks.find((c) => c.check === "0c-unreconciled-inline-entries");
    const actual = c0c?.actual as { unresolved: number; sample: string[] };
    assert.ok(actual.unresolved > 0, "unresolved entries must be counted");
    assert.ok(
      actual.sample.some((s) => s.includes("no resolvable target")),
      "the failing check must name the unreconciled entries",
    );
    // The census still counted every entry while nothing was accounted for:
    // this is exactly the loss the old receipt reported as PASS.
    assert.ok(env.data.counts.censusEdges > 0);
    assert.equal(env.data.counts.accountedEdges, 0);
    assert.equal(env.data.counts.edgeRowsAfter, env.data.counts.edgeRowsBefore);
  });
});

describe("XTRM-405: edge kinds are faithful and lossy mappings are declared", () => {
  it("duplicates/related map; waits-for and conditional-blocks are named unrepresentable", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-ek-"));
    const db = openSubstrate(join(dir, "state.db"));
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_ek", prefix: "EK", name: "ek" });
    try {
      const mk = (id: string) => ({ id, title: id, status: "open", issue_type: "task" });
      const result = importBeads(
        svc,
        "prj_ek",
        [
          {
            ...mk("ek-a"),
            dependencies: [
              { issue_id: "ek-a", depends_on_id: "ek-b", type: "duplicates" },
              { issue_id: "ek-a", depends_on_id: "ek-c", type: "related" },
              { issue_id: "ek-a", depends_on_id: "ek-d", type: "waits-for" },
              { issue_id: "ek-a", depends_on_id: "ek-e", type: "conditional-blocks" },
            ],
          },
          mk("ek-b"), mk("ek-c"), mk("ek-d"), mk("ek-e"),
        ],
        [],
      );
      // 4 declared entries, 4 accounted for: 2 applied + 2 declared.
      const aId = svc.resolveRef("ek-a").id;
      const kinds = svc.listActiveEdges().filter((e) => e.fromIssue === aId).map((e) => e.kind).sort();
      assert.deepEqual(kinds, ["duplicates", "relates_to"]);
      assert.deepEqual(
        result.unrepresentableEdges.map((e) => e.type).sort(),
        ["conditional-blocks", "waits-for"],
      );
      for (const e of result.unrepresentableEdges) {
        assert.ok(e.reason.includes(e.type), "the declaration must name the source type");
      }
      // Nothing was downgraded into `blocks`: that would be a strictly stronger
      // constraint than either source semantic.
      assert.ok(!svc.listActiveEdges().some((e) => e.kind === "blocks"));
      assert.equal(result.edgesApplied.length + result.unrepresentableEdges.length, 4);
      assert.deepEqual(result.depFailures, []);
    } finally {
      db.close();
    }
  });
});

describe("XTRM-405: source fields are recoverable without leaking into planning input", () => {
  it("labels/external_ref/assignee/started_at land in provenance, not contextRefs or ownership", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-sf-"));
    const db = openSubstrate(join(dir, "state.db"));
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_sf", prefix: "SF", name: "sf" });
    try {
      const result = importBeads(svc, "prj_sf", [
        {
          id: "sf-1",
          title: "Carries source fields",
          status: "open",
          issue_type: "chore",
          labels: ["contract:ready", "specialists"],
          external_ref: "gh-xtrm-32",
          assignee: "jaggerxtrm",
          started_at: "2026-07-24T19:17:33Z",
        },
      ], []);
      assert.deepEqual(result.sourceFields.labels, ["sf-1"]);
      assert.deepEqual(result.sourceFields.externalRefs, ["sf-1"]);
      assert.deepEqual(result.sourceFields.assignees, ["sf-1"]);
      assert.deepEqual(result.sourceFields.startedAt, ["sf-1"]);
      // `chore` has no Substrate kind; the remap is recorded, not silent.
      assert.deepEqual(result.sourceFields.issueTypesRemapped, [{ beadsId: "sf-1", sourceType: "chore", kind: "task" }]);

      const issue = svc.resolveRef("sf-1");
      const event = svc.listEvents(issue.id).find((e) => e.type === "beads.imported");
      assert.ok(event, "beads.imported provenance event must exist");
      const payload = event.payload as Record<string, unknown>;
      assert.deepEqual(payload.beadsLabels, ["contract:ready", "specialists"]);
      assert.equal(payload.beadsExternalRef, "gh-xtrm-32");
      assert.equal(payload.beadsAssignee, "jaggerjtrem".replace("jaggerjtrem", "jaggerxtrm"));
      assert.equal(payload.beadsStartedAt, "2026-07-24T19:17:33Z");
      assert.equal(payload.beadsIssueType, "chore");

      // Provenance stays inert: no contextRefs, no ownership.
      const rev = svc.getRevision(issue.id, issue.currentRevision);
      assert.deepEqual(rev.contextRefs ?? [], []);
      assert.ok(rev.ownership == null, "ownership must stay unset");
    } finally {
      db.close();
    }
  });
});

describe("XTRM-405: the real export structures and reconciles", () => {
  it("every source section lands as a populated contract field and the census reconciles", (t) => {
    if (!existsSync(REAL_EXPORT)) {
      t.skip("committed board-audit export not present");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "substrate-real-"));
    const dbPath = join(dir, "state.db");
    const env = (() => {
      const res = runCli([
        "--db", dbPath, "--json",
        "import", "beads", "--file", REAL_EXPORT, "--project", "prj_real", "--create-project", "REAL:Real",
      ]);
      assert.equal(res.code, 0, `real export import failed: ${res.stderr || res.stdout}`);
      return JSON.parse(res.stdout) as { data: FullReceipt };
    })();
    const receipt = env.data;
    assert.equal(receipt.verdict, "PASS");
    assert.ok(receipt.verifier.checks.every((c) => c.ok));
    // Census reconciliation: certified inputs equal certified outcomes.
    assert.equal(receipt.counts.censusEdges, receipt.counts.accountedEdges);
    assert.equal(receipt.counts.censusEdges, 78);
    assert.equal(receipt.counts.unresolvedEntries, 0);
    // 21 source `validates` edges are a declared downgrade, not a silent one.
    assert.equal(receipt.counts.downgradedEdges, 21);
    assert.equal(receipt.counts.unrepresentableEdges, 0);

    // Every (issue, section) pair where the source carries the heading must be
    // stored non-empty and free of the filler.
    const MARKER = "TBD \u2014 imported from Beads; pending XTRM planning";
    const records = readFileSync(REAL_EXPORT, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { _type?: string; id: string; description?: string })
      .filter((r) => r._type !== "memory");
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    try {
      let checked = 0;
      for (const r of records) {
        const recognized = new Set(extractSectionsDetailed(r.description ?? "").recognized);
        const issueId = svc.issueIdForAlias(r.id);
        if (issueId === null) continue;
        const rev = svc.getRevision(issueId, svc.getIssue(issueId).currentRevision);
        const c = rev.contract as unknown as Record<string, unknown>;
        for (const [section, field] of [["SCOPE", "scope"], ["VALIDATION", "validation"], ["OUTPUT", "output"]] as const) {
          if (!recognized.has(section)) continue;
          checked += 1;
          const value = c[field];
          assert.ok(Array.isArray(value) && value.length > 0, `${r.id}: ${field} empty despite source heading`);
          assert.ok(!JSON.stringify(value).includes(MARKER), `${r.id}: ${field} still holds the filler`);
        }
      }
      assert.ok(checked >= 100, `expected a substantial number of source sections, checked ${checked}`);
      // G46 still holds: nothing imported is dispatchable.
      assert.equal(svc.listIssues("prj_real").filter((i) => svc.getReadiness(i.id).dispatchable).length, 0);
    } finally {
      db.close();
    }
  });
});

// -- XTRM-406: source timestamps survive import -------------------------------
// `insertIssue` used to hardcode `Date.now()`, so every imported board reported
// a single fabricated history: 66/66 issues landed at import wall-clock against
// a source spanning months, and the existing `BeadsClosureInput.closedAt` seam
// was never wired.

describe("XTRM-406: source timestamps survive import", () => {
  const T_CREATED = Date.parse("2026-06-10T08:30:00Z");
  const T_UPDATED = Date.parse("2026-07-01T12:00:00Z");
  const T_CLOSED = Date.parse("2026-07-02T09:15:00Z");

  it("pins source created/updated/closed time on the row, the spine and the Closure", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-ts-"));
    const db = openSubstrate(join(dir, "state.db"));
    const svc = new IssueService(db);
    const closures = new ClosureService(db, svc);
    svc.createProject({ id: "prj_ts", prefix: "TS", name: "ts" });
    try {
      const result = importBeads(
        svc,
        "prj_ts",
        [
          { id: "ts-open", title: "Open", status: "open", issue_type: "task", created_at: "2026-06-10T08:30:00Z", updated_at: "2026-07-01T12:00:00Z" },
          { id: "ts-closed", title: "Closed", status: "closed", issue_type: "bug", created_at: "2026-06-10T08:30:00Z", updated_at: "2026-07-01T12:00:00Z", closed_at: "2026-07-02T09:15:00Z", close_reason: "shipped" },
        ],
        [],
        { closures },
      );
      const open = svc.resolveRef("ts-open");
      const closed = svc.resolveRef("ts-closed");

      // Issue row carries source time, not import time.
      assert.equal(open.createdAt, T_CREATED);
      assert.equal(open.updatedAt, T_UPDATED);
      assert.equal(closed.createdAt, T_CREATED);

      // Revision 1, the creation event and the alias share the source instant,
      // so the record's own history has one coherent origin.
      const rev = svc.getRevision(open.id, 1);
      assert.equal(rev.createdAt, T_CREATED);
      const createdEvent = svc.listEvents(open.id).find((e) => e.type === "issue.created");
      assert.equal(createdEvent?.createdAt, T_CREATED);

      // The terminal transition lands on source time, so it cannot contradict
      // the Closure row (which `lastTerminalTransitionAt` reads events for).
      const lifecycle = svc.listEvents(closed.id).find((e) => e.type === "issue.lifecycle");
      assert.equal(lifecycle?.createdAt, T_CLOSED);
      const closedEvent = svc.listEvents(closed.id).find((e) => e.type === "issue.closed");
      assert.equal(closedEvent?.createdAt, T_CLOSED);
      const closure = closures.getLatestClosure(closed.id);
      assert.ok(closure);
      assert.equal(closure.closedAt, T_CLOSED);
      assert.equal(closure.source, "beads");
      assert.equal(closure.reason, "shipped");

      // Every terminal record reports provenance, and nothing fell back to
      // wall-clock while the source carried a usable instant.
      assert.deepEqual(
        result.timestampProvenance.map((p) => [p.beadsId, p.createdAt, p.updatedAt, p.closedAt, p.terminalAtFrom]),
        [
          ["ts-open", "source", "source", "not-terminal", "not-terminal"],
          ["ts-closed", "source", "source", "source", "closed_at"],
        ],
      );
    } finally {
      db.close();
    }
  });

  it("treats a missing or malformed timestamp as absent, never as import time", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-ts2-"));
    const db = openSubstrate(join(dir, "state.db"));
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_ts2", prefix: "T2", name: "t2" });
    try {
      const before = Date.now();
      const result = importBeads(svc, "prj_ts2", [
        { id: "t2-bad", title: "Malformed", status: "open", issue_type: "task", created_at: "not-a-date", updated_at: "" },
        { id: "t2-none", title: "Absent", status: "open", issue_type: "task" },
      ], []);
      assert.deepEqual(result.timestampProvenance.map((p) => [p.beadsId, p.createdAt, p.updatedAt]), [
        ["t2-bad", "absent", "absent"],
        ["t2-none", "absent", "absent"],
      ]);
      // Absent source time falls back to creation wall-clock, which is the only
      // honest choice, and it is recorded as absent rather than misreported.
      for (const id of ["t2-bad", "t2-none"]) {
        const issue = svc.resolveRef(id);
        assert.ok(issue.createdAt >= before, `${id} should fall back to wall-clock`);
        assert.equal(issue.updatedAt, issue.createdAt);
      }
    } finally {
      db.close();
    }
  });

  it("normalises a contradictory source record and reports the correction", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-ts3-"));
    const db = openSubstrate(join(dir, "state.db"));
    const svc = new IssueService(db);
    const closures = new ClosureService(db, svc);
    svc.createProject({ id: "prj_ts3", prefix: "T3", name: "t3" });
    try {
      const created = Date.parse("2026-07-01T00:00:00Z");
      const result = importBeads(
        svc,
        "prj_ts3",
        [
          // updated_at precedes created_at
          { id: "t3-a", title: "A", status: "open", issue_type: "task", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z" },
          // closed_at precedes created_at
          { id: "t3-b", title: "B", status: "closed", issue_type: "task", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-02T00:00:00Z", closed_at: "2026-06-15T00:00:00Z" },
        ],
        [],
        { closures },
      );
      // Stored rows stay monotonic: a contradiction is normalised, not stored.
      assert.equal(svc.resolveRef("t3-a").updatedAt, created);
      const closureB = closures.getLatestClosure(svc.resolveRef("t3-b").id);
      assert.ok(closureB);
      assert.ok(closureB.closedAt >= svc.resolveRef("t3-b").createdAt);
      // And the correction is reported rather than silent.
      const normalised = result.timestampProvenance.filter((p) => p.normalized.length > 0);
      assert.equal(normalised.length, 2);
      assert.ok(normalised.every((p) => p.normalized[0]!.includes("clamped to created_at")));
    } finally {
      db.close();
    }
  });

  it("does not expose backdating on the generic creation path", () => {
    const dir = mkdtempSync(join(tmpdir(), "substrate-ts4-"));
    const db = openSubstrate(join(dir, "state.db"));
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_ts4", prefix: "T4", name: "t4" });
    try {
      const before = Date.now();
      // A caller smuggling a timestamp into the ordinary creation input must be
      // ignored: only the import-shaped seam can pin history.
      const created = svc.createIssue({
        projectId: "prj_ts4",
        title: "Smuggler",
        kind: "task",
        contract: contract(),
        createdAt: 0,
        updatedAt: 0,
      } as never);
      assert.ok(created.createdAt >= before, "generic createIssue must not backdate");
      assert.ok(svc.getRevision(created.id, 1).createdAt >= before);
    } finally {
      db.close();
    }
  });
});
