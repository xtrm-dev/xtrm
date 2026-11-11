// XTRM-733: one remote form, one key. Git accepts a remote as an scp-like
// shorthand or as a URL, and GitHub Actions checks out with the URL form while
// a developer clone is usually the shorthand. Both name the same repository, so
// both must derive the same key; otherwise a checkout recorded under one form is
// invisible from the other and the launcher reports not_installed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = join(ROOT, "plugin", "substrate", "scripts", "remote-config.mjs");

interface RemoteConfig {
  parseRemoteKey: (remote: string) => string | null;
  repositoryKey: (remote?: string) => string | null;
}

const config = (await import(pathToFileURL(MODULE).href)) as RemoteConfig;

const EXPECTED = "github.com/xtrm-dev/xtrm";

describe("XTRM-733 repositoryKey: every remote form yields one key", () => {
  it("maps the scp, https and ssh:// forms to the same key", () => {
    const table: Array<[string, string]> = [
      // scp shorthand: the form a developer clone uses, and the only form that
      // ever produced a key before this fix.
      ["git@github.com:xtrm-dev/xtrm.git", EXPECTED],
      ["git@github.com:xtrm-dev/xtrm", EXPECTED],
      ["github.com:xtrm-dev/xtrm", EXPECTED],
      // URL form: the form GitHub Actions checks out with.
      ["https://github.com/xtrm-dev/xtrm", EXPECTED],
      ["https://github.com/xtrm-dev/xtrm.git", EXPECTED],
      ["https://github.com:443/xtrm-dev/xtrm.git", EXPECTED],
      ["https://token:secret@github.com/xtrm-dev/xtrm.git", EXPECTED],
      ["ssh://git@github.com/xtrm-dev/xtrm.git", EXPECTED],
      ["ssh://git@github.com:22/xtrm-dev/xtrm.git", EXPECTED],
      // Host case never changes the repository.
      ["https://GitHub.com/xtrm-dev/xtrm", EXPECTED],
    ];
    for (const [remote, expected] of table) {
      assert.equal(config.parseRemoteKey(remote), expected, `${remote} must derive ${expected}`);
      assert.equal(config.repositoryKey(remote), expected, `${remote} must derive ${expected} through repositoryKey`);
    }
  });

  it("refuses input that names no repository instead of inventing a key", () => {
    for (const remote of ["", "   ", "not-a-remote", "file:///tmp/checkout", "https://github.com", "github.com:"]) {
      assert.equal(config.parseRemoteKey(remote), null, `${JSON.stringify(remote)} must not derive a key`);
    }
  });

  it("derives this checkout's key from the real origin, whichever form it is", () => {
    const origin = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const derived = config.repositoryKey();
    assert.ok(derived !== null, "a git checkout with an origin must derive a key");
    assert.equal(derived, config.parseRemoteKey(origin), "repositoryKey reads the origin and parses it once");
    assert.equal(derived, EXPECTED, `origin ${origin} must derive ${EXPECTED}`);
  });
});
