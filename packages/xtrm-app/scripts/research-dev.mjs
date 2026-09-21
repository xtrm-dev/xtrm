#!/usr/bin/env node
// Start the Vite dev server with the research read surface resolved for *this*
// checkout, so nobody exports paths by hand and nobody accidentally reads
// another worktree's research package.
//
// The bridge (server/research-cli.ts) shells out to the `xtrm-research` CLI and
// reads two directories:
//
//   XTRM_RESEARCH_BIN             the CLI to run
//   XTRM_RESEARCH_ROOT            the published runs root
//   XTRM_RESEARCH_REGISTRY_ROOT   the versioned registry definitions
//
// All three default to this checkout (`packages/research/.venv/bin/xtrm-research`,
// `../research/registry`, `~/.xtrm/research/runs`) and can be overridden per flag
// or environment variable. Without the registry root the run page cannot resolve
// a run's Experiment / Workload / QuestionSpec definitions, and without the bin
// it silently reads whatever `xtrm-research` happens to be on PATH — usually
// another worktree, which is the trap this script exists to remove.
//
// This script is the release-identity record: it prints the UI commit, the
// resolved CLI path, version and source commit, and both roots, and it refuses
// to start when the resolved CLI does not belong to this checkout or does not
// advertise the read verbs the bridge calls.
//
//   npm run research:dev                       # live, resolved for this checkout
//   npm run research:dev -- --fixture          # UI only, served from the fixture
//   npm run research:dev -- --runs DIR         # a different runs root
//   npm run research:dev -- --port 5180         # other flags go to Vite

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "..", "..");
const researchDir = resolve(repoRoot, "packages", "research");

// Own flags are consumed here; anything else (--port, --host, …) is forwarded
// to Vite, so `npm run research:dev -- --port 5201` does what you expect.
const OWN_WITH_VALUE = new Set(["--runs", "--registry"]);
const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fixture = argv.includes("--fixture");
const passthrough = argv.filter((arg, i) => {
  if (OWN_WITH_VALUE.has(arg)) return false;
  if (i > 0 && OWN_WITH_VALUE.has(argv[i - 1])) return false;
  return arg !== "--fixture" && arg !== "--";
});

const bin = process.env.XTRM_RESEARCH_BIN ?? resolve(researchDir, ".venv", "bin", "xtrm-research");
const runsRoot = value("--runs") ?? process.env.XTRM_RESEARCH_ROOT ?? resolve(homedir(), ".xtrm", "research", "runs");
const registryRoot = value("--registry") ?? process.env.XTRM_RESEARCH_REGISTRY_ROOT ?? resolve(researchDir, "registry");

const fail = (lines) => {
  console.error("\n  research:dev cannot start:\n");
  for (const line of lines) console.error(`    ${line}`);
  console.error("");
  process.exit(1);
};

