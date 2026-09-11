// Integration setup contract (§§38-39 + A8 interface, beads xtrm-6qu.6 / xtrm-6qu.13).
//
// The hook/extension migration owns the surfaces that `xt init`/`xt doctor`
// shell to. Callable entry points (TS import or shell JSON):
//   node integrations/setup.ts check --json    full health report, exit 0/1
//   node integrations/setup.ts plan --json     declarative install plan
// Pure functions take explicit roots so tests drive them with temp dirs;
// defaults resolve relative to this file inside the @xtrm/substrate package.
//
// A8 native enrollment (xtrm-6qu.13): XTRM_SUBSTRATE_DIR (or --dir) selects an
// authorized local checkout. resolveSubstrateDir validates it fail-closed
// (absolute, exists, package.json name === @xtrm/substrate, required layout)
// BEFORE any command is emitted, so wrong-package/missing-path failures never
// mutate. planCommands emits deterministic non-interactive native commands
// (npm + node sb + `pi install <dir> --approve` + claude marketplace
// add/install + claude validate --strict). checkEnrollment verifies ACTUAL
// enrollment (sb --version runs, Pi settings list the package, Claude
// marketplace + plugin installed, strict validation passes, no Beads
// remnants) — not source presence alone.
//
// JSON shape stability vs #168: `plan --json` keeps `surfaces` verbatim and
// adds `dir` + `commands`. `check --json` keeps `ok/claude/pi/naming`
// verbatim and adds `dir` + `enrollment`. Consumers reading the #168 keys
// keep working; new consumers read the additive keys.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");
const PLUGIN_DIR = join(PKG_ROOT, "plugin", "substrate");

