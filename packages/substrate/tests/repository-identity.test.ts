// Repository identity derivation (ADR sbcloseout4 §§8-12, 9, 10; bead
// XTRM-252.1). Pure derivation: no database, no git process.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBaseBranch,
  deriveProjectCandidates,
  deriveProjectIdentity,
  deriveRepositoryIdentity,
  localRepositoryKey,
  normalizeRemote,
  selectCanonicalRemote,
  type RepositoryIdentity,
} from "../src/domain/repository.ts";

function remoteIdentity(repositoryKey: string): RepositoryIdentity {
  return { repositoryKey, canonicalRemote: repositoryKey, local: false };
}

function localIdentity(path: string): RepositoryIdentity {
  return { repositoryKey: localRepositoryKey(path), canonicalRemote: null, local: true };
}

describe("remote normalization (ADR §8)", () => {
  it("normalizes SCP, HTTPS, ssh:// and .git/non-.git forms to one key", () => {
    const equivalent = [
      "git@github.com:xtrm-dev/specialists.git",
      "git@github.com:xtrm-dev/specialists",
      "https://github.com/xtrm-dev/specialists.git",
      "https://github.com/xtrm-dev/specialists",
      "http://github.com/xtrm-dev/specialists/",
      "ssh://git@github.com/xtrm-dev/specialists.git",
      "ssh://git@github.com/xtrm-dev/specialists",
      "ssh://git@github.com:22/xtrm-dev/specialists.git",
      "git://github.com/xtrm-dev/specialists.git",
      "HTTPS://GITHUB.COM/xtrm-dev/specialists.git",
      "https://github.com:443/xtrm-dev/specialists.git",
      "deploy@github.com:xtrm-dev/specialists.git",
      "https://github.com/xtrm-dev/specialists?ref=main#readme",
    ];
    for (const form of equivalent) {
      assert.equal(normalizeRemote(form), "github.com/xtrm-dev/specialists", `form: ${form}`);
    }
  });

  it("strips credentials and never leaves a secret in the key", () => {
    const secret = "ghp_SUPERSECRETTOKEN";
    const forms = [
      `https://x-access-token:${secret}@github.com/xtrm-dev/specialists.git`,
      `https://user:${secret}@github.com/xtrm-dev/specialists.git`,
      `ssh://git:${secret}@github.com/xtrm-dev/specialists.git`,
      `https://${secret}@github.com/xtrm-dev/specialists.git`,
    ];
    for (const form of forms) {
      const key = normalizeRemote(form);
      assert.equal(key, "github.com/xtrm-dev/specialists", `form: ${form}`);
      assert.ok(!key!.includes(secret), "secret must not survive normalization");
      assert.ok(!key!.includes("@"), "userinfo must not survive normalization");
    }
  });

  it("keeps a non-default port (it may be a different server) and case in the path", () => {
    assert.equal(normalizeRemote("ssh://git@github.com:2222/xtrm-dev/specialists.git"), "github.com:2222/xtrm-dev/specialists");
    assert.notEqual(
      normalizeRemote("ssh://git@github.com:2222/a/b.git"),
      normalizeRemote("ssh://git@github.com:22/a/b.git"),
    );
    // IPv4 and bracketed IPv6 hosts are retained verbatim.
    assert.equal(normalizeRemote("https://192.0.2.10/xtrm-dev/svc.git"), "192.0.2.10/xtrm-dev/svc");
    assert.equal(normalizeRemote("ssh://git@[2001:db8::1]/xtrm-dev/svc.git"), "[2001:db8::1]/xtrm-dev/svc");
    // Only one trailing `.git` is stripped; an interior `.git` is identity.
    assert.equal(normalizeRemote("https://github.com/xtrm-dev/my.gitops"), "github.com/xtrm-dev/my.gitops");
    assert.equal(normalizeRemote("https://github.com/xtrm-dev/svc.git.git"), "github.com/xtrm-dev/svc.git");
    // Case is preserved: folding it could merge two repositories that differ
    // only by case, and accidental sharing breaks isolation (ADR §5) harder
    // than splitting does.
    assert.notEqual(normalizeRemote("https://github.com/Xtrm-Dev/Specialists"), normalizeRemote("https://github.com/xtrm-dev/specialists"));
    assert.equal(normalizeRemote("https://GitHub.com/xtrm-dev/specialists"), "github.com/xtrm-dev/specialists");
  });

  it("returns null for anything that is not a recognized remote", () => {
    const rejected = [
      "",
      "   ",
      "origin",
      "/home/dawid/dev/xtrm",
      "./relative/repo",
      "~/dev/xtrm",
      "file:///home/dawid/dev/xtrm",
      "ftp://github.com/xtrm-dev/xtrm",
      "host:",
      "foo:bar",
      "https://github.com/",
      "https://github.com/.git",
      "C:\\dev\\xtrm",
    ];
    for (const raw of rejected) {
      assert.equal(normalizeRemote(raw), null, `expected null for: ${JSON.stringify(raw)}`);
    }
  });

  it("is deterministic", () => {
    const input = "git@github.com:xtrm-dev/xtrm.git";
    assert.equal(normalizeRemote(input), normalizeRemote(input));
  });
});