const git = (dir, ...args) => {
  const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
};
const realpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** The CLI's own version, read by running the interpreter its shebang names. */
function cliVersion(binPath) {
  if (!binPath) return null;
  let interpreter = null;
  try {
    const first = readFileSync(binPath, "utf8").split("\n")[0];
    if (first.startsWith("#!")) interpreter = first.slice(2).trim();
  } catch {
    return null;
  }
  if (!interpreter) return null;
  const out = spawnSync(interpreter, ["-c", "import xtrm_research; print(xtrm_research.__version__)"], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
}

const uiCommit = git(appDir, "rev-parse", "--short", "HEAD");
const appRepoRoot = git(appDir, "rev-parse", "--show-toplevel");

let cliReal = null;
let cliRepoRoot = null;
let cliCommit = null;
let cliVer = null;

if (!fixture) {
  const problems = [];
  if (!existsSync(bin)) {
    problems.push(`no research CLI at ${bin}`);
    problems.push(`  → create it:  cd packages/research && python3 -m venv .venv && ./.venv/bin/pip install -e '.[dev]'`);
  }
  if (!existsSync(registryRoot)) problems.push(`no registry at ${registryRoot}`);
  if (!existsSync(runsRoot)) {
    problems.push(`no runs root at ${runsRoot} (the run list will be empty until a campaign publishes)`);
  } else if (!statSync(runsRoot).isDirectory()) {
    problems.push(`runs root is not a directory: ${runsRoot}`);
  }
  if (problems.some((p) => p.startsWith("no research CLI") || p.startsWith("no registry"))) {
    fail(problems);
  } else if (problems.length) {
    console.warn(`\n  research:dev warning:\n${problems.map((p) => `    ${p}`).join("\n")}\n`);
  }

  cliReal = realpath(bin);
  cliRepoRoot = cliReal ? git(dirname(cliReal), "rev-parse", "--show-toplevel") : null;
  cliCommit = cliRepoRoot ? git(cliRepoRoot, "rev-parse", "--short", "HEAD") : null;
  cliVer = cliVersion(cliReal ?? bin);

  // Release identity: the binary must belong to this app's checkout. A same-repo
  // sibling worktree (the ambient-symlink trap) is still a different checkout at a
  // different commit, and is refused here rather than surfacing as 400s later.
  if (appRepoRoot && cliRepoRoot && cliRepoRoot !== appRepoRoot) {
    fail([
      "the resolved research CLI belongs to a different checkout than this app:",
      `  app checkout   ${appRepoRoot} @ ${uiCommit ?? "unknown"}`,
      `  CLI checkout   ${cliRepoRoot} @ ${cliCommit ?? "unknown"}`,
      `  resolved CLI   ${cliReal ?? bin}`,
      "  → run `npm run research:dev` with no XTRM_RESEARCH_BIN override, or point it at this checkout's CLI",
    ]);
  }

  // Capability handshake: a CLI release that predates a read verb the bridge calls
  // cannot serve the UI, and must fail here with the missing verbs named.
  const REQUIRED_VERBS = ["runs", "run", "experiment", "workload", "question-spec", "tail", "metrics", "compare", "chart-data", "experiments", "samples"];
  const help = spawnSync(bin, ["--help"], { encoding: "utf8" });
  const helpText = `${help.stdout ?? ""}${help.stderr ?? ""}`;
  const missing = REQUIRED_VERBS.filter((verb) => !helpText.includes(verb));
  if (missing.length > 0) {
    fail([
      `the research CLI at ${cliReal ?? bin} does not support every read verb this app calls`,
      `  missing verbs  ${missing.join(", ")}`,
      `  CLI            ${cliReal ?? bin}${cliVer ? ` (xtrm-research ${cliVer})` : ""}`,
      "  → rebuild this checkout's CLI: cd packages/research && ./.venv/bin/pip install -e '.[dev]'",
    ]);
  }

  // The trap: a different `xtrm-research` earlier on PATH is what the bridge
  // would use if XTRM_RESEARCH_BIN were unset.
  const onPath = spawnSync("which", ["xtrm-research"], { encoding: "utf8" }).stdout?.trim();
  if (onPath && onPath !== bin) {
    console.warn(
      `\n  research:dev note:\n    \`xtrm-research\` on PATH is ${onPath}\n` +
        `    this run uses ${bin} (set XTRM_RESEARCH_BIN to change that)\n`,
    );
  }
}

const env = {
  ...process.env,
  VITE_XTRM_RESEARCH: fixture ? "fixture" : "live",
  ...(fixture ? {} : { XTRM_RESEARCH_BIN: bin, XTRM_RESEARCH_ROOT: runsRoot, XTRM_RESEARCH_REGISTRY_ROOT: registryRoot }),
};

if (fixture) {
  console.log(`
  research:dev — release identity
    source                      fixture (no runs root or CLI needed)
    ui commit                   ${uiCommit ?? "unknown"}
    VITE_XTRM_RESEARCH=fixture
`);
} else {
  console.log(`
  research:dev — release identity
    source                      live
    ui commit                   ${uiCommit ?? "unknown"} (${appDir})
    research CLI                ${cliReal ?? bin}${cliVer ? ` (xtrm-research ${cliVer})` : ""}
    CLI source commit           ${cliCommit ?? "not a git checkout"}${cliRepoRoot ? ` (${cliRepoRoot})` : ""}
    VITE_XTRM_RESEARCH=live
    XTRM_RESEARCH_BIN=${bin}
    XTRM_RESEARCH_ROOT=${runsRoot}
    XTRM_RESEARCH_REGISTRY_ROOT=${registryRoot}
`);
}

const child = spawn("npx", ["vite", ...passthrough], { cwd: appDir, env, stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
