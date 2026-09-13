// `sb init` acceptance (ADR §§6, 84, 87, 88; bead XTRM-252.2). Fresh repository
// detection, base-branch detection, deterministic Project creation, durable
// binding, checkout alias cache, idempotency, adoption of an existing Project,
// multi-clone identity, and remote-normalization/credential-stripping through
// the init path. Real `git init` checkouts, temp DB, isolated HOME.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract, repoEnv, type RepoEnv } from "./helpers.ts";

interface InitData {
  repository: { repositoryKey: string; canonicalRemote: string | null; local: boolean; gitRoot: string };
  project: { id: string; prefix: string; name: string };
  baseBranch: string | null;
  created: boolean;
  adopted: boolean;
  idempotent: boolean;
}

function countRows(dbPath: string, table: string): number {
  const db = openSubstrate(dbPath);
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe("sb init: fresh repository acceptance (ADR §84)", () => {
  let env: RepoEnv;
  before(() => {
    env = repoEnv("sb-init-");
  });
  after(() => {
    env.restore();
  });

  it("discovers, binds, detects the base branch, works flagless, and is idempotent", () => {
    const repo = env.gitRepo("service");
    const root = realpathSync(repo);

    const first = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const init = first.data as InitData;
    assert.equal(init.repository.repositoryKey, `local:${root}`);
    assert.equal(init.repository.canonicalRemote, null);
    assert.equal(init.repository.local, true);
    assert.equal(init.repository.gitRoot, root);
    // Deterministic identity, no metadata prompt: the Project name comes from
    // the repository basename alone.
    assert.deepEqual(init.project, { id: "prj_service", prefix: "SERVICE", name: "service" });
    assert.equal(init.baseBranch, "main");
    assert.equal(init.created, true);
    assert.equal(init.adopted, false);
    assert.equal(init.idempotent, false);

    // Durable binding + checkout alias cache.
    assert.equal(countRows(env.dbPath, "repository_bindings"), 1);
    const db = openSubstrate(env.dbPath);
    try {
      const svc = new IssueService(db);
      const binding = svc.listLinks().find((l) => l.gitRoot === root);
      assert.equal(binding?.projectId, "prj_service");
      const projects = db.prepare("SELECT id, prefix FROM projects ORDER BY id").all() as Array<{ id: string; prefix: string }>;
      assert.deepEqual(projects.map((p) => `${p.id}:${p.prefix}`), ["prj_service:SERVICE"]);
    } finally {
      db.close();
    }

    // Flagless verbs operate on that repository afterwards (ADR §2).
    const contractFile = join(env.temp("sb-init-c-"), "c.json");
    writeFileSync(contractFile, JSON.stringify(contract({ problem: "init problem", success: "init success" })));
    const created = env.inCwd(repo, () =>
      env.run(["issue", "create", "--title", "Initialized", "--kind", "task", "--contract", contractFile]),
    );
    assert.equal(created.code, 0, created.stderr || created.stdout);
    assert.equal((created.data as { humanRef: string }).humanRef, "SERVICE-1");
    const listed = env.inCwd(repo, () => env.run(["issue", "list"]));
    assert.equal(listed.code, 0, listed.stderr || listed.stdout);
    assert.deepEqual((listed.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["SERVICE-1"]);

    // Second init: same Project, no duplicate row, created:false/idempotent:true.
    const second = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(second.code, 0, second.stderr || second.stdout);
    const again = second.data as InitData;
    assert.equal(again.project.id, "prj_service");
    assert.equal(again.created, false);
    assert.equal(again.adopted, false);
    assert.equal(again.idempotent, true);
    assert.equal(again.baseBranch, "main");
    assert.equal(countRows(env.dbPath, "projects"), 1);
    assert.equal(countRows(env.dbPath, "repository_bindings"), 1);
  });

  it("human init reports the same facts as --json and needs no project metadata", () => {
    const repo = env.gitRepo("humanjson");
    const human = env.inCwd(repo, () => env.run(["init"], { json: false }));
    assert.equal(human.code, 0, human.stderr || human.stdout);
    assert.match(human.stdout, /sb init: repository local:/);
    assert.match(human.stdout, /project: prj_humanjson \(HUMANJSON\)/);
    assert.match(human.stdout, /base branch: main/);
    const asJson = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(asJson.code, 0, asJson.stderr || asJson.stdout);
    const data = asJson.data as InitData;
    assert.equal(data.project.id, "prj_humanjson");
    assert.equal(data.idempotent, true);
    assert.ok(!asJson.stdout.includes('"single"'), "init output must not carry the removed single-project source");
  });

  it("adopts an existing Project with its Issue refs instead of duplicating it (ADR §14)", () => {
    const before = countRows(env.dbPath, "projects");
    const db = openSubstrate(env.dbPath);
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_adoptme", prefix: "ADOPTME", name: "adoptme" });
      const issue = svc.createIssue({ projectId: "prj_adoptme", title: "pre-existing", kind: "task", contract: contract() });
      assert.equal(issue.humanRef, "ADOPTME-1");
    } finally {
      db.close();
    }
    const repo = env.gitRepo("adoptme");
    const init = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const data = init.data as InitData;
    assert.equal(data.project.id, "prj_adoptme");
    assert.equal(data.created, false);
    assert.equal(data.adopted, true);
    // No new Project, the original namespace, no renumbering.
    assert.equal(countRows(env.dbPath, "projects"), before + 1);
    const db2 = openSubstrate(env.dbPath);
    try {
      const svc2 = new IssueService(db2);
      assert.equal(svc2.resolveRef("ADOPTME-1").humanRef, "ADOPTME-1");
    } finally {
      db2.close();
    }
  });
});

describe("sb init: multi-clone and remote normalization (ADR §§87-88)", () => {
  let env: RepoEnv;
  before(() => {
    env = repoEnv("sb-clone-");
  });
  after(() => {
    env.restore();
  });

  it("two clones of one canonical remote resolve to one identity and one Project", () => {
    const origin = env.gitRepo("origin-src");
    const sshUrl = "git@github.com:acme/service.git";
    const cloneA = join(env.temp("sb-clone-a-"), "cloneA");
    const cloneB = join(env.temp("sb-clone-b-"), "cloneB");
    env.git(origin, ["clone", "-q", origin, cloneA]);
    env.git(origin, ["clone", "-q", origin, cloneB]);
    env.git(cloneA, ["remote", "set-url", "origin", sshUrl]);
    env.git(cloneB, ["remote", "set-url", "origin", "https://github.com/acme/service.git"]);

    const a = env.inCwd(cloneA, () => env.run(["init"]));
    assert.equal(a.code, 0, a.stderr || a.stdout);
    assert.equal((a.data as InitData).repository.repositoryKey, "github.com/acme/service");
    assert.equal((a.data as InitData).project.id, "prj_service");
    assert.equal((a.data as InitData).created, true);

    // The second clone shares the identity BEFORE it runs init: the binding is
    // keyed by the canonical remote, not by the checkout path (ADR §87), so it
    // is shared identity rather than a leak into another Project.
    const contractFile = join(env.temp("sb-clone-c-"), "c.json");
    writeFileSync(contractFile, JSON.stringify(contract({ problem: "shared", success: "shared" })));
    const created = env.inCwd(cloneA, () => env.run(["issue", "create", "--title", "shared work", "--kind", "task", "--contract", contractFile]));
    assert.equal(created.code, 0, created.stderr || created.stdout);
    assert.equal((created.data as { humanRef: string }).humanRef, "SERVICE-1");
    const preInit = env.inCwd(cloneB, () => env.run(["issue", "list"]));
    assert.equal(preInit.code, 0, preInit.stderr || preInit.stdout);
    assert.deepEqual((preInit.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["SERVICE-1"]);

    const b = env.inCwd(cloneB, () => env.run(["init"]));
    assert.equal(b.code, 0, b.stderr || b.stdout);
    assert.equal((b.data as InitData).repository.repositoryKey, "github.com/acme/service");
    assert.equal((b.data as InitData).project.id, "prj_service", "no duplicate Issue namespace");
    assert.equal((b.data as InitData).created, false);
    assert.equal((b.data as InitData).idempotent, true);
    assert.equal(countRows(env.dbPath, "projects"), 1);
    assert.equal(countRows(env.dbPath, "repository_bindings"), 1);
  });

  it("SSH, HTTPS, ssh:// and .git/equivalent forms normalize to one key with credentials stripped", () => {
    const secret = "ghp_SUPERSECRETTOKEN";
    const projectsBefore = countRows(env.dbPath, "projects");
    const forms = [
      "git@github.com:acme/tool.git",
      "ssh://git@github.com/acme/tool.git",
      "https://github.com/acme/tool.git",
      "https://github.com/acme/tool",
      `https://x-access-token:${secret}@github.com/acme/tool.git`,
    ];
    for (const remote of forms) {
      const repo = env.gitRepo("tool", { remote });
      const init = env.inCwd(repo, () => env.run(["init"]));
      assert.equal(init.code, 0, `${remote}: ${init.stderr || init.stdout}`);
      const data = init.data as InitData;
      assert.equal(data.repository.repositoryKey, "github.com/acme/tool", `form: ${remote}`);
      assert.equal(data.repository.canonicalRemote, "github.com/acme/tool", `form: ${remote}`);
    }
    assert.equal(countRows(env.dbPath, "projects"), projectsBefore + 1, "one deterministic Project for every equivalent remote form");
    const db = openSubstrate(env.dbPath);
    try {
      const rows = JSON.stringify(db.prepare("SELECT * FROM repository_bindings").all());
      assert.ok(!rows.includes(secret), "a credential must never be persisted");
      assert.ok(!rows.includes("@"), "userinfo must not survive into the binding");
    } finally {
      db.close();
    }
  });

  it("ambiguous remotes fail closed instead of inventing an identity", () => {
    const repo = env.gitRepo("ambiguous");
    env.git(repo, ["remote", "add", "fork-a", "git@github.com:fork-a/ambiguous.git"]);
    env.git(repo, ["remote", "add", "fork-b", "git@github.com:fork-b/ambiguous.git"]);
    const init = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(init.code, 1);
    assert.match(init.error ?? "", /ambiguous canonical remote/);
    assert.match(init.error ?? "", /origin/);
  });
});
