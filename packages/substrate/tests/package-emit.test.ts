// XTRM-372.7: the published artifact must ship JavaScript.
//
// An installed copy lives under node_modules, where Node refuses to strip
// TypeScript types (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING; no flag lifts
// it), so a tarball with TypeScript entry points installs and then crashes. The
// split this file pins down:
//
//   - the checked-in manifest keeps TypeScript entry points, because the live
//     tree is consumed by symlink, where a dist/-based manifest would require a
//     build that can go stale;
//   - the release path rewrites those fields to the compiled emit, so the
//     tarball is runnable on Node.
//
// These assertions are cheap and do not build. The behavioural proof (a clean
// install of the packed tarball under both engines) is `npm run release:verify`.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const manifest = JSON.parse(read("package.json")) as Record<string, any>;

describe("package emit (XTRM-372.7)", () => {
  it("keeps TypeScript entry points in the checked-in manifest (checkout contract)", () => {
    assert.ok(manifest.main.endsWith(".ts"), `main must stay TypeScript for the symlink deployment, got ${manifest.main}`);
    assert.ok(manifest.bin.sb.endsWith(".ts"), `bin.sb must stay TypeScript for the symlink deployment, got ${manifest.bin.sb}`);
    assert.ok(!manifest.files.includes("dist"), "dist/ is a build output and must not be published from the tree");
  });

  it("builds the emit with Node-resolvable specifiers", () => {
    const build = JSON.parse(read("tsconfig.build.json"));
    const o = build.compilerOptions;
    assert.equal(o.noEmit, false, "the build config must emit");
    assert.equal(o.outDir, "dist");
    assert.equal(o.rewriteRelativeImportExtensions, true, "without this the emit keeps .ts specifiers and Node cannot load it");
    // The shipped entry points: the CLI, the library and the plugin seam.
    assert.deepEqual([...build.include].sort(), ["cli/**/*.ts", "integrations/**/*.ts", "src/**/*.ts"]);
    assert.ok(build.exclude.includes("tests/**/*.ts"), "tests are not part of the artifact");
  });

  it("routes publishing through the release script, never a bare npm publish", () => {
    assert.ok(existsSync(join(ROOT, "scripts", "release.mjs")), "scripts/release.mjs must exist");
    assert.match(manifest.scripts.release, /scripts\/release\.mjs/, "npm run release must go through the emit-aware release path");
    // A bare `npm publish` would ship the TypeScript manifest and re-break Node consumers.
    assert.doesNotMatch(manifest.scripts.release, /^npm publish/);
  });

  it("refuses a bare npm publish, which would ship the TypeScript manifest", () => {
    assert.ok(manifest.scripts.prepublishOnly, "without prepublishOnly a bare `npm publish` in this directory ships the TypeScript manifest");
    assert.match(manifest.scripts.prepublishOnly, /process\.exit\(1\)/, "the guard must fail closed");
    assert.doesNotMatch(manifest.scripts.prepublishOnly, /release\.mjs --publish/, "the guard must not recurse into the release path");
  });

  it("ships no TypeScript entry in the plugin, which runs from node_modules locations", () => {
    // A .ts entry here cannot be loaded by Node once the package is installed
    // (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and release --verify now
    // spawns exactly what .mcp.json declares.
    const dir = join(ROOT, "plugin", "substrate", "scripts");
    const ts = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    assert.deepEqual(ts, [], `plugin entry scripts must be loadable JavaScript, found ${ts.join(", ")}`);
    const mcp = JSON.parse(readFileSync(join(ROOT, "plugin", "substrate", ".mcp.json"), "utf8"));
    const arg = mcp.mcpServers.substrate.args[0];
    assert.ok(/\.m?js$/.test(arg), `.mcp.json must spawn a JavaScript entry, got ${arg}`);
  });

  it("release script rewrites manifest paths to the emit and probes both layouts", () => {
    const script = read("scripts/release.mjs");
    assert.match(script, /dist\/\$\{m\[1\]\}/, "release must rewrite src|cli|integrations paths to dist");
    const resolver = read("plugin/substrate/scripts/resolve-substrate.mjs");
    assert.ok(
      resolver.includes("integrations/claude-code/runtime.ts") && resolver.includes("dist/integrations/claude-code/runtime.js"),
      "the plugin seam must probe the source layout and the emitted layout",
    );
  });
});