function readJson(path: string): { ok: boolean; value?: unknown; error?: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// -- Claude plugin (packaged dir plugin/substrate) -----------------------------

const REQUIRED_SCRIPTS = [
  "scripts/precompact.mjs",
  "scripts/postcompact.mjs",
  "scripts/session-start.mjs",
  "scripts/session-precondition.mjs",
  "scripts/substrate-mcp.ts",
  "scripts/edit-gate.mjs",
  "scripts/commit-check.mjs",
  "scripts/stop-gate.mjs",
];

export function checkClaudePlugin(pluginDir: string = PLUGIN_DIR): Check[] {
  const checks: Check[] = [];
  const manifest = readJson(join(pluginDir, ".claude-plugin", "plugin.json"));
  const body = (manifest.value ?? {}) as Record<string, unknown>;
  checks.push({
    name: "plugin-manifest",
    ok: manifest.ok && body["name"] === "substrate",
    detail: manifest.ok ? `name=${String(body["name"])}` : manifest.error,
  });
  checks.push({
    name: "plugin-manifest-no-hooks-key",
    ok: manifest.ok && body["hooks"] === undefined,
    detail: "hooks/hooks.json auto-loads; a manifest hooks key double-loads (xtrm-iip.10)",
  });
  const mcp = readJson(join(pluginDir, ".mcp.json"));
  const servers = ((mcp.value ?? {}) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
  checks.push({
    name: "plugin-mcp",
    ok: mcp.ok && "substrate" in servers,
    detail: mcp.ok ? `servers=${Object.keys(servers).join(",")}` : mcp.error,
  });
  const hooks = readJson(join(pluginDir, "hooks", "hooks.json"));
  const events = ((hooks.value ?? {}) as { hooks?: Record<string, unknown> }).hooks ?? {};
  checks.push({
    name: "plugin-hooks",
    ok: hooks.ok && "PreCompact" in events && "SessionStart" in events && "PreToolUse" in events && "Stop" in events,
    detail: hooks.ok ? `events=${Object.keys(events).join(",")}` : hooks.error,
  });
  const missing = REQUIRED_SCRIPTS.filter((s) => !existsSync(join(pluginDir, s)));
  checks.push({ name: "plugin-scripts", ok: missing.length === 0, detail: missing.length === 0 ? `${REQUIRED_SCRIPTS.length} present` : `missing: ${missing.join(",")}` });
  return checks;
}

// -- Pi extension (integrations/pi) --------------------------------------------

export function checkPiExtension(pkgRoot: string = PKG_ROOT): Check[] {
  const checks: Check[] = [];
  const ext = join(pkgRoot, "integrations", "pi", "extension.ts");
  const handlers = join(pkgRoot, "integrations", "pi", "handlers.ts");
  const extSrc = existsSync(ext) ? readFileSync(ext, "utf8") : null;
  checks.push({ name: "pi-extension", ok: extSrc !== null && extSrc.includes("export default function"), detail: extSrc === null ? "extension.ts missing" : "default export present" });
  checks.push({ name: "pi-handlers", ok: existsSync(handlers), detail: existsSync(handlers) ? "handlers.ts present" : "handlers.ts missing" });
  const pkg = readJson(join(pkgRoot, "package.json"));
  const files = ((pkg.value ?? {}) as { files?: unknown }).files;
  checks.push({
    name: "pi-packaged",
    ok: pkg.ok && Array.isArray(files) && (files as unknown[]).includes("integrations"),
    detail: pkg.ok ? `files=${JSON.stringify(files)}` : pkg.error,
  });
  return checks;
}

// -- §7 plugin naming: no two plugins named substrate ---------------------------
// Probes the live Claude install registry plus the Pi package list. Returns
// every installed name matching /substrate/i with its source so xt doctor
// can flag duplicates or stale beads machinery.

export interface NamingProbe {
  substratePlugins: Array<{ name: string; source: string }>;
  beadsRemnants: string[];
  duplicates: boolean;
}

export function probeInstalledPlugins(home: string = homedir()): NamingProbe {
  const substratePlugins: NamingProbe["substratePlugins"] = [];
  const beadsRemnants: string[] = [];
  const registry = join(home, ".claude", "plugins", "installed_plugins.json");
  if (existsSync(registry)) {
    try {
      const data = JSON.parse(readFileSync(registry, "utf8")) as { plugins?: Record<string, Array<{ installPath?: string }>> };
      for (const [key, installs] of Object.entries(data.plugins ?? {})) {
        const short = key.split("@")[0] ?? key;
        if (/substrate/i.test(short)) {
          for (const inst of installs) substratePlugins.push({ name: short, source: inst.installPath ?? "unknown" });
        }
        if (/beads/i.test(short)) beadsRemnants.push(short);
      }
    } catch {
      // corrupt registry degrades to empty, never flips health
    }
  }
  // Marketplaces are available-but-not-installed sources; a beads
  // marketplace lingering here is stale Beads machinery xt doctor flags
  // as `legacy migration required` (A8/A9 consumer).
  const known = join(home, ".claude", "plugins", "known_marketplaces.json");
  if (existsSync(known)) {
    try {
      const data = JSON.parse(readFileSync(known, "utf8")) as Record<string, unknown>;
      for (const key of Object.keys(data)) {
        if (/beads/i.test(key) && !beadsRemnants.includes(key)) beadsRemnants.push(key);
      }
    } catch {
      // best-effort
    }
  }
  const piSettings = join(home, ".pi", "agent", "settings.json");
  if (existsSync(piSettings)) {
    try {
      const data = JSON.parse(readFileSync(piSettings, "utf8")) as { packages?: unknown[] };
      for (const p of data.packages ?? []) {
        if (typeof p === "string" && /substrate/i.test(p)) substratePlugins.push({ name: p, source: "pi-packages" });
        if (typeof p === "string" && /beads/i.test(p)) beadsRemnants.push(`pi:${p}`);
      }
    } catch {
      // best-effort
    }
  }
  const names = substratePlugins.map((s) => s.name.toLowerCase());
  // A true duplicate is the SAME name from two sources (e.g. substrate@a +
  // substrate@b). Mere count > 1 is the designed dual-surface state: the Pi
  // package entry (a path) plus the Claude plugin (name `substrate`) must be
  // able to coexist, otherwise full enrollment could never report healthy
  // (xtrm-6qu.13: `xt doctor` passes only when BOTH surfaces are enrolled).
  return { substratePlugins, beadsRemnants, duplicates: new Set(names).size !== names.length };
}

// -- A8 local-checkout contract (xtrm-6qu.13) ----------------------------------
// XTRM_SUBSTRATE_DIR (or --dir / explicit arg) is the ONLY authorized local
// install source. It must be absolute and point at a directory whose
// package.json name is exactly @xtrm/substrate with the expected layout.
// Resolution is pure validation: it never mutates, so callers must resolve
// BEFORE emitting or running any install command (fail closed pre-mutation).

export const EXPECTED_PACKAGE_NAME = "@xtrm/substrate";
export const MARKETPLACE_NAME = "substrate";
export const PLUGIN_NAME = "substrate";
export const PLUGIN_SPEC = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export const REQUIRED_LAYOUT = [
  "package.json",
  "cli/sb.ts",
  "integrations/setup.ts",
  "integrations/pi/extension.ts",
  "integrations/pi/handlers.ts",
  "plugin/substrate/.claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;

export interface ResolvedDir {
  ok: boolean;
  dir?: string;
  error?: string;
}

export function resolveSubstrateDir(explicit?: string, env: Record<string, string | undefined> = process.env): ResolvedDir {
  const raw = explicit ?? env["XTRM_SUBSTRATE_DIR"];
  if (!raw) return { ok: false, error: "XTRM_SUBSTRATE_DIR is not set (pass --dir <abs-path> or export XTRM_SUBSTRATE_DIR)" };
  if (!isAbsolute(raw)) return { ok: false, error: `XTRM_SUBSTRATE_DIR must be absolute, got: ${raw}` };
  // Canonicalize symlinks so later path comparisons cannot be aliased or
  // evaded (O1): fall back to the normalized input when it does not resolve.
  let dir: string;
  try {
    dir = realpathSync(normalize(raw));
  } catch {
    dir = normalize(raw);
  }
  let st: ReturnType<typeof statSync> | null = null;
  try {
    st = statSync(dir);
  } catch {
    return { ok: false, error: `XTRM_SUBSTRATE_DIR does not exist: ${dir}` };
  }
  if (!st.isDirectory()) return { ok: false, error: `XTRM_SUBSTRATE_DIR is not a directory: ${dir}` };
  const pkg = readJson(join(dir, "package.json"));
  const name = (pkg.value as { name?: unknown } | undefined)?.name;
  if (!pkg.ok || name !== EXPECTED_PACKAGE_NAME) {
    return { ok: false, error: `package identity mismatch at ${dir}: expected name "${EXPECTED_PACKAGE_NAME}", got ${pkg.ok ? JSON.stringify(name) : `unreadable (${pkg.error})`}` };
  }
  const missing = REQUIRED_LAYOUT.filter((rel) => !existsSync(join(dir, rel)));
  if (missing.length > 0) return { ok: false, error: `incomplete substrate checkout at ${dir}: missing ${missing.join(", ")}` };
  return { ok: true, dir };
}

// -- install plan (declarative targets for xt init) ------------------------------

export interface InstallPlan {
  surfaces: Array<{ surface: string; source: string; target: string; steps: string[] }>;
}

export function installPlan(pkgRoot: string = PKG_ROOT): InstallPlan {
  return {
    surfaces: [
      {
        surface: "claude-plugin",
        source: join(pkgRoot, "plugin", "substrate"),
        target: "claude plugin registry (name: substrate)",
        steps: [
          "validate plugin dir with checkClaudePlugin",
          "install via `claude plugin install <marketplace> substrate` or link the source dir",
          "verify with `claude plugin validate --strict`",
        ],
      },
      {
        surface: "pi-extension",
        source: join(pkgRoot, "integrations", "pi", "extension.ts"),
        target: "pi extension host (package @xtrm/substrate)",
        steps: [
          "ensure @xtrm/substrate is resolvable by the Pi session",
          "load integrations/pi/extension.ts as the substrate extension",
          "verify tools substrate_issue_get/search/claim/update + journal + resume register",
        ],
      },
    ],
  };
}

export interface PlannedCommand {
  label: string;
  cmd: string;
  args: string[];
}

// Deterministic native enrollment commands for a VALIDATED checkout dir.
// Every command is non-interactive (--no-audit/--no-fund/-y/--json/--approve
// /--scope/--strict). Callers must resolveSubstrateDir first; this function
// assumes `dir` already passed validation and emits no diagnostics itself.
export function planCommands(dir: string): PlannedCommand[] {
  const pluginDir = join(dir, "plugin", "substrate");
  return [
    { label: "install sb dependencies", cmd: "npm", args: ["--prefix", dir, "install", "--no-audit", "--no-fund"] },
    { label: "verify sb binary", cmd: "node", args: [join(dir, "cli", "sb.ts"), "--version"] },
    { label: "install Pi package", cmd: "pi", args: ["install", dir, "--approve"] },
    { label: "add Claude marketplace", cmd: "claude", args: ["plugin", "marketplace", "add", dir, "--scope", "user"] },
    { label: "install Claude plugin", cmd: "claude", args: ["plugin", "install", PLUGIN_SPEC, "-s", "user", "-y", "--json"] },
    { label: "strict-validate marketplace", cmd: "claude", args: ["plugin", "validate", dir, "--strict", "--json"] },
    { label: "strict-validate plugin", cmd: "claude", args: ["plugin", "validate", pluginDir, "--strict", "--json"] },
  ];
}

export interface InstallResolution {
  ok: boolean;
  dir?: string;
  commands?: PlannedCommand[];
  error?: string;
}

// Fail-closed entry point for `xt init`: validates first, emits commands
// only on success. On failure `commands` is absent so no mutation can start.
export function planInstall(explicit?: string, env: Record<string, string | undefined> = process.env): InstallResolution {
  const resolved = resolveSubstrateDir(explicit, env);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, dir: resolved.dir, commands: planCommands(resolved.dir as string) };
}

// -- enrollment check: actual runtime enrollment, not source presence ---------
// Each probe answers "is it installed and working HERE" against `home`:
// sb runs, Pi settings list the package, Claude marketplace + plugin are
// installed, strict validation passes live, no Beads machinery remains.
// Details carry only short status lines (versions, counts, names) — never
// file contents, tokens, or private source.

function firstLine(s: string): string {
  return s.split("\n", 1)[0]?.slice(0, 200) ?? "";
}

function runCapture(cmd: string, args: string[], timeoutMs = 60000): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out: firstLine(out) };
  } catch (err) {
    const msg = err instanceof Error ? firstLine(err.message) : String(err).slice(0, 200);
    return { ok: false, out: msg };
  }
}

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return normalize(p);
  }
}

