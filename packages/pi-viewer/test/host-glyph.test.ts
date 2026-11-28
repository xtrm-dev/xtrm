import { strict as assert } from "node:assert"
import { test } from "node:test"

import { LOCAL_HOST_LABEL, hostGlyph, hostLabel, isLocalHost, windowHost } from "../src/lib/host-glyph.ts"

/**
 * XTRM-1155: the sidebar's host glyph. Until XTRM-1139 stage 1 reports a host, every agent is on the
 * machine that serves the viewer; a reported host is remote unless it matches the viewer's own id.
 */

test("an absent host means the machine that serves the viewer", () => {
  assert.equal(isLocalHost(undefined), true)
  assert.equal(isLocalHost(null), true)
  assert.equal(isLocalHost(""), true)
  assert.equal(hostGlyph(undefined), "monitor")
  assert.equal(hostGlyph(null), "monitor")
  assert.equal(hostLabel(undefined), LOCAL_HOST_LABEL)
  assert.equal(LOCAL_HOST_LABEL, "this machine")
})

test("a reported host is remote, and matching the viewer's own host id keeps it local", () => {
  assert.equal(hostGlyph("v2202602340735437128"), "server")
  assert.equal(hostLabel("v2202602340735437128"), "host v2202602340735437128")
  assert.equal(isLocalHost("v2202602340735437128", null), false)
  assert.equal(isLocalHost("v2202602340735437128", "v2202602340735437128"), true)
  assert.equal(hostGlyph("v2202602340735437128", "v2202602340735437128"), "monitor")
  assert.equal(hostGlyph("v2202602340735437128", "fedora"), "server")
})

test("a uniform window draws one glyph and names its host", () => {
  assert.deepEqual(windowHost([{}, {}]), { glyph: "monitor", label: LOCAL_HOST_LABEL, mixed: false })
  assert.deepEqual(windowHost([{ host: "server" }, { host: "server" }]), { glyph: "server", label: "host server", mixed: false })
  assert.deepEqual(windowHost([{ host: "server" }], "server"), { glyph: "monitor", label: LOCAL_HOST_LABEL, mixed: false })
})

test("a window that mixes hosts draws no window glyph, so each pane row carries its own", () => {
  const mixed = windowHost([{}, { host: "server" }])
  assert.equal(mixed.glyph, null)
  assert.equal(mixed.mixed, true)
  assert.equal(mixed.label, "mixed hosts")
  const twoRemotes = windowHost([{ host: "server" }, { host: "desktop" }])
  assert.equal(twoRemotes.glyph, null)
  assert.equal(twoRemotes.mixed, true)
})

test("an empty window claims no host rather than pretending to be local", () => {
  assert.deepEqual(windowHost([]), { glyph: null, label: "mixed hosts", mixed: true })
})

test("both glyph names are in the shell icon registry", async () => {
  const { readFileSync } = await import("node:fs")
  const { fileURLToPath } = await import("node:url")
  const source = readFileSync(fileURLToPath(new URL("../src/shell/icon.tsx", import.meta.url)), "utf8")
  assert.match(source, /^\s*monitor: Monitor,/m)
  assert.match(source, /^\s*server: Server,/m)
})