describe("canonical remote selection (ADR §8)", () => {
  it("prefers origin, otherwise the only distinct key", () => {
    assert.equal(
      selectCanonicalRemote([
        { name: "backup", url: "git@github.com:other/repo.git" },
        { name: "origin", url: "git@github.com:xtrm-dev/xtrm.git" },
      ]),
      "github.com/xtrm-dev/xtrm",
    );
    assert.equal(selectCanonicalRemote([{ name: "upstream", url: "https://github.com/xtrm-dev/xtrm.git" }]), "github.com/xtrm-dev/xtrm");
    // Two remotes of one repository are not ambiguous.
    assert.equal(
      selectCanonicalRemote([
        { name: "ssh", url: "ssh://git@github.com/xtrm-dev/xtrm.git" },
        { name: "https", url: "https://github.com/xtrm-dev/xtrm" },
      ]),
      "github.com/xtrm-dev/xtrm",
    );
  });

  it("fails closed on several unrelated remotes with no origin, naming the repair", () => {
    assert.throws(
      () =>
        selectCanonicalRemote([
          { name: "fork", url: "https://github.com/me/xtrm.git" },
          { name: "upstream", url: "https://github.com/xtrm-dev/xtrm.git" },
        ]),
      /ambiguous canonical remote: 2 unrelated remotes.*Repair: configure 'origin'/,
    );
  });

  it("ignores non-normalizable remotes and reports null when none remain", () => {
    assert.equal(selectCanonicalRemote([{ name: "origin", url: "/local/path" }]), null);
    assert.equal(selectCanonicalRemote([]), null);
  });

  it("falls back to the Git common root only when no remote is usable (ADR §9)", () => {
    const withRemote = deriveRepositoryIdentity({
      commonRoot: "/home/dawid/dev/xtrm",
      remotes: [{ name: "origin", url: "git@github.com:xtrm-dev/xtrm.git" }],
    });
    assert.deepEqual(withRemote, {
      repositoryKey: "github.com/xtrm-dev/xtrm",
      canonicalRemote: "github.com/xtrm-dev/xtrm",
      local: false,
    });
    assert.deepEqual(deriveRepositoryIdentity({ commonRoot: "/home/dawid/dev/xtrm" }), {
      repositoryKey: "local:/home/dawid/dev/xtrm",
      canonicalRemote: null,
      local: true,
    });
    assert.throws(() => deriveRepositoryIdentity({}), /cannot derive repository identity/);
  });
});

describe("deterministic project identity (ADR §11)", () => {
  it("derives the ADR examples exactly", () => {
    assert.deepEqual(deriveProjectIdentity(remoteIdentity("github.com/xtrm-dev/xtrm")), {
      id: "prj_xtrm",
      prefix: "XTRM",
      name: "xtrm",
    });
    assert.deepEqual(deriveProjectIdentity(remoteIdentity("github.com/xtrm-dev/specialists")), {
      id: "prj_specialists",
      prefix: "SPECIALISTS",
      name: "specialists",
    });
  });

  it("is non-random and repeatable", () => {
    const identity = remoteIdentity("github.com/xtrm-dev/xtrm");
    assert.deepEqual(deriveProjectIdentity(identity), deriveProjectIdentity(identity));
    assert.match(deriveProjectIdentity(identity).id, /^prj_[a-z0-9]+(_[a-z0-9]+)*$/);
    assert.match(deriveProjectIdentity(identity).prefix, /^[A-Z][A-Z0-9]*$/);
  });

  it("sanitizes hostile basenames deterministically", () => {
    assert.deepEqual(deriveProjectIdentity(remoteIdentity("github.com/o/3d-viewer")), {
      id: "prj_3d_viewer",
      prefix: "R3DVIEWER",
      name: "3d-viewer",
    });
    assert.deepEqual(deriveProjectIdentity(remoteIdentity("github.com/o/---")), {
      id: "prj_repo",
      prefix: "REPO",
      name: "---",
    });
  });
});

