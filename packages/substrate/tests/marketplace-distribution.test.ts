import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// XTRM-640: the plugin is installable from GitHub through a marketplace at the
// repository root, and Claude Code can see an update. It detects updates by the
// version string, so plugin.json must carry the release version (and only
// plugin.json: it silently wins over a version in the marketplace entry).

const PKG = join(import.meta.dirname, "..");
const ROOT = join(PKG, "..", "..");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const rootMarketplace = json(join(ROOT, ".claude-plugin", "marketplace.json")) as {
  name: string;
  plugins: Array<{ name: string; source: string; version?: string }>;
};
const packageMarketplace = json(join(PKG, ".claude-plugin", "marketplace.json")) as { name: string };
const pluginManifest = json(join(PKG, "plugin", "substrate", ".claude-plugin", "plugin.json")) as { name: string; version?: string };
const packageManifest = json(join(PKG, "package.json")) as { version: string };

describe("GitHub marketplace distribution (XTRM-640)", () => {
  it("root manifest offers the substrate plugin from its monorepo path", () => {
    assert.equal(rootMarketplace.plugins.length, 1);
    const [entry] = rootMarketplace.plugins;
    assert.equal(entry.name, "substrate");
    assert.ok(entry.source.startsWith("./"), "relative source must start with ./");
    assert.ok(!entry.source.includes(".."), "relative source must not contain ..");
    assert.ok(!entry.source.includes("\\"), "relative source must use forward slashes");
    // Relative sources resolve from the directory that contains .claude-plugin/ (the repository root).
    assert.ok(existsSync(join(ROOT, entry.source, ".claude-plugin", "plugin.json")), "source must resolve to the plugin directory");
    assert.equal(json(join(ROOT, entry.source, ".claude-plugin", "plugin.json")).name, entry.name);
  });

  it("keeps the marketplace name stable so existing substrate@substrate installs keep working", () => {
    assert.equal(rootMarketplace.name, "substrate");
    assert.equal(rootMarketplace.name, packageMarketplace.name);
  });

  it("defines the version in plugin.json only", () => {
    assert.equal(rootMarketplace.plugins[0].version, undefined, "a version in the marketplace entry is silently overridden by plugin.json");
    assert.match(String(pluginManifest.version), /^\d+\.\d+\.\d+/);
  });

  it("plugin.json version equals package.json version", () => {
    assert.equal(
      pluginManifest.version,
      packageManifest.version,
      "Claude Code detects updates by version: run `npm run version` in packages/substrate to sync plugin.json",
    );
  });

  it("sync-plugin-version writes the package version and keeps the manifest formatting", () => {
    const dir = mkdtempSync(join(tmpdir(), "sync-plugin-version-"));
    try {
      mkdirSync(join(dir, "scripts"), { recursive: true });
      mkdirSync(join(dir, "plugin", "substrate", ".claude-plugin"), { recursive: true });
      cpSync(join(PKG, "scripts", "sync-plugin-version.mjs"), join(dir, "scripts", "sync-plugin-version.mjs"));
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "9.8.7" }));
      const manifest = join(dir, "plugin", "substrate", ".claude-plugin", "plugin.json");
      const original = `{\n  "name": "substrate",\n  "version": "0.0.1",\n  "author": { "name": "XTRM" }\n}\n`;
      writeFileSync(manifest, original);
      execFileSync("node", [join(dir, "scripts", "sync-plugin-version.mjs")], { encoding: "utf8" });
      assert.equal(readFileSync(manifest, "utf8"), original.replace("0.0.1", "9.8.7"));
      writeFileSync(manifest, `{ "name": "substrate" }\n`);
      assert.throws(() => execFileSync("node", [join(dir, "scripts", "sync-plugin-version.mjs")], { stdio: "pipe" }), /no "version" key/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