function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

export function checkSbEnrolled(pkgRoot: string = PKG_ROOT): Check {
  if (!existsSync(join(pkgRoot, "node_modules"))) {
    return { name: "sb-enrolled", ok: false, detail: "node_modules missing: run `npm --prefix <dir> install` first" };
  }
  const r = runCapture("node", [join(pkgRoot, "cli", "sb.ts"), "--version"]);
  return { name: "sb-enrolled", ok: r.ok, detail: r.ok ? r.out || "sb --version exits 0" : `sb --version failed: ${r.out}` };
}

export function checkPiEnrolled(pkgRoot: string = PKG_ROOT, home: string = homedir()): Check {
  const settingsPath = join(home, ".pi", "agent", "settings.json");
  if (!existsSync(settingsPath)) return { name: "pi-enrolled", ok: false, detail: "no Pi settings (pi install has not run)" };
  const parsed = readJson(settingsPath);
  const pkgs = ((parsed.value ?? {}) as { packages?: unknown }).packages;
  if (!parsed.ok || !Array.isArray(pkgs)) return { name: "pi-enrolled", ok: false, detail: "Pi settings unreadable" };
  const base = dirname(settingsPath);
  const hit = (pkgs as unknown[]).some((p) => typeof p === "string" && (samePath(p, pkgRoot) || samePath(resolve(base, p), pkgRoot)));
  return { name: "pi-enrolled", ok: hit, detail: hit ? "settings packages list the checkout" : "checkout not in Pi settings packages (run `pi install <dir> --approve`)" };
}

