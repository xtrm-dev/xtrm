// Pi 1.5 alignment guard (XTRM-743).
//
// XTS declares @earendil-works/pi-coding-agent and @earendil-works/pi-tui as
// ranges. This test pins the floor at the release XTS is validated against,
// keeps the concrete TUI classes the interactive app constructs, and validates
// the one tool XTS exposes (pi's gated bash tool) with the validator pi 1.5
// uses for tool arguments.

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

test("declared pi dependency ranges do not pin below the validated release", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
    const range = manifest.dependencies[name];
    assert.match(range, /^(\^|~)?\d+\.\d+\.\d+$/, `${name} must use a plain version range`);
    const floor = range.replace(/^[\^~]/, "");
    assert.ok(versionAtLeast(floor, PI_FLOOR), `${name} range ${range} must include ${PI_FLOOR}`);
  }
});

test("installed pi packages satisfy the validated release", () => {
  for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
    const version = installedVersion(name);
    assert.ok(versionAtLeast(version, PI_FLOOR), `${name} ${version} is older than ${PI_FLOOR}`);
  }
});

test("pi-tui still exports the concrete TUI classes the app constructs", async () => {
  const tui = await import("@earendil-works/pi-tui");
  for (const name of ["TuiAltScreen", "TuiMainScreen"]) {
    assert.equal(typeof tui[name], "function", `pi-tui must export ${name}`);
  }
});

test("the gated bash tool schema validates under pi-schema", async () => {
  const { createBashTool } = await import("@earendil-works/pi-coding-agent");
  const { compile } = await import("@earendil-works/pi-schema");
  const tool = createBashTool(process.cwd(), {});
  const validator = compile(tool.parameters, { coerce: true });

  const valid = validator.parse({ command: "echo hi" });
  assert.equal(valid.ok, true, `bash tool rejected valid arguments: ${JSON.stringify(valid)}`);

  const invalid = validator.parse({});
  assert.equal(invalid.ok, false, "bash tool must require a command");
  if (invalid.ok) return;
  assert.deepEqual(
    invalid.errors.map((error) => `- ${error.path.slice(1)}: ${error.message}`),
    ["- command: missing"],
  );
});
