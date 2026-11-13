// XTRM-748: the changelog step is proven without git-cliff and without network.
//
// Every case runs the real script against a fixture CHANGELOG and a stub binary:
// the script's own flags (--changelog/--config/--cliff) exist so this test never
// touches the tracked CHANGELOG.md and never needs git-cliff installed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.ts";

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
function stubCliff(dir: string, body: string, tagBody: string = body): string {
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

interface World {
  dir: string;
  changelog: string;
  config: string;
  cliff: string;
}

// The repo's own temp helper honours SUBSTRATE_TEST_TMP, so scripts/test-tmp-guard.mjs
// sees anything this file leaves behind (CORE-2612).
function world(cliffBody: string, tagBody: string = cliffBody): World {
  const dir = tempDir("xtrm-changelog-");
  const changelog = path.join(dir, "CHANGELOG.md");
  writeFileSync(changelog, HEADER);
  const config = path.join(dir, "cliff.toml");
  writeFileSync(config, "[changelog]\nbody = \"\"\n");
  return { dir, changelog, config, cliff: stubCliff(dir, cliffBody, tagBody) };
}

function run(w: World, args: string[] = []): string {
  const options: ExecFileSyncOptionsWithStringEncoding = { encoding: "utf8", cwd: packageRoot };
  return execFileSync(
    "node",
    [SCRIPT, "--changelog", w.changelog, "--config", w.config, "--cliff", w.cliff, ...args],
    options,
  );
}

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
    let failure: { stderr?: string | Buffer; message?: string } | undefined;
    try {
      execFileSync("node", [SCRIPT, "--changelog", w.changelog, "--config", w.config, "--cliff", path.join(w.dir, "no-such-cliff")], {
        encoding: "utf8",
        cwd: packageRoot,
        stdio: "pipe",
      });
    } catch (e) {
      failure = e as { stderr?: string | Buffer; message?: string };
    }
    assert.ok(failure, "a missing binary must fail the run");
    const stderr = String(failure.stderr ?? "") + String(failure.message ?? "");
    assert.match(stderr, /git-cliff >= 2\.10 is required/);
    assert.match(stderr, /Nothing was written/);
    assert.equal(readFileSync(w.changelog, "utf8"), before, "a failed run must not touch the file");
  });
});
