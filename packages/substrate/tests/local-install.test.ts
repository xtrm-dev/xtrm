// Local private install + native enrollment contract (bead xtrm-6qu.13):
// package identity + Pi manifest, Claude marketplace metadata, setup.ts
// plan/check fail-closed behavior, and enrollment verification against
// fixture HOME dirs. Scratch dirs stay under /var/tmp (/tmp is a 2G tmpfs).

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPECTED_PACKAGE_NAME,
  MARKETPLACE_NAME,
  PLUGIN_SPEC,
  REQUIRED_LAYOUT,
  checkBeadsAbsent,
  checkClaudeMarketplaceEnrolled,
  checkClaudePluginEnrolled,
  checkEnrollment,
  checkPiEnrolled,
  checkSbEnrolled,
  planCommands,
  planInstall,
  probeInstalledPlugins,
  resolveSubstrateDir,
} from "../integrations/setup.ts";

const PKG_ROOT = new URL("..", import.meta.url).pathname;
const SETUP_TS = new URL("../integrations/setup.ts", import.meta.url).pathname;
const SCRATCH_BASE = "/var/tmp";

const created: string[] = [];

after(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const d = mkdtempSync(join(SCRATCH_BASE, prefix));
  created.push(d);
  return d;
}

describe("local install source (xtrm-6qu.13)", () => {
  it("package identity is @jaggerxtrm/substrate with a canonical Pi manifest", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      name?: string;
      keywords?: string[];
      pi?: { extensions?: string[] };
    };
    assert.equal(pkg.name, EXPECTED_PACKAGE_NAME);
    assert.ok(pkg.keywords?.includes("pi-package"), "keywords must include pi-package");
    assert.ok(Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.length > 0, "pi.extensions must list the extension entry");
    for (const entry of pkg.pi?.extensions ?? []) {
      assert.ok(!entry.startsWith("/") && !entry.startsWith("~"), `pi extension entry must be package-relative, got ${entry}`);
      assert.ok(existsSync(join(PKG_ROOT, entry)), `pi extension entry must exist: ${entry}`);
    }
  });

  it("Claude marketplace metadata is relative, strict-clean, and installable", () => {
    const mktPath = join(PKG_ROOT, ".claude-plugin", "marketplace.json");
    assert.ok(existsSync(mktPath), "marketplace manifest must exist at package root");
    const mkt = JSON.parse(readFileSync(mktPath, "utf8")) as {
      name?: string;
      plugins?: Array<{ name?: string; source?: string }>;
    };
    assert.equal(mkt.name, MARKETPLACE_NAME);
    assert.equal(mkt.plugins?.length, 1);
    const source = mkt.plugins?.[0]?.source ?? "";
    assert.ok(!source.startsWith("/") && !source.includes(":"), `plugin source must be relative, got ${source}`);
    assert.ok(existsSync(join(PKG_ROOT, source, ".claude-plugin", "plugin.json")), "marketplace source must resolve to the plugin dir");
    assert.equal(mkt.plugins?.[0]?.name, "substrate");
  });

  it("resolveSubstrateDir accepts the real checkout via env", () => {
    const r = resolveSubstrateDir(undefined, { XTRM_SUBSTRATE_DIR: PKG_ROOT });
    assert.equal(r.ok, true);
    assert.equal(r.dir, realpathSync(PKG_ROOT));
  });

  it("resolveSubstrateDir fails closed: missing env, relative, absent, wrong package", () => {
    assert.equal(resolveSubstrateDir(undefined, {}).ok, false, "missing env must fail");
    assert.equal(resolveSubstrateDir("relative/path", {}).ok, false, "relative path must fail");
    assert.equal(resolveSubstrateDir(join(SCRATCH_BASE, "sb-no-such-dir-xyz"), {}).ok, false, "absent path must fail");
    const wrong = scratch("sb-wrong-pkg.");
    writeFileSync(join(wrong, "package.json"), JSON.stringify({ name: "@other/pkg" }));
    const r = resolveSubstrateDir(wrong, {});
    assert.equal(r.ok, false, "wrong package name must fail");
    assert.match(r.error ?? "", /@jaggerxtrm\/substrate/, "error names the expected package");
  });

  it("planInstall emits nothing on failure (fail before mutation)", () => {
    const bad = planInstall(join(SCRATCH_BASE, "sb-no-such-dir-xyz"), {});
    assert.equal(bad.ok, false);
    assert.equal(bad.commands, undefined, "no commands may be emitted on failure");
    const wrong = scratch("sb-wrong-plan.");
    writeFileSync(join(wrong, "package.json"), JSON.stringify({ name: "@other/pkg" }));
    const bad2 = planInstall(wrong, {});
    assert.equal(bad2.ok, false);
    assert.equal(bad2.commands, undefined);
  });

  it("planCommands are deterministic, native, and non-interactive", () => {
    const cmds = planCommands(PKG_ROOT);
    const byLabel = Object.fromEntries(cmds.map((c) => [c.label, c]));
    assert.deepEqual(cmds.map((c) => c.cmd), ["npm", "npm", "sb", "pi", "claude", "claude", "claude", "claude", "node"]);
    assert.deepEqual(byLabel["install sb dependencies (deterministic)"].args, ["--prefix", PKG_ROOT, "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
    assert.deepEqual(byLabel["link sb onto PATH"].args, ["install", "--global", PKG_ROOT, "--ignore-scripts", "--no-audit", "--no-fund"]);
    assert.deepEqual(byLabel["verify sb on PATH"].args, ["--version"]);
    assert.deepEqual(byLabel["install Pi package"].args, ["install", PKG_ROOT, "--approve"]);
    assert.deepEqual(byLabel["add Claude marketplace"].args, ["plugin", "marketplace", "add", PKG_ROOT, "--scope", "user"]);
    assert.deepEqual(byLabel["install Claude plugin"].args, ["plugin", "install", PLUGIN_SPEC, "-s", "user", "-y", "--json"]);
    assert.ok(byLabel["strict-validate marketplace"].args.includes("--strict"), "marketplace validation is strict");
    assert.ok(byLabel["strict-validate plugin"].args.includes("--strict"), "plugin validation is strict");
    assert.deepEqual(byLabel["verify Pi loads substrate tools"].args, [join(PKG_ROOT, "integrations", "pi-load-check.ts"), "--dir", PKG_ROOT, "--json"]);
    for (const c of cmds) {
      assert.ok(c.args.every((a) => typeof a === "string" && a.length > 0), "args are concrete strings, no prompting");
      assert.ok(!c.args.includes("--interactive"), "no interactive flags");
    }
    assert.deepEqual(planCommands(PKG_ROOT), cmds, "plan output is deterministic");
  });

  it("missing probe script fails validation before any mutation", () => {
    const dir = scratch("sb-noprobe.");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: EXPECTED_PACKAGE_NAME }));
    for (const rel of REQUIRED_LAYOUT) {
      if (rel === "integrations/pi-load-check.ts") continue;
      if (rel === "package.json") continue;
      const full = join(dir, rel);
      mkdirSync(join(dir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
      writeFileSync(full, rel.endsWith(".json") ? "{}" : "");
    }
    const r = resolveSubstrateDir(dir, {});
    assert.equal(r.ok, false, "checkout without the probe must not validate");
    assert.match(r.error ?? "", /pi-load-check/);
    const plan = planInstall(dir, {});
    assert.equal(plan.ok, false);
    assert.equal(plan.commands, undefined, "no commands may precede probe validation");
  });

  it("duplicates means >1 per surface, not >1 total", () => {
    const home = scratch("sb-dup-home.");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ packages: ["/a/substrate-checkout", "/b/substrate-checkout"] }),
    );
    const twoPi = probeInstalledPlugins(home);
    assert.equal(twoPi.duplicates, true, "two Pi checkouts are the same logical install");
    const mixed = scratch("sb-mixed-home.");
    mkdirSync(join(mixed, ".pi", "agent"), { recursive: true });
    writeFileSync(join(mixed, ".pi", "agent", "settings.json"), JSON.stringify({ packages: [PKG_ROOT] }));
    mkdirSync(join(mixed, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(mixed, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { [`substrate@${MARKETPLACE_NAME}`]: [{ installPath: "/cache/x" }] } }),
    );
    const oneEach = probeInstalledPlugins(mixed);
    assert.equal(oneEach.duplicates, false, "exactly one Pi + one Claude must coexist");
  });

  it("corrupt settings/registries fail absence closed, never pass", () => {
    const home = scratch("sb-corrupt-home.");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), "{not json");
    const badPi = checkBeadsAbsent(home);
    assert.equal(badPi.ok, false, "unreadable Pi settings must fail absence");
    assert.match(badPi.detail ?? "", /could not inspect/);
    const home2 = scratch("sb-corrupt2-home.");
    mkdirSync(join(home2, ".claude", "plugins"), { recursive: true });
    writeFileSync(join(home2, ".claude", "plugins", "installed_plugins.json"), "{not json");
    const badReg = checkBeadsAbsent(home2);
    assert.equal(badReg.ok, false, "unreadable Claude registry must fail absence");
    const home3 = scratch("sb-corrupt3-home.");
    mkdirSync(join(home3, ".claude"), { recursive: true });
    writeFileSync(join(home3, ".claude", "settings.json"), "[broken");
    assert.equal(checkBeadsAbsent(home3).ok, false, "unreadable Claude settings must fail absence");
  });

  it("symlinked checkout aliases still resolve and enroll (realpath)", () => {
    const linkBase = scratch("sb-linkbase.");
    const link = join(linkBase, "substrate-alias");
    symlinkSync(PKG_ROOT, link);
    const r = resolveSubstrateDir(link, {});
    assert.equal(r.ok, true, "symlinked checkout must resolve");
    const home = scratch("sb-alias-home.");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ packages: [link] }));
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({ [MARKETPLACE_NAME]: { source: { source: "directory", path: link }, installLocation: link } }),
    );
    assert.equal(checkPiEnrolled(PKG_ROOT, home).ok, true, "aliased Pi entry must match");
    assert.equal(checkClaudeMarketplaceEnrolled(PKG_ROOT, home).ok, true, "aliased marketplace entry must match");
  });

  it("CLI rejects a missing --dir value explicitly", () => {
    const r = spawnSync("node", [SETUP_TS, "plan", "--dir"], { encoding: "utf8" });
    assert.equal(r.status, 2, "trailing --dir must exit 2, not fall back silently");
    assert.match(r.stderr, /--dir requires/);
  });

  it("sb must be a PATH binary resolving to the manifest-declared entry point", () => {
    const savedPath = process.env["PATH"] ?? "";
    // Derived from the manifest so the expectation cannot drift from the
    // declared bin again (the entry point moved cli/sb.ts -> cli/sb-ux.ts).
    const manifest = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { bin: Record<string, string> };
    const declared = join(PKG_ROOT, manifest.bin["sb"]!);
    assert.equal(declared, join(PKG_ROOT, "cli", "sb-ux.ts"));
    const goodBin = scratch("sb-goodbin.");
    symlinkSync(declared, join(goodBin, "sb"));
    const legacyBin = scratch("sb-legacybin.");
    symlinkSync(join(PKG_ROOT, "cli", "sb.ts"), join(legacyBin, "sb"));
    const foreignBin = scratch("sb-foreignbin.");
    symlinkSync("/bin/true", join(foreignBin, "sb"));
    const emptyBin = scratch("sb-emptybin.");
    try {
      process.env["PATH"] = `${goodBin}:${savedPath}`;
      assert.equal(checkSbEnrolled(PKG_ROOT).ok, true, "sb linked to the declared bin must enroll");
      process.env["PATH"] = `${legacyBin}:${savedPath}`;
      assert.equal(checkSbEnrolled(PKG_ROOT).ok, false, "the pre-redirect cli/sb.ts must not satisfy the declared bin");
      process.env["PATH"] = `${foreignBin}:${savedPath}`;
      const foreign = checkSbEnrolled(PKG_ROOT);
      assert.equal(foreign.ok, false, "sb resolving elsewhere must not enroll");
      assert.match(foreign.detail ?? "", /elsewhere/);
      process.env["PATH"] = `${emptyBin}:/nonexistent-path-xyz`;
      assert.equal(checkSbEnrolled(PKG_ROOT).ok, false, "absent sb must not enroll");
    } finally {
      process.env["PATH"] = savedPath;
    }
  });

  it("enrollment reports not-enrolled under an empty HOME", () => {
    const home = scratch("sb-empty-home.");
    const checks = checkEnrollment(PKG_ROOT, home);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    assert.equal(byName["pi-enrolled"].ok, false);
    assert.equal(byName["claude-marketplace-enrolled"].ok, false);
    assert.equal(byName["claude-plugin-enrolled"].ok, false);
    assert.equal(byName["beads-absent"].ok, true, "empty HOME has no Beads remnants");
  });

  it("enrollment detects Pi/Claude registry fixtures pointing at the checkout", () => {
    const home = scratch("sb-enrolled-home.");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ packages: [PKG_ROOT] }));
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({ [MARKETPLACE_NAME]: { source: { source: "directory", path: PKG_ROOT }, installLocation: PKG_ROOT } }),
    );
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { [`substrate@${MARKETPLACE_NAME}`]: [{ installPath: PKG_ROOT }] } }),
    );
    assert.equal(checkPiEnrolled(PKG_ROOT, home).ok, true);
    assert.equal(checkClaudeMarketplaceEnrolled(PKG_ROOT, home).ok, true);
    assert.equal(checkClaudePluginEnrolled(PKG_ROOT, home).ok, true);
    assert.equal(checkBeadsAbsent(home).ok, true);
  });

  it("plugin from a wrong marketplace does not enroll", () => {
    const home = scratch("sb-wrongmkt-home.");
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({ [MARKETPLACE_NAME]: { source: { source: "directory", path: PKG_ROOT }, installLocation: PKG_ROOT } }),
    );
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "substrate@evil-marketplace": [{ installPath: "/x" }] } }),
    );
    const c = checkClaudePluginEnrolled(PKG_ROOT, home);
    assert.equal(c.ok, false, "substrate from another marketplace must not satisfy the exact spec");
  });

  it("sb-enrolled follows the manifest-declared bin target, not a hardcoded path", () => {
    const root = scratch("sb-enrolled-bin.");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: EXPECTED_PACKAGE_NAME, bin: { sb: "cli/sb-ux.ts" } }));
    mkdirSync(join(root, "cli"), { recursive: true });
    mkdirSync(join(root, "bin"), { recursive: true });
    const ux = join(root, "cli", "sb-ux.ts");
    const legacy = join(root, "cli", "sb.ts");
    writeFileSync(ux, "#!/bin/sh\necho 0.0.0\n");
    writeFileSync(legacy, "#!/bin/sh\necho 0.0.0\n");
    chmodSync(ux, 0o755);
    chmodSync(legacy, 0o755);
    const link = join(root, "bin", "sb");
    symlinkSync(ux, link);
    const savedPath = process.env["PATH"];
    process.env["PATH"] = join(root, "bin");
    try {
      assert.equal(checkSbEnrolled(root).ok, true, "the manifest-declared bin target must enroll");
      rmSync(link);
      symlinkSync(legacy, link);
      assert.equal(checkSbEnrolled(root).ok, false, "a different PATH target must not enroll");
    } finally {
      process.env["PATH"] = savedPath;
    }
  });

  it("Beads hook residue in settings fails the absence check", () => {
    const home = scratch("sb-hookres-home.");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ packages: [], extensions: ["/x/beads-ext"], hooks: { SessionStart: [{ command: "node /x/beads-hook.mjs" }] } }),
    );
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "node /x/beads-compact-restore.mjs" }] }] },
        enabledPlugins: { "beads@beads-marketplace": true },
      }),
    );
    const beads = checkBeadsAbsent(home);
    assert.equal(beads.ok, false, "hook/extension/plugin residue must fail");
    assert.match(beads.detail ?? "", /beads/i);
  });

  it("explicit home governs, not the process HOME", () => {
    const enrolled = scratch("sb-gov-enrolled.");
    mkdirSync(join(enrolled, ".pi", "agent"), { recursive: true });
    writeFileSync(join(enrolled, ".pi", "agent", "settings.json"), JSON.stringify({ packages: [PKG_ROOT] }));
    const empty = scratch("sb-gov-empty.");
    const savedHome = process.env["HOME"];
    process.env["HOME"] = empty;
    try {
      assert.equal(checkPiEnrolled(PKG_ROOT, enrolled).ok, true, "explicit home must win over process HOME");
      assert.equal(checkPiEnrolled(PKG_ROOT, empty).ok, false);
    } finally {
      if (savedHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = savedHome;
    }
  });

  it("enrollment rejects registries pointing elsewhere and flags Beads remnants", () => {
    const home = scratch("sb-stale-home.");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ packages: ["npm:beads", "/elsewhere/substrate"] }));
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({ "beads-marketplace": { installLocation: "/x" } }),
    );
    assert.equal(checkPiEnrolled(PKG_ROOT, home).ok, false, "foreign checkout must not count");
    assert.equal(checkClaudeMarketplaceEnrolled(PKG_ROOT, home).ok, false);
    const beads = checkBeadsAbsent(home);
    assert.equal(beads.ok, false, "Beads remnants must fail the absence check");
    assert.match(beads.detail ?? "", /beads/i);
  });
});
