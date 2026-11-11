// Setup contract acceptance (bead xtrm-6qu.6): the install/enable/
// health-check entry points xt init/doctor shell to exist, pass against the
// real package layout, and the §7 naming probe detects duplicates.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";
import { checkClaudePlugin, checkPiExtension, fullCheck, installPlan, probeInstalledPlugins } from "../integrations/setup.ts";

const PKG_ROOT = new URL("..", import.meta.url).pathname;

describe("integration setup contract (xtrm-6qu.6)", () => {
  it("health checks pass against the real package layout", () => {
    const report = fullCheck({ pkgRoot: PKG_ROOT, pluginDir: join(PKG_ROOT, "plugin", "substrate"), home: "/nonexistent-home" });
    assert.deepEqual(
      report.claude.filter((c) => !c.ok),
      [],
      "claude plugin checks green",
    );
    assert.deepEqual(
      report.pi.filter((c) => !c.ok),
      [],
      "pi extension checks green",
    );
  });

  it("claude check fails closed on an empty dir", () => {
    const dir = tempDir("sb-setup-");
    const checks = checkClaudePlugin(dir);
    assert.ok(checks.some((c) => !c.ok), "empty dir must fail");
    assert.ok(checks.every((c) => typeof c.name === "string" && typeof c.ok === "boolean"));
  });

  it("pi check fails closed on an empty dir", () => {
    const dir = tempDir("sb-setup-pi-");
    assert.ok(checkPiExtension(dir).some((c) => !c.ok), "empty dir must fail");
  });

  it("install plan names both surfaces with sources xt init can consume", () => {
    const plan = installPlan(PKG_ROOT);
    const surfaces = plan.surfaces.map((s) => s.surface).sort();
    assert.deepEqual(surfaces, ["claude-plugin", "pi-extension"]);
    for (const s of plan.surfaces) assert.ok(s.source.startsWith(PKG_ROOT) && s.steps.length > 0);
  });

  it("§7 naming probe flags duplicate substrate plugins", () => {
    const home = tempDir("sb-naming-");
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "substrate@a": [{ installPath: "/x" }], "substrate@b": [{ installPath: "/y" }] } }),
    );
    const probe = probeInstalledPlugins(home);
    assert.equal(probe.duplicates, true);
    assert.equal(probe.substratePlugins.length, 2);
    const clean = probeInstalledPlugins("/nonexistent-home");
    assert.equal(clean.duplicates, false, "missing registry fails open, never flags");
    assert.deepEqual(clean.beadsRemnants, []);
  });

  it("naming probe surfaces stale beads marketplaces", () => {
    const home = tempDir("sb-naming-mkt-");
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({ "beads-marketplace": { installLocation: "/x" } }),
    );
    const probe = probeInstalledPlugins(home);
    assert.equal(probe.duplicates, false);
    assert.ok(probe.beadsRemnants.includes("beads-marketplace"));
  });
});
