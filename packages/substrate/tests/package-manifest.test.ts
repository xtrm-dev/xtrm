import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

// XTRM-749: the installed package must not carry its own copy of a module the
// pi host already loads. pi's extension loader inspects each extension
// package's `dependencies` and warns (and risks duplicate runtime modules) when
// one of them is host-provided:
//
//   Host-provided extension packages must be declared in peerDependencies with
//   a "*" range, not dependencies: typebox.
//
// The set below is copied from pi-coding-agent 1.5.2
// (HOST_PROVIDED_EXTENSION_PACKAGES). It cannot be imported, so a pi upgrade
// that adds a name has to be mirrored here; the test fails loudly if this
// package ever declares one of them as a runtime dependency.

const PKG = join(import.meta.dirname, "..");
const HOST_PROVIDED = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
];

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const source = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as Manifest;

describe("package manifest carries no duplicate host module (XTRM-749)", () => {
  it("declares typebox as an optional peer the host supplies", () => {
    assert.equal(source.devDependencies?.["typebox"], "1.3.27", "the checkout still needs typebox to build and test");
    assert.equal(source.dependencies?.["typebox"], undefined, "typebox must not be a runtime dependency");
    assert.equal(source.peerDependencies?.["typebox"], "*", "typebox must be a peer dependency with the * range the loader expects");
    assert.equal(source.peerDependenciesMeta?.["typebox"]?.optional, true, "a library consumer must not be forced to install typebox");
  });

  it("keeps every host-provided package out of dependencies", () => {
    const offenders = HOST_PROVIDED.filter((name) => source.dependencies?.[name] !== undefined);
    assert.deepEqual(offenders, [], `host-provided packages declared as dependencies: ${offenders.join(", ")}`);
  });

  it("packs that same shape into the artifact release.mjs publishes", () => {
    // release.mjs rewrites the manifest into a staging directory (remapped
    // paths, no devDependencies, no scripts) and packs that, so the source
    // manifest above is not what users install. --out keeps the tarball and
    // never publishes.
    const out = tempDir("substrate-manifest-");
    const stdout = execFileSync(process.execPath, ["scripts/release.mjs", "--out", out], {
      cwd: PKG,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = stdout.split("\n").find((l) => l.startsWith("tarball: "));
    assert.ok(line !== undefined, `release.mjs printed no tarball path:\n${stdout}`);
    const tarball = line.slice("tarball: ".length).trim();
    const packed = JSON.parse(
      execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" }),
    ) as Manifest;
    assert.equal(packed.version, source.version);
    assert.equal(packed.dependencies?.["typebox"], undefined, "the published artifact must not ship typebox");
    assert.equal(packed.peerDependencies?.["typebox"], "*", "the published artifact must ask the host for typebox");
    const offenders = HOST_PROVIDED.filter((name) => packed.dependencies?.[name] !== undefined);
    assert.deepEqual(offenders, [], `published artifact declares host-provided dependencies: ${offenders.join(", ")}`);
    assert.equal(packed.devDependencies, undefined, "the published artifact carries no devDependencies");
  });
});
