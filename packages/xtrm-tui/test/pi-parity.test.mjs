// Pi 1.5 alignment guard (XTRM-743).
//
// xtrm-tui pinned @earendil-works/pi-tui and @earendil-works/pi-coding-agent to
// exactly 1.3.0. This test pins the floor at the version xtrm is validated
// against and proves the concrete TUI classes the shell constructs are still
// exported by the installed pi-tui, so a future pi-tui release that drops them
// fails here instead of at the first interactive launch.

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
    const manifest = join(dir, "package.json");
    try {
      return JSON.parse(readFileSync(manifest, "utf8")).version;
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

test("pi-tui still exports the concrete TUI classes the shell constructs", async () => {
  const tui = await import("@earendil-works/pi-tui");
  for (const name of ["TuiAltScreen", "TuiMainScreen"]) {
    assert.equal(typeof tui[name], "function", `pi-tui must export ${name}`);
    assert.equal(typeof tui[name].prototype.render, "function", `${name} must implement render()`);
  }
});

test("TuiAltScreen constructs against a terminal in fullscreen mode", async () => {
  const { Container, TuiAltScreen } = await import("@earendil-works/pi-tui");
  const terminal = {
    start() {},
    stop() {},
    drainInput: async () => {},
    write() {},
    columns: 80,
    rows: 24,
    kittyProtocolActive: false,
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  };
  const screen = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  assert.equal(screen.mode, "fullscreen");
  screen.setLayoutRoot(new Container());
  const lines = screen.render(80);
  assert.ok(Array.isArray(lines), "render() must return lines");
});
