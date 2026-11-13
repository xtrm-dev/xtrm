// XTRM-748: the changelog step is proven without git-cliff and without network.
//
// Every case runs the real script against a fixture CHANGELOG and a stub binary:
// the script's own flags (--changelog/--config/--cliff) exist so this test never
// touches the tracked CHANGELOG.md and never needs git-cliff installed.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(packageRoot, "scripts", "changelog-update.mjs");

const HEADER = `# Changelog

All notable changes to the package are documented in this file.

## [1.0.0] - 2026-01-01

### Added
- released one
- released two
`;

/** A stub that answers with canned markdown, so the assertions are exact.
 * It answers the --tag case with a versioned heading, as git-cliff does. */
function stubCliff(dir, body, tagBody = body) {
  const file = path.join(dir, "git-cliff-stub.sh");
  writeFileSync(file, [
    "#!/bin/sh",
    'case "$*" in',
    "  *--tag*)",
    "cat <<'BODY2'",
    tagBody,
    "BODY2",
    "    ;;",
    "  *)",
    "cat <<'BODY'",
    body,
    "BODY",
    "    ;;",
    "esac",
    "",
  ].join("\n"));
  chmodSync(file, 0o755);
  return file;
}

const dirs = [];
function world(cliffBody, tagBody = cliffBody) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xtrm-changelog-"));
  dirs.push(dir);
  const changelog = path.join(dir, "CHANGELOG.md");
  writeFileSync(changelog, HEADER);
  const config = path.join(dir, "cliff.toml");
  writeFileSync(config, "[changelog]\nbody = \"\"\n");
  return { dir, changelog, config, cliff: stubCliff(dir, cliffBody, tagBody) };
}

function run(w, args = []) {
  return execFileSync("node", [SCRIPT, "--changelog", w.changelog, "--config", w.config, "--cliff", w.cliff, ...args], {
    encoding: "utf8",
    cwd: packageRoot,
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("changelog-update", () => {
  it("promotes nothing that is already released, and preserves every released section", () => {
    // The render repeats "released one" (already under 1.0.0) and adds a new line.
    const w = world("## [Unreleased]\n\n### Added\n- released one\n- brand new\n");
    run(w);
    const after = readFileSync(w.changelog, "utf8");
    assert.match(after, /^## \[Unreleased\]$/m);
    assert.match(after, /- brand new/);
    // The duplicate must not appear twice.
    assert.equal(after.split("- released one").length - 1, 1);
    // The released section is byte-identical.
    assert.ok(after.includes("## [1.0.0] - 2026-01-01"));
    assert.ok(after.includes("- released two"));
  });

  it("is idempotent: a second run changes nothing and --check passes", () => {
    const w = world("## [Unreleased]\n\n### Added\n- brand new\n");
    const first = run(w);
    const once = readFileSync(w.changelog, "utf8");
    assert.match(first, /refreshed/);
    run(w);
    assert.equal(readFileSync(w.changelog, "utf8"), once);
    assert.match(run(w, ["--check"]), /already up to date/);
  });

  it("--check exits non-zero when the file would change", () => {
    const w = world("## [Unreleased]\n\n### Added\n- brand new\n");
    assert.throws(() => run(w, ["--check"]), /out of date/);
    assert.equal(readFileSync(w.changelog, "utf8"), HEADER, "a check run must not write");
  });

  it("--tag cuts the entries into a versioned section and leaves an empty [Unreleased]", () => {
    const w = world(
      "## [Unreleased]\n\n### Added\n- brand new\n",
      "## [1.1.0] - 2026-11-13\n\n### Added\n- brand new\n",
    );
    const out = run(w, ["--tag", "v1.1.0"]);
    assert.match(out, /cut v1\.1\.0 section/);
    const after = readFileSync(w.changelog, "utf8");
    assert.match(after, /## \[1\.1\.0\]/);
    assert.match(after, /- brand new/);
    // The emptied [Unreleased] sits above the new section, and 1.0.0 is intact.
    assert.ok(after.indexOf("## [Unreleased]") < after.indexOf("## [1.1.0]"));
    assert.ok(after.includes("## [1.0.0] - 2026-01-01"));
    assert.ok(after.includes("- released two"));
    // A second promotion has nothing to promote and refuses instead of duplicating.
    assert.throws(() => run(w, ["--tag", "v1.1.1"]), /no \[Unreleased\] entries to promote/);
  });

  it("fails closed with an actionable message when git-cliff is absent", () => {
    const w = world("## [Unreleased]\n\n- ignored\n");
    const before = readFileSync(w.changelog, "utf8");
    let error;
    try {
      execFileSync("node", [SCRIPT, "--changelog", w.changelog, "--config", w.config, "--cliff", path.join(w.dir, "no-such-cliff")], {
        encoding: "utf8",
        cwd: packageRoot,
        stdio: "pipe",
      });
    } catch (e) {
      error = e;
    }
    assert.ok(error, "a missing binary must fail the run");
    const stderr = String(error.stderr ?? "") + String(error.message ?? "");
    assert.match(stderr, /git-cliff >= 2\.10 is required/);
    assert.match(stderr, /Nothing was written/);
    assert.equal(readFileSync(w.changelog, "utf8"), before, "a failed run must not touch the file");
  });
});