export function checkClaudeMarketplaceEnrolled(pkgRoot: string = PKG_ROOT, home: string = homedir()): Check {
  const known = join(home, ".claude", "plugins", "known_marketplaces.json");
  if (!existsSync(known)) return { name: "claude-marketplace-enrolled", ok: false, detail: "no Claude marketplaces (marketplace add has not run)" };
  const parsed = readJson(known);
  const entry = ((parsed.value ?? {}) as Record<string, { source?: { path?: string }; installLocation?: string }>)[MARKETPLACE_NAME];
  if (!parsed.ok || !entry) return { name: "claude-marketplace-enrolled", ok: false, detail: `marketplace "${MARKETPLACE_NAME}" not registered` };
  const loc = entry.source?.path ?? entry.installLocation ?? "";
  const hit = loc !== "" && samePath(loc, pkgRoot);
  return { name: "claude-marketplace-enrolled", ok: hit, detail: hit ? `marketplace ${MARKETPLACE_NAME} points at the checkout` : `marketplace ${MARKETPLACE_NAME} points elsewhere (${loc || "unknown"})` };
}

export function checkClaudePluginEnrolled(home: string = homedir()): Check {
  const registry = join(home, ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(registry)) return { name: "claude-plugin-enrolled", ok: false, detail: "no Claude plugins installed" };
  const parsed = readJson(registry);
  const plugins = ((parsed.value ?? {}) as { plugins?: Record<string, unknown> }).plugins ?? {};
  const hit = Object.keys(plugins).some((k) => (k.split("@")[0] ?? k).toLowerCase() === PLUGIN_NAME);
  return { name: "claude-plugin-enrolled", ok: hit, detail: hit ? `plugin ${PLUGIN_SPEC} installed` : `plugin ${PLUGIN_SPEC} not installed` };
}

export function checkClaudeStrictLive(pkgRoot: string = PKG_ROOT): Check {
  const mkt = runCapture("claude", ["plugin", "validate", pkgRoot, "--strict", "--json"]);
  if (!mkt.ok) return { name: "claude-strict-live", ok: false, detail: `marketplace strict validation failed: ${mkt.out}` };
  const plg = runCapture("claude", ["plugin", "validate", join(pkgRoot, "plugin", "substrate"), "--strict", "--json"]);
  return { name: "claude-strict-live", ok: plg.ok, detail: plg.ok ? "marketplace + plugin strict-validate green" : `plugin strict validation failed: ${plg.out}` };
}

