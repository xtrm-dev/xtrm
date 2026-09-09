import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

// Acceptance xtrm-7wc.5.6 (cwd-aware project resolution): precedence
// flag > env > linked checkout > single-project default > fail-closed,
// link/unlink round-trip, non-git skip, real-checkout CLI test, and a
// freshness probe (service write -> linked CLI read).

function setup(): { dir: string; dbPath: string; svc: IssueService; db: ReturnType<typeof openSubstrate> } {
  const dir = mkdtempSync(join(tmpdir(), "sb-resolve-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  return { dir, dbPath, svc: new IssueService(db), db };
}

describe("project resolution (xtrm-7wc.5.6)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("precedence: flag beats env beats link beats single default", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    ctx.svc.createProject({ id: "prj_b", prefix: "B", name: "b" });
    ctx.svc.linkCheckout("/repo", "prj_a");
    assert.equal(ctx.svc.resolveProject({ explicit: "prj_b", env: "prj_a", gitRoot: "/repo" }).projectId, "prj_b");
    assert.equal(ctx.svc.resolveProject({ env: "prj_b", gitRoot: "/repo" }).source, "env");
    assert.deepEqual(ctx.svc.resolveProject({ gitRoot: "/repo" }), { projectId: "prj_a", source: "link" });
  });

  it("single-project default applies; zero and several fail closed with guidance", () => {
    assert.throws(() => ctx.svc.resolveProject({}), /no projects exist.*sb project create/);
    ctx.svc.createProject({ id: "prj_only", prefix: "ONLY", name: "only" });
    assert.deepEqual(ctx.svc.resolveProject({}), { projectId: "prj_only", source: "single" });
    assert.deepEqual(ctx.svc.resolveProject({ gitRoot: "/unlinked" }), { projectId: "prj_only", source: "single" });
    ctx.svc.createProject({ id: "prj_second", prefix: "SECOND", name: "second" });
    assert.throws(() => ctx.svc.resolveProject({}), /prj_only.*prj_second.*sb project link/);
    assert.throws(() => ctx.svc.resolveProject({ gitRoot: "/unlinked" }), /SUBSTRATE_PROJECT/);
  });

  it("link round-trip: link, re-link moves, unlink removes; unknown project refused", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    ctx.svc.createProject({ id: "prj_b", prefix: "B", name: "b" });
    assert.deepEqual(ctx.svc.linkCheckout("/repo", "prj_a"), { gitRoot: "/repo", projectId: "prj_a" });
    assert.deepEqual(ctx.svc.linkCheckout("/repo", "prj_b"), { gitRoot: "/repo", projectId: "prj_b" });
    assert.equal(ctx.svc.listLinks().length, 1);
    assert.equal(ctx.svc.unlinkCheckout("/repo"), true);
    assert.equal(ctx.svc.unlinkCheckout("/repo"), false);
    assert.throws(() => ctx.svc.linkCheckout("/repo", "prj_nope"), /unknown project/);
    assert.throws(() => ctx.svc.linkCheckout("  "), /not inside a git checkout/);
  });

  it("link without --project infers exactly-one, requires explicit with several", () => {
    ctx.svc.createProject({ id: "prj_only", prefix: "ONLY", name: "only" });
    assert.deepEqual(ctx.svc.linkCheckout("/repo"), { gitRoot: "/repo", projectId: "prj_only" });
    ctx.svc.createProject({ id: "prj_second", prefix: "SECOND", name: "second" });
    assert.throws(() => ctx.svc.linkCheckout("/other"), /pass --project/);
  });

  it("dangling link -> resolution fails with re-link guidance", () => {
    // FK normally prevents this; force the dangling row to prove the
    // defensive catch (e.g. a DB edited with FK off).
    ctx.db.exec("PRAGMA foreign_keys = OFF");
    ctx.db.prepare("INSERT INTO checkout_links (git_root, project_id, linked_at) VALUES (?, ?, ?)").run("/repo", "prj_gone", Date.now());
    ctx.db.exec("PRAGMA foreign_keys = ON");
    assert.throws(() => ctx.svc.resolveProject({ gitRoot: "/repo" }), /re-link this checkout/);
  });

  it("CLI: real git checkout links, then flagless list/show/tree/ready resolve (freshness probe)", () => {
    const repo = mkdtempSync(join(tmpdir(), "sb-linked-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      const cli = (argv: string[]): unknown => {
        const res = runCli(["--db", ctx.dbPath, "--json", ...argv]);
        assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
        const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
        assert.equal(env.schema, SCHEMA_VERSION);
        assert.equal(env.ok, true);
        return env.data;
      };
      const prev = process.cwd();
      process.chdir(repo);
      try {
        // unlinked checkout with zero projects: fail-closed with guidance
        const bare = runCli(["--db", ctx.dbPath, "--json", "issue", "list"]);
        assert.equal(bare.code, 1);
        assert.match(bare.stdout, /sb project create/);
        // create + link from inside the checkout (project verb takes no cwd flags)
        const project = cli(["project", "create", "--prefix", "LINK", "--name", "linked"]) as { id: string };
        const linked = cli(["project", "link"]) as { gitRoot: string; projectId: string };
        assert.equal(linked.projectId, project.id);
        // service write -> linked CLI read (freshness: no cached resolution)
        const cpath = join(repo, "c.json");
        writeFileSync(cpath, JSON.stringify({ ...contract(), problem: "P", success: "S" }));
        const created = cli(["issue", "create", "--title", "T", "--kind", "task", "--contract", cpath]) as { humanRef: string };
        const listed = cli(["issue", "list"]) as Array<{ humanRef: string }>;
        assert.ok(listed.some((i) => i.humanRef === created.humanRef));
        const shown = cli(["issue", "show", created.humanRef]) as { humanRef: string };
        assert.equal(shown.humanRef, created.humanRef);
        const ready = cli(["issue", "ready"]) as unknown[];
        assert.ok(Array.isArray(ready));
        const human = runCli(["--db", ctx.dbPath, "issue", "tree"]);
        assert.equal(human.code, 0, human.stderr);
        assert.ok(human.stdout.includes(created.humanRef));
        // explicit --project still wins over the link
        ctx.svc.createProject({ id: "prj_other", prefix: "OTHER", name: "other" });
        const scoped = cli(["issue", "list", "--project", "prj_other"]) as unknown[];
        assert.equal(scoped.length, 0);
      } finally {
        process.chdir(prev);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
