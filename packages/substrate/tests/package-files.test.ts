// XTRM-768: the published package must ship hooks/.
//
// core's trailer chaining (CORE-2570) resolves the chained entry as
// `<substrate root>/hooks/prepare-commit-msg.ts` from the `integrations/setup.ts`
// it already finds. A tarball without hooks/ therefore installs nothing and
// reports "substrate prepare-commit-msg not found" on an npm-only machine, so
// the files list is a contract and this test reads the packed manifest rather
// than the working tree: `npm pack --dry-run` is what npm would actually ship.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PKG = join(import.meta.dirname, "..");

// Every hook file core can resolve, plus the module the hooks share.
const REQUIRED = [
  "hooks/prepare-commit-msg.ts",
  "hooks/post-commit.ts",
  "hooks/post-rewrite.ts",
  "hooks/remote.ts",
];

interface PackEntry {
  path: string;
}

function packedPaths(): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PKG,
    encoding: "utf8",
    // npm's own lifecycle output can be noisy; --json keeps stdout parseable.
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out) as Array<{ files: PackEntry[] }>;
  return parsed[0]!.files.map((f) => f.path);
}

describe("published package contents (XTRM-768)", () => {
  // The release artifact is not the source tarball: scripts/release.mjs emits
  // JavaScript into dist/ and deletes the files list, so a hook that is only in
  // `files` ships in a source-shaped pack and vanishes from the real release.
  // core resolves either `<root>/hooks/prepare-commit-msg.ts` or
  // `<root>/dist/hooks/prepare-commit-msg.js`, so the build include is the
  // second half of the contract and is pinned here.
  it("compiles hooks into the release emit", () => {
    const build = JSON.parse(readFileSync(join(PKG, "tsconfig.build.json"), "utf8")) as { include: string[] };
    assert.ok(
      build.include.some((p) => p.startsWith("hooks/")),
      `tsconfig.build.json include must cover hooks/ (has ${build.include.join(", ")}); otherwise dist/hooks/prepare-commit-msg.js is never emitted`,
    );
    // The resolver walks up from the integrations entry, so both directories
    // have to be in the emit or the upgrade path silently loses the hook again.
    assert.ok(build.include.some((p) => p.startsWith("integrations/")), "the emit must keep integrations/");
  });

  it("ships every hook file core resolves", () => {
    const paths = new Set(packedPaths());
    const missing = REQUIRED.filter((p) => !paths.has(p));
    assert.deepEqual(missing, [], `the tarball is missing ${missing.join(", ")}; add "hooks" to package.json files`);
  });

  it("ships the integrations the hook resolver starts from", () => {
    // The resolver walks up from integrations/setup.ts to the package root, so
    // both halves have to travel together; one without the other is useless.
    const paths = new Set(packedPaths());
    assert.ok(paths.has("integrations/setup.ts"), "integrations/setup.ts must ship");
  });

  it("keeps the manifest and the tarball in agreement", () => {
    const paths = new Set(packedPaths());
    for (const p of paths) {
      assert.ok(!p.startsWith("node_modules/"), `the tarball must not carry ${p}`);
      assert.ok(!p.startsWith("tests/"), `the tarball must not carry ${p}`);
    }
  });
});
