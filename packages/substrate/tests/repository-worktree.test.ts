// Worktree acceptance (ADR §§7, 86; bead XTRM-252.2). Every worktree of one
// repository is the same repository: main checkout, linked branch worktree and
// detached worktree resolve one Project through the Git common root, with no
// re-initialization and no worktree-specific Project. Initializing from a
// feature branch or a detached worktree must not make that branch the base.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { contract, repoEnv, type RepoEnv } from "./helpers.ts";

describe("worktree acceptance (ADR §86)", () => {
  let env: RepoEnv;
  before(() => {
    env = repoEnv("sb-wt-");
  });
  after(() => {
    env.restore();
  });

  it("main, linked and detached worktrees resolve one Project; init from them never picks the current branch", () => {
    const main = env.gitRepo("wt-repo", { remote: "git@github.com:acme/wt-repo.git" });
    const linked = join(env.temp("sb-wt-linked-"), "linked");
    const detached = join(env.temp("sb-wt-detached-"), "detached");
    env.git(main, ["worktree", "add", "-q", "-b", "feature/x", linked]);
    env.git(main, ["worktree", "add", "-q", "--detach", detached]);

    // Initialize from the feature worktree: the base branch is main, never
    // feature/x (ADR §10, §86).
    const init = env.inCwd(linked, () => env.run(["init"]));
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const data = init.data as { baseBranch: string | null; project: { id: string }; created: boolean };
    assert.equal(data.baseBranch, "main");
    assert.notEqual(data.baseBranch, "feature/x");
    assert.equal(data.project.id, "prj_wt_repo");
    assert.equal(data.created, true);

    // Every worktree resolves the same Project: no re-initialization, no
    // worktree-specific Project.
    for (const dir of [main, linked, detached]) {
      const list = env.inCwd(dir, () => env.run(["issue", "list"]));
      assert.equal(list.code, 0, `${dir}: ${list.stderr || list.stdout}`);
      assert.deepEqual(list.data, [], `empty shared namespace from ${dir}`);
    }

    // A write from one worktree is visible from the others.
    const contractFile = join(env.temp("sb-wt-c-"), "c.json");
    writeFileSync(contractFile, JSON.stringify(contract({ problem: "wt", success: "wt" })));
    const created = env.inCwd(detached, () => env.run(["issue", "create", "--title", "wt work", "--kind", "task", "--contract", contractFile]));
    assert.equal(created.code, 0, created.stderr || created.stdout);
    assert.equal((created.data as { humanRef: string }).humanRef, "WTREPO-1");
    const fromMain = env.inCwd(main, () => env.run(["issue", "list"]));
    assert.deepEqual((fromMain.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["WTREPO-1"]);

    // Re-init from the detached worktree stays idempotent and keeps main.
    const again = env.inCwd(detached, () => env.run(["init"]));
    assert.equal(again.code, 0, again.stderr || again.stdout);
    const againData = again.data as { baseBranch: string | null; project: { id: string }; idempotent: boolean };
    assert.equal(againData.baseBranch, "main");
    assert.equal(againData.project.id, "prj_wt_repo");
    assert.equal(againData.idempotent, true);

    // One Project and one binding for the whole repository.
    const db = openSubstrate(env.dbPath);
    try {
      const projects = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
      const bindings = db.prepare("SELECT COUNT(*) AS n FROM repository_bindings").get() as { n: number };
      assert.equal(projects.n, 1);
      assert.equal(bindings.n, 1);
    } finally {
      db.close();
    }
  });

  it("a FRESH init from a detached worktree binds main, not the detached HEAD (ADR §10, §86)", () => {
    const main = env.gitRepo("detached-init", { remote: "git@github.com:acme/detached-init.git" });
    const detached = join(env.temp("sb-wt-det-"), "detached");
    env.git(main, ["worktree", "add", "-q", "--detach", detached]);

    const init = env.inCwd(detached, () => env.run(["init"]));
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const data = init.data as { baseBranch: string | null; project: { id: string }; created: boolean };
    assert.equal(data.created, true, "first init from the detached worktree creates the binding");
    assert.equal(data.baseBranch, "main");
    assert.equal(data.project.id, "prj_detached_init");
  });
});
