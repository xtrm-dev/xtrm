import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_SETTINGS,
  DEVICE_SETTINGS_KEY,
  LEGACY_KEYS,
  NOT_SETTINGS,
  PALETTE_PRESETS,
  SECTION_ORDER,
  SETTING_KEYS,
  SETTINGS_SCOPE,
  SETTINGS_SECTIONS,
  SETTINGS_VALIDATORS,
  SETTING_LABELS,
  formatSettingValue,
  settingAnchor,
  differsFromDefault,
  hostLayerFromConnection,
  parseSettings,
  readDeviceSettings,
  readLegacyDeviceSettings,
  resolveSettings,
  sectionOf,
  settingsValues,
  writeDeviceSettings,
  type AppSettings,
  type SettingsApp,
} from "./index.ts";

/** In-memory Storage double: the module only calls getItem/setItem. */
function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

/** Independent of DEFAULT_APP_SETTINGS: deleting a key from every map at once must still fail. */
const EXPECTED_KEYS = [
  "appearance.theme", "appearance.palette", "appearance.chatWidth", "appearance.density", "appearance.fontScale",
  "appearance.motion", "appearance.codeWordWrap",
  "layout.sidebarOpen", "layout.sidebarWidth", "layout.inspectorWidth", "layout.foldedGroups", "layout.lastRepository",
  "layout.agentScope", "layout.agentNames", "layout.view",
  "connections.hostMode", "connections.sshTarget", "connections.remoteCommand", "connections.directUrl",
  "connections.deviceName", "connections.peers", "connections.connectTo", "connections.endpoint", "connections.substrateRemote",
  "project.pmProject", "project.jiraSite", "project.jiraProject", "project.boardSite", "project.boardStateDir",
  "project.credentialFile",
  "advanced.adapters", "advanced.logLevel",
];

describe("settings schema", () => {
  it("has exactly the expected keys", () => {
    expect([...SETTING_KEYS].sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("gives every key a default, a scope, a validator and a known section", () => {
    const keys = new Set(SETTING_KEYS);
    expect(new Set(Object.keys(SETTINGS_SCOPE))).toEqual(keys);
    expect(new Set(Object.keys(SETTINGS_VALIDATORS))).toEqual(keys);
    for (const key of SETTING_KEYS) {
      expect(DEFAULT_APP_SETTINGS[key], key).not.toBeUndefined();
      expect(["device", "host", "project"], key).toContain(SETTINGS_SCOPE[key]);
      expect(SETTINGS_SECTIONS[sectionOf(key)], key).toBeDefined();
    }
  });

  it("accepts every default through its own validator unchanged", () => {
    for (const key of SETTING_KEYS) expect(SETTINGS_VALIDATORS[key](DEFAULT_APP_SETTINGS[key]), key).toEqual(DEFAULT_APP_SETTINGS[key]);
  });

  it("keeps appearance and layout device-scoped, and project keys host-stored with a project override", () => {
    for (const key of SETTING_KEYS) {
      if (sectionOf(key) === "appearance" || sectionOf(key) === "layout") expect(SETTINGS_SCOPE[key], key).toBe("device");
      if (sectionOf(key) === "project") expect(SETTINGS_SCOPE[key], key).toBe("project");
    }
  });

  it("defaults every invalid or missing value and never throws", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseSettings("garbage")).toEqual(DEFAULT_APP_SETTINGS);
    const parsed = parseSettings({
      "appearance.theme": "sepia",
      "layout.sidebarWidth": 9999,
      "layout.inspectorWidth": Number.NaN,
      "appearance.chatWidth": { mode: "custom", rem: 12 },
      "connections.endpoint": { bindAddress: "0.0.0.0", port: 70000, acceptRemoteReaders: true },
      "project.jiraProject": "  ",
      unknown: 1,
    });
    expect(parsed["appearance.theme"]).toBe("system");
    expect(parsed["layout.sidebarWidth"]).toBe(360);
    expect(parsed["layout.inspectorWidth"]).toBeNull();
    expect(parsed["appearance.chatWidth"]).toEqual({ mode: "custom", rem: 36 });
    expect(parsed["connections.endpoint"]).toEqual(DEFAULT_APP_SETTINGS["connections.endpoint"]);
    expect(parsed["project.jiraProject"]).toBeNull();
    expect(parsed).not.toHaveProperty("unknown");
  });

  it("caps folded groups and drops duplicate peers", () => {
    const groups = Array.from({ length: 250 }, (_, i) => `g${i}`);
    expect(parseSettings({ "layout.foldedGroups": groups })["layout.foldedGroups"]).toHaveLength(200);
    const peers = [
      { name: "a", address: "a.ts.net", transport: "direct" },
      { name: "a", address: "dup", transport: "ssh" },
      { name: "b", address: "b", transport: "carrier-pigeon" },
    ];
    expect(parseSettings({ "connections.peers": peers })["connections.peers"]).toEqual([{ name: "a", address: "a.ts.net", transport: "direct" }]);
  });

  it("gives every key a row label, a CSS-safe anchor and a display value", () => {
    expect(new Set(Object.keys(SETTING_LABELS))).toEqual(new Set(SETTING_KEYS));
    const anchors = SETTING_KEYS.map(settingAnchor);
    expect(new Set(anchors).size).toBe(SETTING_KEYS.length);
    for (const a of anchors) expect(a).toMatch(/^[a-z]+-[A-Za-z]+$/);
    for (const key of SETTING_KEYS) expect(formatSettingValue(key, DEFAULT_APP_SETTINGS[key]), key).not.toBe("");
    expect(formatSettingValue("connections.sshTarget", "me@box")).toBe("me@box");
    expect(formatSettingValue("appearance.theme", "system")).toBe("System");
    expect(formatSettingValue("appearance.palette", PALETTE_PRESETS["console-soft"])).toBe("Console soft");
    expect(formatSettingValue("project.jiraSite", null)).toBe("Derived (no override)");
  });

  it("labels every section once, in navigation order", () => {
    expect(SECTION_ORDER).toEqual(Object.keys(SETTINGS_SECTIONS));
    for (const id of SECTION_ORDER) expect(SETTINGS_SECTIONS[id].id).toBe(id);
  });

  it("stays framework-free: no imports outside this folder", () => {
    const dir = join(process.cwd(), "src/lib/settings");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const [, spec] of source.matchAll(/from\s+"([^"]+)"/g)) expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[\w-]+\.ts$/);
    }
  });
});

