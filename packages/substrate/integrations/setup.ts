// Integration setup contract (§§38-39 + A8 interface, beads xtrm-6qu.6 / xtrm-6qu.13).
//
// The hook/extension migration owns the surfaces that `xt init`/`xt doctor`
// shell to. Callable entry points (TS import or shell JSON):
//   node integrations/setup.ts check --json    full health report, exit 0/1
//   node integrations/setup.ts plan --json     declarative install plan
// Pure functions take explicit roots so tests drive them with temp dirs;
// defaults resolve relative to this file inside the @jaggerxtrm/substrate package.
//
// A8 native enrollment (xtrm-6qu.13): XTRM_SUBSTRATE_DIR (or --dir) selects an
// authorized local checkout. resolveSubstrateDir validates it fail-closed
// (absolute, exists, package.json name === @jaggerxtrm/substrate, required layout,
// realpath-canonicalized) BEFORE any command is emitted, so
// wrong-package/missing-path failures never mutate. planCommands emits
// deterministic non-interactive native commands in run order: `npm ci`
// (deterministic source deps) + global link (PATH `sb`) + literal
// `sb --version` + `pi install <dir> --approve` + claude marketplace
// add/install + `claude validate --strict` x2 + a model-free Pi load probe
// (integrations/pi-load-check.ts: SDK loader + in-memory session assert the
// 8 tools register with zero relevant extension errors). checkEnrollment verifies
// ACTUAL enrollment (PATH `sb` resolving to this checkout, Pi settings,
// Claude marketplace binding, exact substrate@substrate installed+enabled,
// live strict validation, no Beads package/extension/hook remnants) — not
// source presence alone. Live subprocesses run under the SUPPLIED home
// (HOME threaded, CLAUDE_CONFIG_DIR dropped), never the process HOME, and
// `xt doctor` stays model-call-free: the Pi load probe runs once at init.
//
// JSON shape stability vs #168: `plan --json` keeps `surfaces` verbatim and
// adds `dir` + `commands`. `check --json` keeps `ok/claude/pi/naming`
// verbatim and adds `dir` + `enrollment`. Consumers reading the #168 keys
// keep working; new consumers read the additive keys.

import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { packageRoot } from "../src/package-root.ts";
import { armPipeDrain } from "./write-and-exit.ts";

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const PKG_ROOT = packageRoot();
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

// -- §7 plugin naming: one substrate per surface -----------------------------
// Probes the live Claude install registry plus the Pi package list. Names
// are normalized to logical surface identities (`claude:substrate`,
// `pi:substrate`): two different Pi checkout paths are the SAME logical
// install, so duplicates means >1 within either surface. Exactly one Pi +
// one Claude is the designed dual-surface state and never a duplicate.
// Files that exist but cannot be read/parsed are recorded in
// `inspectionErrors` (missing files are fine); absence proofs must fail
// closed when inspection was impossible.

export interface NamingProbe {
  substratePlugins: Array<{ name: string; source: string }>;
  beadsRemnants: string[];
  duplicates: boolean;
  inspectionErrors: string[];
}

export function probeInstalledPlugins(home: string = homedir()): NamingProbe {
  const substratePlugins: NamingProbe["substratePlugins"] = [];
  const beadsRemnants: string[] = [];
  const inspectionErrors: string[] = [];
  const registry = join(home, ".claude", "plugins", "installed_plugins.json");
  if (existsSync(registry)) {
    try {
      const data = JSON.parse(readFileSync(registry, "utf8")) as { plugins?: Record<string, Array<{ installPath?: string }>> };
      for (const [key, installs] of Object.entries(data.plugins ?? {})) {
        const short = key.split("@")[0] ?? key;
        if (/substrate/i.test(short)) {
          for (const inst of installs) substratePlugins.push({ name: "claude:substrate", source: inst.installPath ?? "unknown" });
        }
        if (/beads/i.test(short)) beadsRemnants.push(short);
      }
    } catch {
      inspectionErrors.push(registry);
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
      inspectionErrors.push(known);
    }
  }
  const piSettings = join(home, ".pi", "agent", "settings.json");
  if (existsSync(piSettings)) {
    try {
      const data = JSON.parse(readFileSync(piSettings, "utf8")) as { packages?: unknown[] };
      for (const p of data.packages ?? []) {
        if (typeof p === "string" && /substrate/i.test(p)) substratePlugins.push({ name: "pi:substrate", source: "pi-packages" });
        if (typeof p === "string" && /beads/i.test(p)) beadsRemnants.push(`pi:${p}`);
      }
    } catch {
      inspectionErrors.push(piSettings);
    }
  }
  const names = substratePlugins.map((s) => s.name);
  // Duplicates means >1 within either surface. Exactly one Pi + one Claude
  // is the designed dual-surface state: it must coexist, otherwise full
  // enrollment could never report healthy (xt doctor passes only when BOTH
  // surfaces are enrolled).
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const duplicates = [...counts.values()].some((c) => c > 1);
  return { substratePlugins, beadsRemnants, duplicates, inspectionErrors };
}

