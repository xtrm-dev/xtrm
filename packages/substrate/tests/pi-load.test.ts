// Model-free Pi load probe tests (bead xtrm-6qu.13): the SDK probe script
// reports the 9 registered substrate tools with no model call, fails on an
// empty HOME, and surfaces relevant extension load errors. Fixture HOME dirs
// only (pi install is HOME-scoped); scratch under /var/tmp with cleanup.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXPECTED_SUBSTRATE_TOOLS } from "../integrations/pi-load-check.ts";

const PKG_ROOT = new URL("..", import.meta.url).pathname;
const PROBE_TS = new URL("../integrations/pi-load-check.ts", import.meta.url).pathname;

const created: string[] = [];

after(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const d = mkdtempSync(join("/var/tmp", prefix));
  created.push(d);
  return d;
}

function piInstall(home: string, pkgDir: string): void {
  const r = spawnSync("pi", ["install", pkgDir, "--approve"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(r.status, 0, `pi install must succeed in fixture HOME: ${r.stderr}`);
}

function runProbe(home: string): { status: number | null; json: Record<string, unknown> } {
  const r = spawnSync("node", [PROBE_TS, "--dir", PKG_ROOT, "--home", home, "--json"], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout) as Record<string, unknown> };
}

describe("pi load probe (xtrm-6qu.13)", () => {
  it("expects exactly the 9 substrate tools", () => {
    assert.equal(EXPECTED_SUBSTRATE_TOOLS.length, 9);
  });

  it("reports all 9 tools with no model call in an enrolled fixture HOME", () => {
    const home = scratch("sb-load-ok.");
    mkdirSync(home, { recursive: true });
    piInstall(home, PKG_ROOT);
    const { status, json } = runProbe(home);
    assert.equal(status, 0);
    assert.equal(json["ok"], true);
    assert.deepEqual([...(json["tools"] as string[])].sort(), [...EXPECTED_SUBSTRATE_TOOLS].sort());
    assert.deepEqual(json["missing"], []);
    assert.deepEqual(json["extensionErrors"], []);
  });

  it("fails with all tools missing under an empty HOME", () => {
    const home = scratch("sb-load-empty.");
    mkdirSync(home, { recursive: true });
    const { status, json } = runProbe(home);
    assert.equal(status, 1);
    assert.equal(json["ok"], false);
    assert.equal((json["missing"] as string[]).length, 9);
  });

  it("surfaces relevant extension load errors", () => {
    const home = scratch("sb-load-broken.");
    mkdirSync(home, { recursive: true });
    const badDir = join(scratch("sb-substrate-broken."), "pkg");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "package.json"), JSON.stringify({ name: "bad-sim", version: "0.0.0", pi: { extensions: ["./broken.ts"] } }));
    writeFileSync(join(badDir, "broken.ts"), "this is not valid typescript (((( ");
    piInstall(home, badDir);
    const { status, json } = runProbe(home);
    assert.equal(status, 1);
    assert.equal(json["ok"], false);
    assert.ok((json["extensionErrors"] as unknown[]).length > 0, "relevant load errors must be reported");
  });
});
