#!/usr/bin/env node
/**
 * Release path for @jaggerxtrm/substrate (XTRM-372.7).
 *
 * Why this exists. The checked-in manifest points bin/main at TypeScript, and
 * that is correct for every consumer in this repository: the global `sb`, the
 * specialists link and the Claude plugin all reach the package by symlink, so
 * the resolved path is outside node_modules and Node strips types happily.
 *
 * A *published* copy is different. Installed under node_modules, Node refuses
 * to strip types (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, no flag lifts
 * it), so a tarball shipping TypeScript entry points installs and then crashes
 * on first use. The artifact must ship JavaScript.
 *
 * The two requirements conflict in one manifest, and npm ignores publishConfig
 * overrides for main/bin (verified: the packed manifest keeps the source
 * paths). So this script builds the emit into a temporary directory, assembles
 * a staging package whose manifest points at that emit, and packs or publishes
 * the staging directory.
 *
 * Consequence: the working tree is never modified and no dist/ is left behind.
 * The symlink deployment therefore stays on TypeScript source with no build to
 * run and no build artifact to go stale.
 *
 * Usage:
 *   node scripts/release.mjs              build + pack, print the tarball path
 *   node scripts/release.mjs --verify     pack, then prove the tarball in a clean directory
 *   node scripts/release.mjs --out DIR    also keep the tarball at DIR
 *   node scripts/release.mjs --publish    pack, verify, then npm publish the tarball
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const VERIFY = argv.includes("--verify") || argv.includes("--publish");
const PUBLISH = argv.includes("--publish");
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
// A bare `--out` (or one followed by another flag) must fail closed: silently
// treating it as absent would pack and verify an artifact the caller asked to
// keep, then delete it with the staging directory.
if (argv.includes("--out") && (OUT === undefined || OUT.startsWith("--"))) {
  process.stderr.write("release: --out requires a directory value\n");
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  // An inherited stdout returns null rather than a string: only the piped
  // callers have output to trim.
  const out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
  return out === null ? "" : out.trim();
}

// Every manifest field that names a source file must name its emit instead.
// Deriving this beats enumerating fields: pi.extensions and any field added
// later follow the same rule, and a stale entry cannot be forgotten.
function remapPaths(value) {
  if (typeof value === "string") {
    const m = /^\.?\/?(src|cli|integrations)\/(.+)\.ts$/.exec(value);
    return m ? `./dist/${m[1]}/${m[2]}.js` : value;
  }
  if (Array.isArray(value)) return value.map(remapPaths);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapPaths(v)]));
  }
  return value;
}

const stage = mkdtempSync(join(tmpdir(), "substrate-release-"));
let keep = false;
try {
  // 1. Emit JavaScript for the shipped entry points, into the staging dir.
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "-p", join(ROOT, "tsconfig.build.json"), "--outDir", join(stage, "dist")], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  // 2. Ship exactly the assets the runtime reads: plugin, skills and the README
  //    a consumer sees. No src/ or cli/: the published copy runs the emit.
  for (const asset of ["plugin", "skills"]) {
    cpSync(join(ROOT, asset), join(stage, asset), { recursive: true });
  }
  cpSync(join(ROOT, "README.md"), join(stage, "README.md"));
  cpSync(join(ROOT, ".claude-plugin", "marketplace.json"), join(stage, "marketplace.json"));

  // 3. Staging manifest: every field that points into the package follows the
  //    emit (an installed copy has dist/ and no src, cli or integrations), and
  //    repo-only fields are dropped so the manifest describes only what ships.
  const pkg = remapPaths(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
  delete pkg.files;
  delete pkg.scripts;
  delete pkg.devDependencies;
  pkg.exports = {
    ".": "./dist/src/index.js",
    "./package.json": "./package.json",
    "./*": "./*",
  };
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  // 4. Pack the staging directory.
  const packed = run("npm", ["pack", "--pack-destination", stage], { cwd: stage });
  const built = join(stage, packed.split("\n").pop());

  // 5. Prove the artifact where it will actually live: a clean directory, an
  //    installed copy, under both engines, including the MCP entry that
  //    .mcp.json spawns. This runs BEFORE anything is copied out, so a failed
  //    verification cannot leave a publishable tarball in --out.
  if (VERIFY) {
    const consumer = mkdtempSync(join(tmpdir(), "substrate-consumer-"));
    const home = mkdtempSync(join(tmpdir(), "substrate-home-"));
    try {
      mkdirSync(join(home, ".xtrm"), { recursive: true });
      const env = { ...process.env, HOME: home, SUBSTRATE_DB: join(home, ".xtrm", "state.db") };
      delete env.XTRM_SUBSTRATE_DIR;
      delete env.XTRM_SB_BIN;
      run("git", ["init", "-q"], { cwd: consumer, env }); // `sb init` requires a repository
      run("npm", ["install", "--no-audit", "--no-fund", built], { cwd: consumer, env });
      const installed = join(consumer, "node_modules", "@jaggerxtrm", "substrate");
      const pluginDir = join(installed, "plugin", "substrate");
      const bin = join(consumer, "node_modules", ".bin", "sb");

      const checks = [
        ["node bin --version", () => run(process.execPath, [bin, "--version"], { cwd: consumer, env })],
        ["node bin init", () => run(process.execPath, [bin, "init", "--json"], { cwd: consumer, env })],
        [
          "node library import",
          () =>
            run(process.execPath, ["-e", 'import("@jaggerxtrm/substrate").then(m=>console.log("exports:",Object.keys(m).length))'], {
              cwd: consumer,
              env,
            }),
        ],
        [
          "plugin seam resolves",
          () =>
            run(
              process.execPath,
              [
                "-e",
                `const { resolveSubstrate } = await import(${JSON.stringify(join(pluginDir, "scripts", "resolve-substrate.mjs"))}); const m = await resolveSubstrate("runtime.ts"); console.log("runtime exports:", Object.keys(m).length);`,
              ],
              { cwd: consumer, env },
            ),
        ],
        [
          // The gap that let a TypeScript MCP entry ship unnoticed: the seam
          // check above never touched the file .mcp.json actually spawns.
          "mcp entry spawns as JavaScript",
          () => {
            const declared = JSON.parse(readFileSync(join(pluginDir, ".mcp.json"), "utf8"));
            const arg = String(declared.mcpServers.substrate.args[0]).replace("${CLAUDE_PLUGIN_ROOT}", pluginDir);
            if (!arg.endsWith(".mjs") && !arg.endsWith(".js")) throw new Error(`.mcp.json must spawn a loadable JS entry, got ${arg}`);
            run(process.execPath, ["--check", arg], { cwd: consumer, env });
            return `ok (${arg.slice(arg.lastIndexOf("/") + 1)})`;
          },
        ],
        [
          "no TypeScript entry remains in the shipped plugin",
          () => {
            const stray = readdirSync(join(pluginDir, "scripts")).filter((f) => f.endsWith(".ts"));
            if (stray.length > 0) throw new Error(`shipped plugin scripts still include TypeScript: ${stray.join(", ")}`);
            return "all plugin entry scripts are loadable";
          },
        ],
        ["bun bin --version", () => run("bun", [bin, "--version"], { cwd: consumer, env })],
        [
          "bun library import",
          () =>
            run("bun", ["-e", 'const m = await import("@jaggerxtrm/substrate"); console.log("exports:", Object.keys(m).length)'], {
              cwd: consumer,
              env,
            }),
        ],
      ];
      for (const [label, fn] of checks) {
        process.stdout.write(`  ${label}: ${fn()}\n`);
      }
    } finally {
      rmSync(consumer, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }

  // 6. Keep the artifact: verified first, copied out second.
  let tarball = built;
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    tarball = join(OUT, built.split("/").pop());
    cpSync(built, tarball);
  }
  process.stdout.write(
    tarball === built && !PUBLISH
      ? `tarball: ${built} (temporary: the staging directory is removed on exit; pass --out DIR to keep it)\n`
      : `tarball: ${tarball}\n`,
  );

  // 7. Publish the verified tarball, not a directory: publishing the working
  //    tree would ship the TypeScript manifest again (prepublishOnly refuses
  //    that, and this path is the one that works).
  if (PUBLISH) {
    process.stdout.write(run("npm", ["publish", tarball, "--access", "public", "--tag", "latest"]) + "\n");
    keep = true; // the tarball is the record of what was published
  }
} finally {
  if (!keep) rmSync(stage, { recursive: true, force: true });
}