describe("basename collision policy (ADR §12, §89)", () => {
  it("orders candidates basename, owner, full owner path and never shares an id", () => {
    const a = deriveProjectCandidates(remoteIdentity("github.com/a/service")).map((c) => c.id);
    const b = deriveProjectCandidates(remoteIdentity("github.com/b/service")).map((c) => c.id);
    assert.equal(a[0], "prj_service");
    assert.equal(b[0], "prj_service");
    assert.deepEqual(a, ["prj_service", "prj_a_service", "prj_github_com_a_service"]);
    assert.deepEqual(b, ["prj_service", "prj_b_service", "prj_github_com_b_service"]);
    // The only shared candidate is the ordinary one; the fallbacks are disjoint.
    assert.deepEqual(a.filter((id) => b.includes(id)), ["prj_service"]);
    for (const id of [...a, ...b]) assert.match(id, /^prj_[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it("incorporates a multi-segment owner path, then the host, deterministically", () => {
    assert.deepEqual(
      deriveProjectCandidates(remoteIdentity("github.com/a/team/service")).map((c) => c.id),
      ["prj_service", "prj_team_service", "prj_a_team_service", "prj_github_com_a_team_service"],
    );
    const gh = deriveProjectCandidates(remoteIdentity("github.com/o/service")).map((c) => c.id);
    const gl = deriveProjectCandidates(remoteIdentity("gitlab.com/o/service")).map((c) => c.id);
    assert.notDeepEqual(gh, gl);
    assert.deepEqual(gh.filter((id) => gl.includes(id)), ["prj_service", "prj_o_service"]);
  });

  it("applies the same policy to remote-less local repositories (ADR §9)", () => {
    assert.deepEqual(
      deriveProjectCandidates(localIdentity("/home/dawid/dev/xtrm")).map((c) => c.id),
      ["prj_xtrm", "prj_dev_xtrm", "prj_home_dawid_dev_xtrm"],
    );
    assert.deepEqual(
      deriveProjectCandidates(localIdentity("/srv/a/service")).map((c) => c.id),
      ["prj_service", "prj_a_service", "prj_srv_a_service"],
    );
  });
});

describe("remote-less repository identity (ADR §9)", () => {
  it("is the normalized absolute Git common root and documents its limitation", () => {
    assert.equal(localRepositoryKey("/home/dawid/dev/xtrm"), "local:/home/dawid/dev/xtrm");
    assert.equal(localRepositoryKey("/home/dawid/dev/xtrm/"), "local:/home/dawid/dev/xtrm");
    assert.notEqual(localRepositoryKey("/home/dawid/dev/xtrm"), localRepositoryKey("/home/dawid/dev/core"));
    // Documented limitation: a moved remote-less repository is not recognizable
    // as the same repository; the key is the path (ADR §9).
    assert.notEqual(localRepositoryKey("/home/dawid/dev/xtrm"), localRepositoryKey("/tmp/xtrm"));
    assert.throws(() => localRepositoryKey("relative/path"), /absolute Git common root/);
    assert.throws(() => localRepositoryKey("  "), /empty path/);
  });
});

describe("base branch derivation (ADR §10)", () => {
  it("follows remote HEAD, then configured default, then a conventional branch", () => {
    assert.equal(deriveBaseBranch({ remoteHead: "origin/HEAD -> main", localBranches: ["master"] }), "main");
    assert.equal(deriveBaseBranch({ remoteHead: "refs/remotes/origin/master" }), "master");
    assert.equal(deriveBaseBranch({ configuredDefault: "develop" }), "develop");
    assert.equal(deriveBaseBranch({ localBranches: ["feature/x", "master"] }), "master");
    assert.equal(deriveBaseBranch({ localBranches: ["main", "master"] }), "main");
  });

  it("never promotes the current branch and stays valid from a detached worktree", () => {
    assert.equal(deriveBaseBranch({ currentBranch: "feature/foo", localBranches: ["feature/foo"] }), null);
    assert.equal(deriveBaseBranch({ remoteHead: "refs/remotes/origin/main", currentBranch: null }), "main");
    assert.equal(deriveBaseBranch({}), null);
  });
});
