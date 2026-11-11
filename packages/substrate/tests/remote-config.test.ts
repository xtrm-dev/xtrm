// XTRM-733: one remote form, one key. Git accepts a remote as an scp-like
// shorthand or as a URL, and GitHub Actions checks out with the URL form while
// a developer clone is usually the shorthand. Both name the same repository, so
// both must derive the same key; otherwise a checkout recorded under one form is
// invisible from the other and the launcher reports not_installed.
//
// The rules live in `normalizeRemote` (src/domain/repository.ts). The plugin
// script must stay import-free, so it mirrors them; the parity table below is
// what keeps the copy honest. Add an input here before changing either side.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeRemote } from "../src/domain/repository.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = join(ROOT, "plugin", "substrate", "scripts", "remote-config.mjs");

interface RemoteConfig {
  parseRemoteKey: (remote: string) => string | null;
  repositoryKey: (remote?: string) => string | null;
}

const config = (await import(pathToFileURL(MODULE).href)) as RemoteConfig;

const EXPECTED = "github.com/xtrm-dev/xtrm";

// Every form a real checkout uses, plus the inputs that must be refused rather
// than folded onto a key. Both parsers run over this list.
const PARITY_INPUTS: string[] = [
  "git@github.com:xtrm-dev/xtrm.git",
  "git@github.com:xtrm-dev/xtrm",
  "github.com:xtrm-dev/xtrm",
  "git@[::1]:acme/app",
  "https://github.com/xtrm-dev/xtrm",
  "https://github.com/xtrm-dev/xtrm.git",
  "https://github.com:443/xtrm-dev/xtrm.git",
  "https://token:secret@github.com/xtrm-dev/xtrm.git",
  "https://GitHub.com/xtrm-dev/xtrm",
  "ssh://git@github.com/xtrm-dev/xtrm.git",
  "ssh://git@github.com:22/xtrm-dev/xtrm.git",
  "git+ssh://git@github.com/xtrm-dev/xtrm.git",
  // Refusals: a scheme nobody serves, an authority that hides a different host
  // behind a query, fragment or escaped separator, a local path, junk.
  "ftp://github.com/xtrm-dev/xtrm",
  "file:///tmp/checkout",
  "http://127.0.0.1:1#@github.com/acme/app",
  "https://evil.com\\@github.com/acme/app",
  "https://github.com",
  "https://",
  "/local/path",
  "./relative/path",
  "~/home/path",
  "",
  "   ",
  "not-a-remote",
  "github.com:",
  "origin:thing",
  "git@evil.com:path@github.com:acme/app",
];

describe("XTRM-733 repositoryKey: every remote form yields one key", () => {
  it("maps the scp, https and ssh:// forms to the same key", () => {
    const table: Array<[string, string]> = [
      ["git@github.com:xtrm-dev/xtrm.git", EXPECTED],
      ["git@github.com:xtrm-dev/xtrm", EXPECTED],
      ["github.com:xtrm-dev/xtrm", EXPECTED],
      ["https://github.com/xtrm-dev/xtrm", EXPECTED],
      ["https://github.com/xtrm-dev/xtrm.git", EXPECTED],
      ["https://github.com:443/xtrm-dev/xtrm.git", EXPECTED],
      ["https://token:secret@github.com/xtrm-dev/xtrm.git", EXPECTED],
      ["ssh://git@github.com/xtrm-dev/xtrm.git", EXPECTED],
      ["ssh://git@github.com:22/xtrm-dev/xtrm.git", EXPECTED],
      ["https://GitHub.com/xtrm-dev/xtrm", EXPECTED],
    ];
    for (const [remote, expected] of table) {
      assert.equal(config.parseRemoteKey(remote), expected, `${remote} must derive ${expected}`);
      assert.equal(config.repositoryKey(remote), expected, `${remote} must derive ${expected} through repositoryKey`);
    }
  });

  it("refuses input that names no repository instead of inventing a key", () => {
    for (const remote of ["", "   ", "not-a-remote", "file:///tmp/checkout", "https://github.com", "github.com:", "ftp://github.com/xtrm-dev/xtrm"]) {
      assert.equal(config.parseRemoteKey(remote), null, `${JSON.stringify(remote)} must not derive a key`);
    }
  });

  it("agrees with normalizeRemote on every input, refusals included", () => {
    for (const remote of PARITY_INPUTS) {
      assert.equal(
        config.parseRemoteKey(remote),
        normalizeRemote(remote),
        `${JSON.stringify(remote)} must derive the same key in the plugin script and the domain`,
      );
    }
  });

  it("derives this checkout's key from the real origin, whichever form it is", () => {
    const origin = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const expected = normalizeRemote(origin);
    assert.ok(expected !== null, `origin ${origin} must name a repository`);
    const derived = config.repositoryKey();
    assert.equal(derived, expected, "repositoryKey reads the origin and derives the domain's key");
    assert.equal(config.parseRemoteKey(origin), expected, "the plugin parser agrees with the domain for this origin");
    assert.match(expected, /^[^/\s]+\/.+/, "a key is a host and a path");
  });
});