// -- A8 local-checkout contract (xtrm-6qu.13) ----------------------------------
// XTRM_SUBSTRATE_DIR (or --dir / explicit arg) is the ONLY authorized local
// install source. It must be absolute and point at a directory whose
// package.json name is exactly @jaggerxtrm/substrate with the expected layout.
// Resolution is pure validation: it never mutates, so callers must resolve
// BEFORE emitting or running any install command (fail closed pre-mutation).

export const EXPECTED_PACKAGE_NAME = "@jaggerxtrm/substrate";
export const MARKETPLACE_NAME = "substrate";
export const PLUGIN_NAME = "substrate";
export const PLUGIN_SPEC = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export const REQUIRED_LAYOUT = [
  "package.json",
  "cli/sb.ts",
  "integrations/setup.ts",
  "integrations/pi-load-check.ts",
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
        target: "pi extension host (package @jaggerxtrm/substrate)",
        steps: [
          "ensure @jaggerxtrm/substrate is resolvable by the Pi session",
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
// Every command is non-interactive (--ignore-scripts/--no-audit/--no-fund/
// -y/--json/--approve/--scope/--strict). Callers must resolveSubstrateDir
// first; this function assumes `dir` already passed validation and emits no
// diagnostics itself. Shell each entry verbatim as argv (never shell:true),
// in order, aborting on the first nonzero exit. `sb` is provisioned on PATH
// in two steps: deterministic `npm ci` for source deps (global link alone
// leaves uuid et al. missing), then a global link of the checkout, then a
// literal `sb --version`. The final Pi step proves load, not just
// registration: a model-free SDK probe (DefaultResourceLoader +
// in-memory session) asserts the 8 substrate tools register with zero
// relevant extension errors — no provider auth, quota, or network, and no
// model output to interpret (integrations/pi-load-check.ts).

export function planCommands(dir: string): PlannedCommand[] {
  const pluginDir = join(dir, "plugin", "substrate");
  const loadProbe = join(dir, "integrations", "pi-load-check.ts");
  return [
    { label: "install sb dependencies (deterministic)", cmd: "npm", args: ["--prefix", dir, "ci", "--ignore-scripts", "--no-audit", "--no-fund"] },
    { label: "link sb onto PATH", cmd: "npm", args: ["install", "--global", dir, "--ignore-scripts", "--no-audit", "--no-fund"] },
    { label: "verify sb on PATH", cmd: "sb", args: ["--version"] },
    { label: "install Pi package", cmd: "pi", args: ["install", dir, "--approve"] },
    { label: "add Claude marketplace", cmd: "claude", args: ["plugin", "marketplace", "add", dir, "--scope", "user"] },
    { label: "install Claude plugin", cmd: "claude", args: ["plugin", "install", PLUGIN_SPEC, "-s", "user", "-y", "--json"] },
    { label: "strict-validate marketplace", cmd: "claude", args: ["plugin", "validate", dir, "--strict", "--json"] },
    { label: "strict-validate plugin", cmd: "claude", args: ["plugin", "validate", pluginDir, "--strict", "--json"] },
    { label: "verify Pi loads substrate tools", cmd: "node", args: [loadProbe, "--dir", dir, "--json"] },
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

function childEnv(home: string): Record<string, string | undefined> {
  // Thread the SUPPLIED home into the child so live probes observe the
  // checked HOME, never the process HOME. CLAUDE_CONFIG_DIR would override
  // HOME for claude, so it is dropped from the child env.
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  delete env["CLAUDE_CONFIG_DIR"];
  return env;
}

function runRaw(cmd: string, args: string[], opts: { timeoutMs?: number; home?: string } = {}): { ok: boolean; out: string } {
  const { timeoutMs = 60000, home } = opts;
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      ...(home !== undefined ? { env: childEnv(home) } : {}),
    });
    return { ok: true, out };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, out: msg };
  }
}

function runCapture(cmd: string, args: string[], opts: { timeoutMs?: number; home?: string } = {}): { ok: boolean; out: string } {
  const r = runRaw(cmd, args, opts);
  return { ok: r.ok, out: firstLine(r.out) };
}

