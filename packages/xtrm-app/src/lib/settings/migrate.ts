// Read-through migration from today's storage keys (settings-research.md 2.1, 2.2, 3.4, 3.7).
// Legacy keys stay readable; the new document is the only key written. A key the new document already
// holds wins over its legacy key, because the new document is written on every change after migration.
import {
  PALETTE_PRESETS,
  SETTINGS_SCOPE,
  parsePartialSettings,
  type AppSettings,
  type PalettePreset,
  type SettingKey,
} from "./schema.ts";

export type SettingsApp = "console" | "threads";

/** One device document per app: the two apps are served from different origins, so they cannot share one. */
export const DEVICE_SETTINGS_KEY: Readonly<Record<SettingsApp, string>> = {
  console: "xtrm.console.settings.v1",
  threads: "pi-viewer.settings.v1",
};

type Reader = Pick<Storage, "getItem">;
type Mapper = (raw: string) => Partial<Record<SettingKey, unknown>>;

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
const obj = (raw: string): Record<string, unknown> => {
  const v = json(raw);
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

/** Console and threads both store `{sidebarOpen, sidebarWidth, inspectorWidth?}` under this key. */
const mapLayout: Mapper = (raw) => {
  const p = obj(raw);
  return { "layout.sidebarOpen": p.sidebarOpen, "layout.sidebarWidth": p.sidebarWidth, "layout.inspectorWidth": p.inspectorWidth };
};

/** Threads' chat width string: `comfortable | wide | full | custom:<rem>` (pi-viewer/src/lib/chat-width.ts). */
const mapChatWidth: Mapper = (raw) => {
  if (raw === "comfortable" || raw === "wide" || raw === "full") return { "appearance.chatWidth": { mode: raw } };
  const match = /^custom:(\d{1,4})$/.exec(raw);
  return match ? { "appearance.chatWidth": { mode: "custom", rem: Number(match[1]) } } : {};
};

export interface LegacyKey {
  key: string;
  app: SettingsApp;
  store: "localStorage" | "sessionStorage";
  /** Settings keys this legacy key feeds. */
  feeds: SettingKey[];
  map: Mapper;
}

/** Every current browser-stored setting in the research inventory (2.1, 2.2). Order matters: a later entry
 * that yields a value for the same settings key replaces an earlier one (the threads colours mix beats the
 * preset key, exactly as `loadColours()` reads them today). */
export const LEGACY_KEYS: readonly LegacyKey[] = [
  // Console (packages/xtrm-app).
  { key: "xtrm.console.theme.v1", app: "console", store: "localStorage", feeds: ["appearance.theme"], map: (raw) => ({ "appearance.theme": raw }) },
  { key: "xtrm.console.layout.v1", app: "console", store: "localStorage", feeds: ["layout.sidebarOpen", "layout.sidebarWidth", "layout.inspectorWidth"], map: mapLayout },
  { key: "xtrm.console.repo.v1", app: "console", store: "localStorage", feeds: ["layout.lastRepository"], map: (raw) => ({ "layout.lastRepository": raw }) },
  { key: "xtrm.agent.names.v1", app: "console", store: "localStorage", feeds: ["layout.agentNames"], map: (raw) => ({ "layout.agentNames": json(raw) }) },
  // sessionStorage today, so it is lost on reload; the document promotes it to persistent device state.
  { key: "xtrm.agent.scope.v1", app: "console", store: "sessionStorage", feeds: ["layout.agentScope"], map: (raw) => ({ "layout.agentScope": raw }) },
  // Threads (packages/pi-viewer).
  // Threads reads anything but "light" as dark; only the two real values migrate, absence keeps the default.
  { key: "pi-viewer-theme", app: "threads", store: "localStorage", feeds: ["appearance.theme"], map: (raw) => ({ "appearance.theme": raw === "light" || raw === "dark" ? raw : undefined }) },
  { key: "pi-viewer-palette", app: "threads", store: "localStorage", feeds: ["appearance.palette"], map: (raw) => ({ "appearance.palette": PALETTE_PRESETS[raw as PalettePreset] }) },
  { key: "pi-viewer-colours", app: "threads", store: "localStorage", feeds: ["appearance.palette"], map: (raw) => ({ "appearance.palette": json(raw) }) },
  { key: "pi-viewer-chat-width", app: "threads", store: "localStorage", feeds: ["appearance.chatWidth"], map: mapChatWidth },
  { key: "pi-viewer-sidebar", app: "threads", store: "localStorage", feeds: ["layout.foldedGroups"], map: (raw) => ({ "layout.foldedGroups": obj(raw).closed }) },
  { key: "xtrm.console.layout.v1", app: "threads", store: "localStorage", feeds: ["layout.sidebarOpen", "layout.sidebarWidth"], map: (raw) => {
    const { "layout.inspectorWidth": _ignored, ...sidebar } = mapLayout(raw);
    return sidebar;
  } },
];

/** Inventory rows that deliberately stay out of the settings document, with the reason. */
export const NOT_SETTINGS: readonly { key: string; reason: string }[] = [
  { key: "xtrm-viewer:last-seen:", reason: "read state is a log, not a setting (prefix map, one key per thread)" },
  { key: "pi-viewer-design-theme", reason: "docs site only, not app state" },
  { key: "inspect / drawer URL params", reason: "link state, carried by the URL" },
];

function read(storage: Reader | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The valid device-scoped values that the app's legacy keys hold. */
export function readLegacyDeviceSettings(
  app: SettingsApp,
  stores: { local?: Reader | null; session?: Reader | null },
): Partial<AppSettings> {
  const merged: Partial<Record<SettingKey, unknown>> = {};
  for (const legacy of LEGACY_KEYS) {
    if (legacy.app !== app) continue;
    const raw = read(legacy.store === "localStorage" ? stores.local : stores.session, legacy.key);
    if (raw === null) continue;
    const valid = parsePartialSettings(legacy.map(raw));
    for (const key of legacy.feeds) if (key in valid) merged[key] = valid[key];
  }
  return deviceOnly(merged as Partial<AppSettings>);
}

/** The device layer for one app: the new document first, legacy keys for whatever it does not hold yet. */
export function readDeviceSettings(app: SettingsApp, stores: { local?: Reader | null; session?: Reader | null }): Partial<AppSettings> {
  const raw = read(stores.local, DEVICE_SETTINGS_KEY[app]);
  const doc = deviceOnly(parsePartialSettings(raw === null ? undefined : json(raw)));
  return { ...readLegacyDeviceSettings(app, stores), ...doc };
}

/**
 * Write a device patch into the app's new document. Only device-scoped, valid keys are written; host and
 * project keys belong to the host document. Returns the stored device layer, or `null` when storage refused.
 */
export function writeDeviceSettings(
  app: SettingsApp,
  stores: { local: Pick<Storage, "getItem" | "setItem">; session?: Reader | null },
  patch: Partial<AppSettings>,
): Partial<AppSettings> | null {
  const next = { ...readDeviceSettings(app, stores), ...deviceOnly(parsePartialSettings(patch)) };
  try {
    stores.local.setItem(DEVICE_SETTINGS_KEY[app], JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/** The console's host connection as the agent host serves it today (`AgentHostConnectionState`,
 * src/adapters/agent/host-connection.ts), mapped to host-layer keys. */
export function hostLayerFromConnection(state: {
  settings: { target: string; remoteCommand: string | null } | null;
  direct?: { url: string | null } | null;
}): Partial<AppSettings> {
  const layer: Partial<Record<SettingKey, unknown>> = {};
  if (state.settings) {
    layer["connections.sshTarget"] = state.settings.target;
    layer["connections.remoteCommand"] = state.settings.remoteCommand;
  }
  if (state.direct?.url) layer["connections.directUrl"] = state.direct.url;
  // Today's console uses SSH whenever a target is saved and falls back to direct mode otherwise.
  if (state.settings?.target) layer["connections.hostMode"] = "ssh";
  else if (state.direct?.url) layer["connections.hostMode"] = "direct";
  return parsePartialSettings(layer);
}

function deviceOnly(values: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<Record<SettingKey, unknown>> = {};
  for (const [key, value] of Object.entries(values) as [SettingKey, unknown][]) if (SETTINGS_SCOPE[key] === "device") out[key] = value;
  return out as Partial<AppSettings>;
}
