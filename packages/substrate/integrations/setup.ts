// Integration setup contract (§§38-39 + A8 interface, bead xtrm-6qu.6).
//
// The hook/extension migration owns the surfaces that `xt init`/`xt doctor`
// shell to. Callable entry points (TS import or shell JSON):
//   node integrations/setup.ts check --json    full health report, exit 0/1
//   node integrations/setup.ts plan --json     declarative install plan
// Pure functions take explicit roots so tests drive them with temp dirs;
// defaults resolve relative to this file inside the @xtrm/substrate package.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  return { substratePlugins, beadsRemnants, duplicates: new Set(names).size !== names.length || names.length > 1 };
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
  if (verb === "plan") {
    const plan = installPlan();
    if (json) process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    else for (const s of plan.surfaces) process.stdout.write(`${s.surface}: ${s.source} -> ${s.target}\n  ${s.steps.join("\n  ")}\n`);
    process.exit(0);
  }
  const report = fullCheck();
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const c of [...report.claude, ...report.pi]) process.stdout.write(`${c.ok ? "ok" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}\n`);
    process.stdout.write(`naming: ${report.naming.substratePlugins.length} substrate plugin(s)${report.naming.duplicates ? " DUPLICATE" : ""}; beads remnants: ${report.naming.beadsRemnants.join(",") || "none"}\n`);
  }
  process.exit(report.ok ? 0 : 1);
}