function runJson(cmd: string, args: string[], home: string, timeoutMs = 60000): { ok: boolean; value?: unknown } {
  const r = runRaw(cmd, args, { timeoutMs, home });
  if (!r.ok) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(r.out) };
  } catch {
    return { ok: false };
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

// sb must work as a literal PATH binary resolving to THIS checkout: the
// plan links the checkout globally after a deterministic `npm ci`, because a
// global link alone leaves runtime deps (uuid et al.) missing. node-direct
// invocation is not accepted as enrollment proof.
function findOnPath(name: string, pathEnv = process.env["PATH"] ?? ""): string | null {
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      const st = statSync(candidate);
      if (st.isFile()) return candidate;
    } catch {
      // not present/executable here — keep scanning
    }
  }
  return null;
}

export function checkSbEnrolled(pkgRoot: string = PKG_ROOT): Check {
  if (!existsSync(join(pkgRoot, "node_modules"))) {
    return { name: "sb-enrolled", ok: false, detail: "node_modules missing: run the `npm ci` plan step first" };
  }
  const found = findOnPath("sb");
  if (found === null) return { name: "sb-enrolled", ok: false, detail: "no `sb` on PATH: run the global-link plan step first" };
  const expected = join(pkgRoot, "cli", "sb.ts");
  if (!samePath(found, expected)) {
    return { name: "sb-enrolled", ok: false, detail: "PATH `sb` resolves elsewhere, not to this checkout" };
  }
  const r = runCapture("sb", ["--version"]);
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

// The plugin must be exactly substrate@substrate. Installed copies live in
// a Claude cache dir (installPath never equals the checkout), so provenance
// is proven by the marketplace binding: the `substrate` marketplace must be
// registered AT this checkout (checkClaudeMarketplaceEnrolled). Evidence
// order: live `claude plugin list --json` (exact id, enabled) first, then
// the on-disk registry with the marketplace cross-check.
export function checkClaudePluginEnrolled(pkgRoot: string = PKG_ROOT, home: string = homedir()): Check {
  const live = runJson("claude", ["plugin", "list", "--json"], home);
  if (live.ok && Array.isArray(live.value)) {
    const hit = (live.value as Array<{ id?: unknown; enabled?: unknown }>).some((p) => p.id === PLUGIN_SPEC && p.enabled !== false);
    if (hit) return { name: "claude-plugin-enrolled", ok: true, detail: `live: plugin ${PLUGIN_SPEC} installed and enabled` };
  }
  const registry = join(home, ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(registry)) return { name: "claude-plugin-enrolled", ok: false, detail: `plugin ${PLUGIN_SPEC} not installed` };
  const parsed = readJson(registry);
  const plugins = ((parsed.value ?? {}) as { plugins?: Record<string, unknown> }).plugins ?? {};
  if (!parsed.ok || !(PLUGIN_SPEC in plugins)) {
    return { name: "claude-plugin-enrolled", ok: false, detail: `plugin ${PLUGIN_SPEC} not installed` };
  }
  const bound = checkClaudeMarketplaceEnrolled(pkgRoot, home).ok;
  return {
    name: "claude-plugin-enrolled",
    ok: bound,
    detail: bound
      ? `registry: plugin ${PLUGIN_SPEC} installed, marketplace bound to the checkout`
      : `plugin ${PLUGIN_SPEC} registered but marketplace ${MARKETPLACE_NAME} does not point at this checkout`,
  };
}

export function checkClaudeStrictLive(pkgRoot: string = PKG_ROOT, home: string = homedir()): Check {
  const mkt = runCapture("claude", ["plugin", "validate", pkgRoot, "--strict", "--json"], { home });
  if (!mkt.ok) return { name: "claude-strict-live", ok: false, detail: `marketplace strict validation failed: ${mkt.out}` };
  const plg = runCapture("claude", ["plugin", "validate", join(pkgRoot, "plugin", "substrate"), "--strict", "--json"], { home });
  return { name: "claude-strict-live", ok: plg.ok, detail: plg.ok ? "marketplace + plugin strict-validate green" : `plugin strict validation failed: ${plg.out}` };
}

// Beads absence covers every home-scoped Beads surface, not just names:
// installed packages/marketplaces (probe), Pi settings extensions + hook
// commands, Claude settings hook commands + plugin keys, and installed
// plugin/marketplace dir names. Any /beads/i hit fails the check.
function collectBeadsStrings(value: unknown, path: string, out: string[]): void {
  if (typeof value === "string") {
    if (/beads/i.test(value)) out.push(`${path}: ${value.slice(0, 120)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectBeadsStrings(v, `${path}[${i}]`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/beads/i.test(k)) out.push(`${path}.${k}`);
      collectBeadsStrings(v, `${path}.${k}`, out);
    }
  }
}

export function checkBeadsAbsent(home: string = homedir()): Check {
  const naming = probeInstalledPlugins(home);
  const remnants = [...naming.beadsRemnants];
  const uninspectable = [...naming.inspectionErrors];
  const readJsonStrict = (path: string): unknown => {
    // Missing files are fine (fresh HOME); existing-but-unreadable files
    // fail the absence proof closed: hooks could hide where we cannot look.
    if (!existsSync(path)) return null;
    const parsed = readJson(path);
    if (!parsed.ok) uninspectable.push(path);
    return parsed.ok ? parsed.value : null;
  };
  const piSettings = join(home, ".pi", "agent", "settings.json");
  const piValue = readJsonStrict(piSettings);
  if (piValue !== null && typeof piValue === "object") {
    const { packages: _packages, ...rest } = piValue as Record<string, unknown>;
    void _packages;
    collectBeadsStrings(rest, "pi-settings", remnants);
  }
  for (const settingsFile of [join(home, ".claude", "settings.json"), join(home, ".claude.json")]) {
    const value = readJsonStrict(settingsFile);
    if (value !== null && value !== undefined) {
      collectBeadsStrings(value, settingsFile.endsWith(".claude.json") ? "claude.json" : "claude-settings", remnants);
    }
  }
  for (const sub of ["marketplaces", "cache"]) {
    const dir = join(home, ".claude", "plugins", sub);
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (/beads/i.test(entry)) remnants.push(`plugins/${sub}/${entry}`);
      }
    } catch {
      uninspectable.push(dir);
    }
  }
  if (uninspectable.length > 0) {
    return { name: "beads-absent", ok: false, detail: `could not inspect (fail closed): ${[...new Set(uninspectable)].slice(0, 5).join(", ")}` };
  }
  return { name: "beads-absent", ok: remnants.length === 0, detail: remnants.length === 0 ? "no Beads package/extension/hook remnants" : `Beads remnants: ${remnants.slice(0, 10).join(", ")}` };
}

export function checkEnrollment(pkgRoot: string = PKG_ROOT, home: string = homedir()): Check[] {
  return [
    checkSbEnrolled(pkgRoot),
    checkPiEnrolled(pkgRoot, home),
    checkClaudeMarketplaceEnrolled(pkgRoot, home),
    checkClaudePluginEnrolled(pkgRoot, home),
    checkClaudeStrictLive(pkgRoot, home),
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

const invokedAsMain = process.argv[1]?.endsWith("setup.ts") || process.argv[1]?.endsWith("setup.js") || false;
if (invokedAsMain) {
  // XTRM-335: every exit below drains (exitCode + natural return). The usage
  // guards halt via else-branching, not forced exit, so even their short
  // error lines are never cut off on a pipe.
  armPipeDrain();
  const verb = process.argv[2] ?? "check";
  const json = process.argv.includes("--json");
  const dirFlag = process.argv.indexOf("--dir");
  const dirRaw = dirFlag >= 0 ? process.argv[dirFlag + 1] : undefined;
  // A trailing `--dir` (or one followed by another flag) carries no value:
  // reject explicitly instead of silently falling back (O6). Absolute paths
  // never start with `--`, so a flag-like token is always a missing value.
  if (dirFlag >= 0 && (dirRaw === undefined || dirRaw.startsWith("--"))) {
    process.stderr.write(`${verb}: --dir requires an absolute path value\n`);
    process.exitCode = 2;
  } else {
    setupMain(verb, json, dirRaw);
  }
}

// XTRM-335: main body as a function so usage-error paths halt with `return`
// after setting exitCode (drain) instead of process.exit() (truncate).
function setupMain(verb: string, json: boolean, dirRaw: string | undefined): void {
  const dirOpt = dirRaw;
  const resolved = resolveSubstrateDir(dirOpt);
  // --dir/XTRM_SUBSTRATE_DIR is authoritative when present; otherwise fall
  // back to the in-package defaults so #168 consumers keep working. An
  // explicit-but-invalid dir fails closed (exit 2) for both verbs: running
  // plan/check against a different checkout would be a silent wrong-target.
  if (!resolved.ok && (dirOpt !== undefined || process.env["XTRM_SUBSTRATE_DIR"] !== undefined)) {
    process.stderr.write(`${verb}: ${resolved.error}\n`);
    process.exitCode = 2;
    return;
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
    // XTRM-335: plan/check payloads scale with the enumerated inventory, so
    // exit via exitCode and let the pipe drain instead of truncating it.
    process.exitCode = 0;
  } else {
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
    // XTRM-335: `check --json` scales with the home inventory (naming probe
    // echoes every remnant entry), so this is the plausible >64 KiB path:
    // exitCode + natural drain, exit code unchanged (0 healthy, 1 otherwise).
    process.exitCode = report.ok && enrolled ? 0 : 1;
  }
}
