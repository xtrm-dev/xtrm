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
//   npm run research:dev                       # live, resolved for this checkout
//   npm run research:dev -- --fixture          # UI only, served from the fixture
//   npm run research:dev -- --runs DIR         # a different runs root
//   npm run research:dev -- --port 5180         # other flags go to Vite

import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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

console.log(`
  research:dev
    source        ${fixture ? "fixture (no runs root needed)" : "live"}
${fixture ? "" : `    research CLI  ${bin}
    runs root     ${runsRoot}
    registry      ${registryRoot}
`}`);

const child = spawn("npx", ["vite", ...passthrough], { cwd: appDir, env, stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