describe("provenance resolver", () => {
  it("reports default when no layer supplies a value", () => {
    const resolved = resolveSettings({});
    for (const key of SETTING_KEYS) expect(resolved[key]).toEqual({ value: DEFAULT_APP_SETTINGS[key], source: "default" });
    expect(settingsValues(resolved)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("applies device < host < project, each only for the scopes it may set", () => {
    const resolved = resolveSettings({
      device: { "appearance.theme": "dark", "connections.sshTarget": "device-cannot-set-this", "connections.peers": [{ name: "p", address: "p", transport: "ssh" }] },
      host: { "connections.sshTarget": "me@box", "appearance.theme": "light", "project.jiraSite": "host.atlassian.net", "connections.substrateRemote": "box:7000" },
      project: { "project.jiraSite": "project.atlassian.net", "connections.sshTarget": "project-cannot-set-this" },
    });
    expect(resolved["appearance.theme"]).toEqual({ value: "dark", source: "device" });
    expect(resolved["connections.peers"].source).toBe("device");
    expect(resolved["connections.sshTarget"]).toEqual({ value: "me@box", source: "host" });
    expect(resolved["project.jiraSite"]).toEqual({ value: "project.atlassian.net", source: "project" });
    expect(resolved["connections.substrateRemote"]).toEqual({ value: "box:7000", source: "host" });
    expect(resolved["project.pmProject"]).toEqual({ value: null, source: "default" });
  });

  it("treats a null project override as no override, so the host value and source stay", () => {
    const host = { "project.boardSite": "board.example", "connections.substrateRemote": "box:7000" };
    const resolved = resolveSettings({ host, project: { "project.boardSite": null, "connections.substrateRemote": null } });
    expect(resolved["project.boardSite"]).toEqual({ value: "board.example", source: "host" });
    expect(resolved["connections.substrateRemote"]).toEqual({ value: "box:7000", source: "host" });
    // A complete document from parseSettings({}) carries nulls for every project key; used as the project layer it overrides nothing.
    const fromDocument = resolveSettings({ host, project: parseSettings({}) });
    expect(fromDocument["project.boardSite"]).toEqual({ value: "board.example", source: "host" });
    expect(fromDocument["project.jiraSite"]).toEqual({ value: null, source: "default" });
  });

  it("lets an invalid higher-layer value fall through to the layer below", () => {
    const resolved = resolveSettings({ host: { "project.boardSite": "board.example" }, project: { "project.boardSite": 42 } });
    expect(resolved["project.boardSite"]).toEqual({ value: "board.example", source: "host" });
  });

  it("flags only values that differ from the default", () => {
    expect(differsFromDefault("appearance.palette", { ...PALETTE_PRESETS.threads })).toBe(false);
    expect(differsFromDefault("appearance.palette", PALETTE_PRESETS.desktop)).toBe(true);
  });
});

/**
 * One case per row of the research inventory (settings-research.md 2.1 and 2.2). `RESEARCH_INVENTORY`
 * is copied from the report, so dropping a key from LEGACY_KEYS fails here instead of silently.
 */
const RESEARCH_INVENTORY: Record<SettingsApp, string[]> = {
  console: ["xtrm.console.repo.v1", "xtrm.console.theme.v1", "xtrm.console.layout.v1", "xtrm.agent.names.v1", "xtrm.agent.scope.v1"],
  threads: ["pi-viewer-theme", "pi-viewer-palette", "pi-viewer-colours", "pi-viewer-chat-width", "pi-viewer-sidebar", "xtrm.console.layout.v1"],
};

interface Case {
  stored: string;
  expected: Partial<AppSettings>;
  /** A stored value that must be ignored (the default stays). */
  invalid: string;
}

const CASES: Record<SettingsApp, Record<string, Case>> = {
  console: {
    "xtrm.console.repo.v1": { stored: "acme/widgets", expected: { "layout.lastRepository": "acme/widgets" }, invalid: "not a repo" },
    "xtrm.console.theme.v1": { stored: "light", expected: { "appearance.theme": "light" }, invalid: "sepia" },
    "xtrm.console.layout.v1": {
      stored: JSON.stringify({ sidebarOpen: false, sidebarWidth: 100, inspectorWidth: 700 }),
      expected: { "layout.sidebarOpen": false, "layout.sidebarWidth": 220, "layout.inspectorWidth": 700 },
      invalid: "{not json",
    },
    "xtrm.agent.names.v1": { stored: JSON.stringify({ s1: "lead", s2: 7 }), expected: { "layout.agentNames": { s1: "lead" } }, invalid: "[]" },
    "xtrm.agent.scope.v1": { stored: "all", expected: { "layout.agentScope": "all" }, invalid: "everything" },
  },
  threads: {
    "pi-viewer-theme": { stored: "light", expected: { "appearance.theme": "light" }, invalid: "blue" },
    "pi-viewer-palette": { stored: "console-soft", expected: { "appearance.palette": PALETTE_PRESETS["console-soft"] }, invalid: "neon" },
    "pi-viewer-colours": {
      stored: JSON.stringify({ sidebar: "console", chat: "desktop", text: "standard" }),
      expected: { "appearance.palette": { sidebar: "console", chat: "desktop", text: "standard" } },
      invalid: JSON.stringify({ sidebar: "console", chat: "nope", text: "soft" }),
    },
    "pi-viewer-chat-width": { stored: "custom:60", expected: { "appearance.chatWidth": { mode: "custom", rem: 60 } }, invalid: "huge" },
    "pi-viewer-sidebar": { stored: JSON.stringify({ closed: ["s:1", "w:2", 3] }), expected: { "layout.foldedGroups": ["s:1", "w:2"] }, invalid: "null" },
    "xtrm.console.layout.v1": {
      stored: JSON.stringify({ sidebarOpen: true, sidebarWidth: 300, inspectorWidth: 700 }),
      expected: { "layout.sidebarOpen": true, "layout.sidebarWidth": 300 },
      invalid: "42",
    },
  },
};

function storesFor(legacy: { store: string; key: string }, value: string) {
  const local = memory(legacy.store === "localStorage" ? { [legacy.key]: value } : {});
  const session = memory(legacy.store === "sessionStorage" ? { [legacy.key]: value } : {});
  return { local, session };
}

describe("migration from today's storage keys", () => {
  it("covers every key in the research inventory, and nothing outside it", () => {
    for (const app of ["console", "threads"] as const) {
      const migrated = LEGACY_KEYS.filter((l) => l.app === app).map((l) => l.key);
      expect(new Set(migrated)).toEqual(new Set(RESEARCH_INVENTORY[app]));
      expect(new Set(Object.keys(CASES[app]))).toEqual(new Set(RESEARCH_INVENTORY[app]));
    }
  });

  for (const legacy of LEGACY_KEYS) {
    const c = CASES[legacy.app][legacy.key]!;
    it(`${legacy.app}: ${legacy.key} (${legacy.store}) migrates valid values and ignores invalid ones`, () => {
      expect(readLegacyDeviceSettings(legacy.app, storesFor(legacy, c.stored))).toEqual(c.expected);
      expect(readLegacyDeviceSettings(legacy.app, storesFor(legacy, c.invalid))).toEqual({});
      for (const key of Object.keys(c.expected)) expect(legacy.feeds).toContain(key);
    });
  }

  it("reads threads' theme exactly as today for stored values, and defaults to system when absent", () => {
    expect(readLegacyDeviceSettings("threads", { local: memory({ "pi-viewer-theme": "dark" }) })).toEqual({ "appearance.theme": "dark" });
    expect(resolveSettings({ device: readDeviceSettings("threads", { local: memory() }) })["appearance.theme"].value).toBe("system");
  });

  it("prefers the threads colour mix over the preset key, as loadColours() does", () => {
    const local = memory({ "pi-viewer-palette": "desktop", "pi-viewer-colours": JSON.stringify({ sidebar: "threads", chat: "console", text: "soft" }) });
    expect(readLegacyDeviceSettings("threads", { local })["appearance.palette"]).toEqual({ sidebar: "threads", chat: "console", text: "soft" });
    const broken = memory({ "pi-viewer-palette": "desktop", "pi-viewer-colours": "{" });
    expect(readLegacyDeviceSettings("threads", { local: broken })["appearance.palette"]).toEqual(PALETTE_PRESETS.desktop);
  });

  it("does not read the other app's legacy keys", () => {
    const local = memory({ "xtrm.console.theme.v1": "light", "xtrm.console.repo.v1": "acme/w" });
    expect(readLegacyDeviceSettings("threads", { local })).toEqual({});
  });

  it("keeps the excluded inventory rows out of the document", () => {
    const local = memory({ "xtrm-viewer:last-seen:abc": "123", "pi-viewer-design-theme": "dark" });
    expect(readDeviceSettings("threads", { local })).toEqual({});
    expect(NOT_SETTINGS.map((n) => n.key)).toEqual(expect.arrayContaining(["xtrm-viewer:last-seen:", "pi-viewer-design-theme"]));
  });

  it("lets the new document win over legacy keys and writes only the patched keys to the new key", () => {
    const local = memory({ "xtrm.console.theme.v1": "light", "xtrm.console.repo.v1": "acme/w" });
    const session = memory({ "xtrm.agent.scope.v1": "all" });
    const written = writeDeviceSettings("console", { local }, { "appearance.theme": "dark", "connections.sshTarget": "host-only" } as Partial<AppSettings>);
    expect(written).toEqual({ "appearance.theme": "dark" });
    expect(local.dump()["xtrm.console.theme.v1"]).toBe("light");
    expect(JSON.parse(local.dump()[DEVICE_SETTINGS_KEY.console]!)).toEqual(written);
    // Keys nobody wrote yet still read through from their legacy keys.
    expect(readDeviceSettings("console", { local, session })).toEqual({ "appearance.theme": "dark", "layout.lastRepository": "acme/w", "layout.agentScope": "all" });
    // A second write keeps the first.
    writeDeviceSettings("console", { local }, { "layout.agentScope": "all" });
    expect(readDeviceSettings("console", { local })).toEqual({ "appearance.theme": "dark", "layout.lastRepository": "acme/w", "layout.agentScope": "all" });
  });

  it("returns null when storage refuses the write", () => {
    const local = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(writeDeviceSettings("threads", { local }, { "appearance.theme": "light" })).toBeNull();
  });

  it("maps the host connection the agent host serves today into host-layer keys", () => {
    expect(hostLayerFromConnection({ settings: { target: "me@box", remoteCommand: null }, direct: { url: null } })).toEqual({
      "connections.sshTarget": "me@box",
      "connections.remoteCommand": null,
      "connections.hostMode": "ssh",
    });
    expect(hostLayerFromConnection({ settings: null, direct: { url: "https://box.ts.net:8443" } })).toEqual({
      "connections.directUrl": "https://box.ts.net:8443",
      "connections.hostMode": "direct",
    });
    expect(hostLayerFromConnection({ settings: null, direct: null })).toEqual({});
  });
});
