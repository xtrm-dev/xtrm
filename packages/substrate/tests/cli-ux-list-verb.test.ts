// XTRM-740: the interactive wrapper renders `issue list` and `issue browse`
// through the tree engine, so an engine error used to name a command the
// operator never typed — `issue tree` for `sb issue list --bogus`. The message
// must keep the operator's own verb, and the hierarchical rendering that made
// the rewrite necessary must not change.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli } from "../cli/sb.ts";
import { engineArgsForList, runUxCli } from "../cli/sb-ux.ts";
import { contract } from "./helpers.ts";

function board(): { dir: string; dbPath: string; db: ReturnType<typeof openSubstrate>; svc: IssueService; parent: string; child: string } {
  const dir = mkdtempSync(join(tmpdir(), "sb-list-verb-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const parent = svc.createIssue({ projectId: "prj_xtrm", title: "parent", kind: "epic", contract: contract(), scrutiny: "LOW", authoredBy: "t" });
  const child = svc.createIssue({
    projectId: "prj_xtrm",
    title: "child",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "t",
    parentId: parent.id,
  });
  // The list renderer prints the locator for a child (XTRM-1.1) and the ref for a
  // root, so the assertions use what is on screen rather than the durable ref.
  return { dir, dbPath, db, svc, parent: parent.humanRef, child: svc.getIssue(child.id).locator };
}

describe("XTRM-740: a wrapper error names the verb the operator typed", () => {
  const cases = [
    ["issue", "list", "--bogus", "x"],
    ["issue", "list", "--holder", "h"],
    ["issue", "list", "--project", "prj_x", "--bogus"],
  ];

  for (const argv of cases) {
    it(`sb ${argv.join(" ")} names issue.list, never issue.tree`, async () => {
      const w = board();
      const held = process.env["SUBSTRATE_PROJECT"];
      process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
      try {
        const res = await runUxCli(["--db", w.dbPath, "--plain", ...argv], { isTTY: false });
        assert.equal(res.code, 1, "an unsupported flag still fails closed");
        assert.match(res.stderr, /`issue\.list`/, `got: ${res.stderr}`);
        assert.ok(!res.stderr.includes("issue.tree"), `the substituted verb leaked into the message: ${res.stderr}`);
        assert.match(res.stderr, /\(see usage\)/, "the remediation stays for the command that was typed");
      } finally {
        if (held === undefined) delete process.env["SUBSTRATE_PROJECT"];
        else process.env["SUBSTRATE_PROJECT"] = held;
        w.db.close();
        rmSync(w.dir, { recursive: true, force: true });
      }
    });
  }

  it("the engine, called directly, still names issue.list", () => {
    const w = board();
    try {
      const res = runCli(["--db", w.dbPath, "issue", "list", "--bogus", "x"], { env: { ...process.env } });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /unknown flag --bogus for `issue\.list`/);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("a flag error on another verb is left alone", async () => {
    const w = board();
    const held = process.env["SUBSTRATE_PROJECT"];
    process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
    try {
      const res = await runUxCli(["--db", w.dbPath, "--plain", "issue", "show", w.parent, "--bogus", "x"], { isTTY: false });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /`issue\.show`/, "only the rewritten verb is remapped");
      assert.ok(!res.stderr.includes("issue.list"));
    } finally {
      if (held === undefined) delete process.env["SUBSTRATE_PROJECT"];
      else process.env["SUBSTRATE_PROJECT"] = held;
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("XTRM-740: the hierarchical rendering the rewrite exists for is unchanged", () => {
  it("still prints both levels, parent before child, and indents the child", async () => {
    const w = board();
    const held = process.env["SUBSTRATE_PROJECT"];
    process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
    try {
      const res = await runUxCli(["--db", w.dbPath, "--plain", "issue", "list"], { isTTY: false });
      assert.equal(res.code, 0, res.stderr);
      const lines = res.stdout.split("\n");
      const parentLine = lines.findIndex((l) => l.includes(w.parent));
      const childLine = lines.findIndex((l) => l.includes(w.child));
      assert.ok(parentLine >= 0 && childLine >= 0, `both issues are listed: ${res.stdout}`);
      assert.ok(parentLine < childLine, "the parent is printed above its child");
      const childIndent = lines[childLine]!.search(/\S/);
      const parentIndent = lines[parentLine]!.search(/\S/);
      assert.ok(childIndent > parentIndent, "the child is indented under its parent");
    } finally {
      if (held === undefined) delete process.env["SUBSTRATE_PROJECT"];
      else process.env["SUBSTRATE_PROJECT"] = held;
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("still answers the TTY requirement on browse, unchanged", async () => {
    const w = board();
    try {
      // The group must be the first positional for the browse path to be entered
      // (`--db` is accepted anywhere), which is how the binary is invoked.
      const res = await runUxCli(["issue", "browse", "--db", w.dbPath, "--plain", "--bogus", "x"], { isTTY: false });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /interactive browser requires a TTY/, "browse keeps its own early failure");
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("XTRM-741: the rewrite moves the verb and nothing else", () => {
  // Only the verb is rewritten. Scanning for the first `list`/`browse` token
  // anywhere in argv rewrote flag values: `sb issue browse --search list`
  // searched for "tree".
  const cases: Array<[string[], string[], string]> = [
    [["issue", "browse", "--search", "list"], ["issue", "tree", "--search", "list"], "a search term spelling a verb is left alone"],
    [["issue", "browse", "--search", "browse"], ["issue", "tree", "--search", "browse"], "even when the term is the other verb"],
    [["--db", "/tmp/x", "issue", "list", "--search", "browse"], ["--db", "/tmp/x", "issue", "tree", "--search", "browse"], "a leading global flag does not shift the rewrite"],
    [["issue", "list", "--status", "ready"], ["issue", "tree", "--status", "ready"], "filters pass through unchanged"],
    [["issue", "show", "XTRM-1"], ["issue", "show", "XTRM-1"], "a verb that is not list/browse is never rewritten"],
    [["project", "list"], ["project", "tree"], "the rewrite is positional, not verb-name based"],
  ];
  for (const [input, expected, why] of cases) {
    it(`${why}: ${input.join(" ")}`, () => {
      assert.deepEqual(engineArgsForList(input), expected);
    });
  }
});

describe("XTRM-741: a global flag before the group still reaches the browser", () => {
  for (const argv of [
    ["--db", ":db:", "issue", "browse"],
    ["issue", "browse", "--db", ":db:"],
    ["--project", "prj_xtrm", "issue", "browse"],
  ]) {
    it(`sb ${argv.join(" ").replace(":db:", "<db>")} answers the TTY check, not an unknown verb`, async () => {
      const w = board();
      const substituted = argv.map((token) => (token === ":db:" ? w.dbPath : token));
      try {
        const res = await runUxCli(substituted, { isTTY: false });
        assert.equal(res.code, 1);
        assert.match(res.stderr, /interactive browser requires a TTY/, `got: ${res.stderr}`);
        assert.ok(!res.stderr.includes("unknown issue verb"), "the browser path is entered");
      } finally {
        w.db.close();
        rmSync(w.dir, { recursive: true, force: true });
      }
    });
  }

  it("browse fails on the TTY before it validates flags", async () => {
    // Ordering, pinned deliberately: the browser refuses a non-interactive run
    // before any flag is examined, so a bad flag on browse never produces a
    // flag message. XTRM-740's verb mapping still covers the list path, where
    // the engine is what fails.
    const w = board();
    try {
      const res = await runUxCli(["issue", "browse", "--db", w.dbPath, "--bogus", "x"], { isTTY: false });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /interactive browser requires a TTY/);
      assert.ok(!res.stderr.includes("unknown flag"), `got: ${res.stderr}`);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});