export function checkBeadsAbsent(home: string = homedir()): Check {
  const naming = probeInstalledPlugins(home);
  const remnants = naming.beadsRemnants;
  return { name: "beads-absent", ok: remnants.length === 0, detail: remnants.length === 0 ? "no Beads package/extension/hook remnants" : `Beads remnants: ${remnants.join(", ")}` };
}

export function checkEnrollment(pkgRoot: string = PKG_ROOT, home: string = homedir()): Check[] {
  return [
    checkSbEnrolled(pkgRoot),
    checkPiEnrolled(pkgRoot, home),
    checkClaudeMarketplaceEnrolled(pkgRoot, home),
    checkClaudePluginEnrolled(home),
    checkClaudeStrictLive(pkgRoot),
    checkBeadsAbsent(home),
  ];
}

export function fullCheck(opts: { pluginDir?: string; pkgRoot?: string; home?: string } = {}): { ok: boolean; claude: Check[]; pi: Check[]; naming: NamingProbe } {
  const claude = checkClaudePlugin(opts.pluginDir);
  const pi = checkPiExtension(opts.pkgRoot);
  const naming = probeInstalledPlugins(opts.home);
  const ok = claude.every((c) => c.ok) && pi.every((c) => c.ok) && !naming.duplicates;
  return { ok, claude, pi, naming };
}

const invokedAsMain = process.argv[1]?.endsWith("setup.ts") ?? false;
if (invokedAsMain) {
  const verb = process.argv[2] ?? "check";
  const json = process.argv.includes("--json");
  const dirFlag = process.argv.indexOf("--dir");
  const dirRaw = dirFlag >= 0 ? process.argv[dirFlag + 1] : undefined;
  // A trailing `--dir` (or one followed by another flag) carries no value:
  // reject explicitly instead of silently falling back (O6). Absolute paths
  // never start with `--`, so a flag-like token is always a missing value.
  if (dirFlag >= 0 && (dirRaw === undefined || dirRaw.startsWith("--"))) {
    process.stderr.write(`${verb}: --dir requires an absolute path value\n`);
    process.exit(2);
  }
  const dirOpt = dirRaw;
  const resolved = resolveSubstrateDir(dirOpt);
  // --dir/XTRM_SUBSTRATE_DIR is authoritative when present; otherwise fall
  // back to the in-package defaults so #168 consumers keep working. An
  // explicit-but-invalid dir fails closed (exit 2) for both verbs: running
  // plan/check against a different checkout would be a silent wrong-target.
  if (!resolved.ok && (dirOpt !== undefined || process.env["XTRM_SUBSTRATE_DIR"] !== undefined)) {
    process.stderr.write(`${verb}: ${resolved.error}\n`);
    process.exit(2);
  }
  const pkgRoot = resolved.ok ? (resolved.dir as string) : PKG_ROOT;
  const pluginDir = join(pkgRoot, "plugin", "substrate");
  if (verb === "plan") {
    const plan = installPlan(pkgRoot);
    const out = { ...plan, dir: pkgRoot, commands: planCommands(pkgRoot) };
    if (json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else {
      for (const s of plan.surfaces) process.stdout.write(`${s.surface}: ${s.source} -> ${s.target}\n  ${s.steps.join("\n  ")}\n`);
      for (const c of out.commands) process.stdout.write(`$ ${c.cmd} ${c.args.join(" ")}  # ${c.label}\n`);
    }
    process.exit(0);
  }
  const report = fullCheck({ pluginDir, pkgRoot });
  const enrollment = checkEnrollment(pkgRoot);
  const enrolled = enrollment.every((c) => c.ok);
  const full = { ...report, dir: pkgRoot, enrollment };
  if (json) {
    process.stdout.write(JSON.stringify(full, null, 2) + "\n");
  } else {
    for (const c of [...report.claude, ...report.pi]) process.stdout.write(`${c.ok ? "ok" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}\n`);
    process.stdout.write(`naming: ${report.naming.substratePlugins.length} substrate plugin(s)${report.naming.duplicates ? " DUPLICATE" : ""}; beads remnants: ${report.naming.beadsRemnants.join(",") || "none"}\n`);
    for (const c of enrollment) process.stdout.write(`${c.ok ? "ok" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}\n`);
  }
  process.exit(report.ok && enrolled ? 0 : 1);
}
