// Pi 1.5 alignment guard (XTRM-743).
//
// xtprompt drives pi through ModelRuntime, SettingsManager and resolveCliModel
// (src/model.mjs). This test pins the floor at the release xtprompt is
// validated against and fails if any of those entry points disappears.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The pi release this package is validated against. */
const PI_FLOOR = "1.5.2";

function installedVersion(name) {
  // The packages do not export ./package.json; walk up from the resolved entry.
  let dir = dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    try {
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`no package.json above ${name}`);
      dir = parent;
    }
  }
}

function versionAtLeast(actual, floor) {
  const a = actual.split(".").map(Number);
  const f = floor.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== f[i]) return a[i] > f[i];
  }
  return true;
}

test("declared pi dependency range does not pin below the validated release", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const range = manifest.dependencies["@earendil-works/pi-coding-agent"];
  assert.match(range, /^(\^|~)?\d+\.\d+\.\d+$/, "pi-coding-agent must use a plain version range");
  const floor = range.replace(/^[\^~]/, "");
  assert.ok(versionAtLeast(floor, PI_FLOOR), `pi-coding-agent range ${range} must include ${PI_FLOOR}`);
});

test("installed pi-coding-agent satisfies the validated release", () => {
  const version = installedVersion("@earendil-works/pi-coding-agent");
  assert.ok(versionAtLeast(version, PI_FLOOR), `pi-coding-agent ${version} is older than ${PI_FLOOR}`);
});

test("the model layer entry points xtprompt imports still exist", async () => {
  const pi = await import("@earendil-works/pi-coding-agent");
  assert.equal(typeof pi.ModelRuntime?.create, "function", "ModelRuntime.create must exist");
  assert.equal(typeof pi.SettingsManager?.create, "function", "SettingsManager.create must exist");
  assert.equal(typeof pi.resolveCliModel, "function", "resolveCliModel must exist");
});
