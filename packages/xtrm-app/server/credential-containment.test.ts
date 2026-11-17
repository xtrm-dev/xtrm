// The status board's here.now key and the Jira token are credentials the browser must
// never hold. The bridge reads them server-side, per request, from the files named by
// the binding; this test builds the real client bundle and fails if either value (or a
// key string injected into an asset) reaches the output. A failure names the asset and
// the credential's file, never the value.

import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { defaultConfigPath, loadPmConfig, type PmConfig } from "./status-board-api.ts";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_EXTENSIONS = new Set([".js", ".css", ".html", ".json", ".map", ".svg", ".txt", ".webmanifest"]);

type Secret = { label: string; value: string };

/** Every file the build emitted, so a new asset type cannot silently escape the scan. */
function builtAssets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...builtAssets(path));
    else if (ASSET_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) out.push(path);
  }
  return out;
}

/**
 * Asset paths that contain a credential. The report carries the asset and the secret's
 * owning file, never the secret value, so a failing run can be pasted into an issue.
 */
export function scanForSecrets(dir: string, secrets: Secret[]): string[] {
  const leaks: string[] = [];
  for (const asset of builtAssets(dir)) {
    const text = readFileSync(asset, "utf8");
    for (const secret of secrets) {
      if (text.includes(secret.value)) leaks.push(`${relative(dir, asset)} contains ${secret.label}`);
    }
  }
  return leaks;
}

/** Credential values the binding names, read the same way the bridge reads them. */
function configuredSecrets(config: PmConfig | null): Secret[] {
  const secrets: Secret[] = [];
  const add = (label: string, path: unknown): void => {
    if (typeof path !== "string" || path.length === 0) return;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8").trim();
    } catch {
      // A file absent on this host is not a leak; CI has no operator credentials.
      return;
    }
    if (raw.length >= 8) secrets.push({ label, value: raw });
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [field, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value.length >= 8) secrets.push({ label: `${label}#${field}`, value });
        }
      }
    } catch {
      // A plain-token file is the normal shape; the whole value above already covers it.
    }
  };
  const defaults = config?.defaults ?? {};
  add("defaults.jira_token_file", defaults.jira_token_file);
  for (const [name, project] of Object.entries(config?.projects ?? {})) {
    if (!project || typeof project !== "object") continue;
    add(`projects.${name}.status_board_key_file`, project.status_board_key_file);
    add(`projects.${name}.jira_token_file`, project.jira_token_file);
  }
  return secrets;
}

/** Client modules must not reach the bridge: the credential reader is server-only. */
function clientModulesImportingServer(): string[] {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const source = readFileSync(path, "utf8");
      if (/(?:from|import)\s*\(?\s*["'][^"']*\/server\/[^"']*["']/.test(source)) {
        offenders.push(relative(APP_DIR, path));
      }
    }
  };
  walk(join(APP_DIR, "src"));
  return offenders;
}

describe("credential containment", () => {
  it(
    "keeps every configured here.now key and Jira token out of the built client assets",
    async () => {
      const outDir = mkdtempSync(join(tmpdir(), "xtrm-app-dist-"));
      await build({
        root: APP_DIR,
        configFile: join(APP_DIR, "vite.config.ts"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });

      // The scan is only meaningful if the asset set is real: an empty build would pass vacuously.
      expect(builtAssets(outDir).length).toBeGreaterThan(0);
      expect(scanForSecrets(outDir, configuredSecrets(loadPmConfig(defaultConfigPath())))).toEqual([]);
      expect(clientModulesImportingServer()).toEqual([]);

      // Negative control, executed every run: a credential string placed in a built asset
      // must be caught, and the report must not repeat the value. This is the fail-first
      // case: without the injection the scan above is the assertion that passes.
      const canary = "xtrm-asset-canary-credential-831";
      const injected = mkdtempSync(join(tmpdir(), "xtrm-app-dist-injected-"));
      cpSync(outDir, injected, { recursive: true });
      const target = builtAssets(injected).find((asset) => asset.endsWith(".js"));
      expect(target).toBeTruthy();
      appendFileSync(target!, `\nconst leaked = "${canary}";\n`);
      const found = scanForSecrets(injected, [{ label: "injected canary", value: canary }]);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(relative(injected, target!));
      expect(found.join("\n")).not.toContain(canary);
    },
    120_000,
  );
});
