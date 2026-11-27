// Shared settings model (XTRM-1101; design: docs/design/settings-research.md sections 3.2 and 3.9).
// Framework-free on purpose: no React, no styling, no router, no imports outside this folder, so
// threads (packages/pi-viewer) can import the same file through a path alias. Each key is flat and
// named `<section>.<name>`; the section is the settings route that owns the key.

/** Where a key is stored. `project` keys are stored on the host too (operator, 2026-11-27): the host
 * layer supplies the value and an explicit project override, kept in the host document, may replace it. */
export type Scope = "device" | "host" | "project";

export type SettingsSection = "general" | "appearance" | "layout" | "connections" | "project" | "advanced";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type MotionPreference = "system" | "reduce" | "full";

/** Threads' colour planes and text tones (packages/pi-viewer/src/lib/palette.ts). */
export type Plane = "threads" | "console" | "desktop";
export type TextTone = "standard" | "soft";
export interface Colours {
  sidebar: Plane;
  chat: Plane;
  text: TextTone;
}
export type PalettePreset = "threads" | "threads-soft" | "console" | "console-soft" | "desktop";

/** Threads' chat lane width (packages/pi-viewer/src/lib/chat-width.ts). */
export type ChatWidth = { mode: "comfortable" } | { mode: "wide" } | { mode: "full" } | { mode: "custom"; rem: number };

export type AgentScope = "all" | "repository";
export type ThreadView = "channel" | "events";

/** A known peer host, as one device sees it. Discovery may add entries at runtime; the compiled default is empty. */
export interface PeerHost {
  name: string;
  address: string;
  transport: "ssh" | "direct";
}
export interface ConnectTo {
  mode: "this" | "chosen" | "all";
  /** Peer names shown when `mode` is `chosen`. */
  chosen: string[];
}
/** This host's own reader endpoint. The access token is a secret and is never a setting. */
export interface HostEndpoint {
  bindAddress: string;
  port: number;
  acceptRemoteReaders: boolean;
}

export type AdapterMode = "live" | "mock";
export type LogLevel = "error" | "warn" | "info" | "debug";

export interface AppSettings {
  "appearance.theme": Theme;
  "appearance.palette": Colours;
  "appearance.chatWidth": ChatWidth;
  "appearance.density": Density;
  "appearance.fontScale": number;
  "appearance.motion": MotionPreference;
  "appearance.codeWordWrap": boolean;
  "layout.sidebarOpen": boolean;
  "layout.sidebarWidth": number;
  /** `null`: the app derives the width from the viewport (console `defaultInspectorWidth`). */
  "layout.inspectorWidth": number | null;
  "layout.foldedGroups": string[];
  "layout.lastRepository": string;
  "layout.agentScope": AgentScope;
  "layout.agentNames": Record<string, string>;
  "layout.view": ThreadView;
  "connections.hostMode": "ssh" | "direct";
  "connections.sshTarget": string;
  "connections.remoteCommand": string | null;
  "connections.directUrl": string | null;
  "connections.deviceName": string;
  "connections.peers": PeerHost[];
  "connections.connectTo": ConnectTo;
  "connections.endpoint": HostEndpoint;
  /** `null`: the host's own `sb` configuration decides. */
  "connections.substrateRemote": string | null;
  // Project keys hold explicit overrides only; `null` means "derived" (IntegrationSurface `resolvedBy`
  // stays env | repo_slug | repo_name). A non-null value is the `explicit` case.
  "project.pmProject": string | null;
  "project.jiraSite": string | null;
  "project.jiraProject": string | null;
  "project.boardSite": string | null;
  "project.boardStateDir": string | null;
  "project.credentialFile": string | null;
  "advanced.adapters": AdapterMode;
  "advanced.logLevel": LogLevel;
}

export type SettingKey = keyof AppSettings;

// ---------------------------------------------------------------------------------------------
// Vocabularies and bounds shared by both apps.

export const THEMES: readonly Theme[] = ["system", "light", "dark"];
export const PLANES: readonly Plane[] = ["threads", "console", "desktop"];
export const TEXT_TONES: readonly TextTone[] = ["standard", "soft"];
export const PALETTE_PRESETS: Readonly<Record<PalettePreset, Colours>> = {
  threads: { sidebar: "threads", chat: "threads", text: "standard" },
  "threads-soft": { sidebar: "threads", chat: "threads", text: "soft" },
  console: { sidebar: "console", chat: "console", text: "standard" },
  "console-soft": { sidebar: "console", chat: "console", text: "soft" },
  desktop: { sidebar: "desktop", chat: "desktop", text: "soft" },
};

/** One clamp table for both apps (console `SIDEBAR`/`INSPECTOR`, threads' copy in shell/layout.ts). */
export const SIDEBAR_WIDTH = { default: 264, min: 220, max: 360 } as const;
export const INSPECTOR_WIDTH = { min: 320, max: 1200 } as const;
export const CHAT_WIDTH_REM = { min: 36, maxStored: 400 } as const;
export const FONT_SCALE = { default: 1, min: 0.8, max: 1.5 } as const;
/** Folded groups are pane/window ids that come and go; cap the list so it cannot grow without bound. */
export const FOLDED_GROUPS_MAX = 200;
export const DEFAULT_REPOSITORY = "xtrm-dev/xtrm";

// ---------------------------------------------------------------------------------------------
// Defaults, scopes, validators.

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = {
  "appearance.theme": "system",
  "appearance.palette": PALETTE_PRESETS.threads,
  "appearance.chatWidth": { mode: "comfortable" },
  "appearance.density": "comfortable",
  "appearance.fontScale": FONT_SCALE.default,
  "appearance.motion": "system",
  "appearance.codeWordWrap": false,
  "layout.sidebarOpen": true,
  "layout.sidebarWidth": SIDEBAR_WIDTH.default,
  "layout.inspectorWidth": null,
  "layout.foldedGroups": [],
  "layout.lastRepository": DEFAULT_REPOSITORY,
  "layout.agentScope": "repository",
  "layout.agentNames": {},
  "layout.view": "channel",
  "connections.hostMode": "ssh",
  "connections.sshTarget": "",
  "connections.remoteCommand": null,
  "connections.directUrl": null,
  "connections.deviceName": "",
  "connections.peers": [],
  "connections.connectTo": { mode: "this", chosen: [] },
  "connections.endpoint": { bindAddress: "127.0.0.1", port: 0, acceptRemoteReaders: false },
  "connections.substrateRemote": null,
  "project.pmProject": null,
  "project.jiraSite": null,
  "project.jiraProject": null,
  "project.boardSite": null,
  "project.boardStateDir": null,
  "project.credentialFile": null,
  "advanced.adapters": "live",
  "advanced.logLevel": "info",
};

/** Hosts agreement (XTRM-1077, 2026-11-27): the peer list and the connect-to choice belong to the device
 * running the viewer; the host's own endpoint and its Substrate remote belong to the host. */
export const SETTINGS_SCOPE: Readonly<Record<SettingKey, Scope>> = {
  "appearance.theme": "device",
  "appearance.palette": "device",
  "appearance.chatWidth": "device",
  "appearance.density": "device",
  "appearance.fontScale": "device",
  "appearance.motion": "device",
  "appearance.codeWordWrap": "device",
  "layout.sidebarOpen": "device",
  "layout.sidebarWidth": "device",
  "layout.inspectorWidth": "device",
  "layout.foldedGroups": "device",
  "layout.lastRepository": "device",
  "layout.agentScope": "device",
  "layout.agentNames": "device",
  "layout.view": "device",
  "connections.hostMode": "host",
  "connections.sshTarget": "host",
  "connections.remoteCommand": "host",
  "connections.directUrl": "host",
  "connections.deviceName": "host",
  "connections.peers": "device",
  "connections.connectTo": "device",
  "connections.endpoint": "host",
  "connections.substrateRemote": "project",
  "project.pmProject": "project",
  "project.jiraSite": "project",
  "project.jiraProject": "project",
  "project.boardSite": "project",
  "project.boardStateDir": "project",
  "project.credentialFile": "project",
  "advanced.adapters": "host",
  "advanced.logLevel": "host",
};

export const SETTING_KEYS = Object.keys(DEFAULT_APP_SETTINGS) as SettingKey[];

export const sectionOf = (key: SettingKey): SettingsSection => key.slice(0, key.indexOf(".")) as SettingsSection;

/** A validator returns the normalized value, or `undefined` when the input is not a valid value. */
export type Validator<T> = (raw: unknown) => T | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf =
  <T extends string>(values: readonly T[]): Validator<T> =>
  (raw) =>
    values.includes(raw as T) ? (raw as T) : undefined;
const bool: Validator<boolean> = (raw) => (typeof raw === "boolean" ? raw : undefined);
const text: Validator<string> = (raw) => (typeof raw === "string" ? raw.trim() : undefined);
const nonEmptyOrNull: Validator<string | null> = (raw) => {
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
};
const clampedNumber =
  (lo: number, hi: number, round = true): Validator<number> =>
  (raw) => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
    const n = round ? Math.round(raw) : raw;
    return Math.min(hi, Math.max(lo, n));
  };
const stringList = (max: number): Validator<string[]> => (raw) =>
  Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === "string"))].slice(-max) : undefined;

export const parseColours: Validator<Colours> = (raw) => {
  if (!isRecord(raw)) return undefined;
  const { sidebar, chat, text: tone } = raw;
  if (!PLANES.includes(sidebar as Plane) || !PLANES.includes(chat as Plane) || !TEXT_TONES.includes(tone as TextTone)) return undefined;
  return { sidebar: sidebar as Plane, chat: chat as Plane, text: tone as TextTone };
};

export const parseChatWidth: Validator<ChatWidth> = (raw) => {
  if (!isRecord(raw)) return undefined;
  if (raw.mode === "comfortable" || raw.mode === "wide" || raw.mode === "full") return { mode: raw.mode };
  if (raw.mode !== "custom" || typeof raw.rem !== "number" || !Number.isFinite(raw.rem)) return undefined;
  if (raw.rem >= CHAT_WIDTH_REM.maxStored) return { mode: "full" };
  return { mode: "custom", rem: Math.max(CHAT_WIDTH_REM.min, Math.round(raw.rem)) };
};

const parseRepository: Validator<string> = (raw) =>
  typeof raw === "string" && /^[^/\s]+\/[^/\s]+$/.test(raw.trim()) ? raw.trim() : undefined;

const parseAgentNames: Validator<Record<string, string>> = (raw) =>
  isRecord(raw) ? Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string")) : undefined;

const parsePeers: Validator<PeerHost[]> = (raw) => {
  if (!Array.isArray(raw)) return undefined;
  const peers: PeerHost[] = [];
  for (const p of raw) {
    if (!isRecord(p) || typeof p.name !== "string" || typeof p.address !== "string") continue;
    if (p.transport !== "ssh" && p.transport !== "direct") continue;
    if (p.name.trim() === "" || peers.some((q) => q.name === p.name)) continue;
    peers.push({ name: p.name, address: p.address, transport: p.transport });
  }
  return peers;
};

const parseConnectTo: Validator<ConnectTo> = (raw) => {
  if (!isRecord(raw) || (raw.mode !== "this" && raw.mode !== "chosen" && raw.mode !== "all")) return undefined;
  return { mode: raw.mode, chosen: stringList(FOLDED_GROUPS_MAX)(raw.chosen) ?? [] };
};

const parseEndpoint: Validator<HostEndpoint> = (raw) => {
  if (!isRecord(raw) || typeof raw.bindAddress !== "string" || typeof raw.acceptRemoteReaders !== "boolean") return undefined;
  if (typeof raw.port !== "number" || !Number.isInteger(raw.port) || raw.port < 0 || raw.port > 65535) return undefined;
  return { bindAddress: raw.bindAddress.trim(), port: raw.port, acceptRemoteReaders: raw.acceptRemoteReaders };
};

export const SETTINGS_VALIDATORS: { readonly [K in SettingKey]: Validator<AppSettings[K]> } = {
  "appearance.theme": oneOf(THEMES),
  "appearance.palette": parseColours,
  "appearance.chatWidth": parseChatWidth,
  "appearance.density": oneOf<Density>(["comfortable", "compact"]),
  "appearance.fontScale": clampedNumber(FONT_SCALE.min, FONT_SCALE.max, false),
  "appearance.motion": oneOf<MotionPreference>(["system", "reduce", "full"]),
  "appearance.codeWordWrap": bool,
  "layout.sidebarOpen": bool,
  "layout.sidebarWidth": clampedNumber(SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
  "layout.inspectorWidth": (raw) => (raw === null ? null : clampedNumber(INSPECTOR_WIDTH.min, INSPECTOR_WIDTH.max)(raw)),
  "layout.foldedGroups": stringList(FOLDED_GROUPS_MAX),
  "layout.lastRepository": parseRepository,
  "layout.agentScope": oneOf<AgentScope>(["all", "repository"]),
  "layout.agentNames": parseAgentNames,
  "layout.view": oneOf<ThreadView>(["channel", "events"]),
  "connections.hostMode": oneOf<"ssh" | "direct">(["ssh", "direct"]),
  "connections.sshTarget": text,
  "connections.remoteCommand": nonEmptyOrNull,
  "connections.directUrl": nonEmptyOrNull,
  "connections.deviceName": text,
  "connections.peers": parsePeers,
  "connections.connectTo": parseConnectTo,
  "connections.endpoint": parseEndpoint,
  "connections.substrateRemote": nonEmptyOrNull,
  "project.pmProject": nonEmptyOrNull,
  "project.jiraSite": nonEmptyOrNull,
  "project.jiraProject": nonEmptyOrNull,
  "project.boardSite": nonEmptyOrNull,
  "project.boardStateDir": nonEmptyOrNull,
  "project.credentialFile": nonEmptyOrNull,
  "advanced.adapters": oneOf<AdapterMode>(["live", "mock"]),
  "advanced.logLevel": oneOf<LogLevel>(["error", "warn", "info", "debug"]),
};

/** Validate one key; an invalid or missing value yields `undefined`. */
export function parseSetting<K extends SettingKey>(key: K, raw: unknown): AppSettings[K] | undefined {
  return raw === undefined ? undefined : SETTINGS_VALIDATORS[key](raw);
}

/** Keep the valid, known keys of a stored partial document; drop everything else. */
export function parsePartialSettings(raw: unknown): Partial<AppSettings> {
  if (!isRecord(raw)) return {};
  const out: Partial<Record<SettingKey, unknown>> = {};
  for (const key of SETTING_KEYS) {
    const value = parseSetting(key, raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<AppSettings>;
}

/** A complete document: every key valid or defaulted. Never throws, so a bad value cannot break a boot. */
export function parseSettings(raw: unknown): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...parsePartialSettings(raw) };
}

// ---------------------------------------------------------------------------------------------
// Section label record: nav, breadcrumb and search read the same record.

export interface SectionLabel {
  label: string;
  /** Route segment and anchor id: `/settings/<id>`. */
  id: SettingsSection;
  summary: string;
}

export const SETTINGS_SECTIONS: Readonly<Record<SettingsSection, SectionLabel>> = {
  general: { id: "general", label: "General", summary: "Who you are and what this console is attached to." },
  appearance: { id: "appearance", label: "Appearance", summary: "Theme, colours, density, chat width and motion on this device." },
  layout: { id: "layout", label: "Layout", summary: "Sidebar, inspector, folded groups and views on this device." },
  connections: { id: "connections", label: "Connections", summary: "Agent hosts, peers, endpoint and Substrate remote." },
  project: { id: "project", label: "Project", summary: "Explicit binding overrides for this repository, stored on the host." },
  advanced: { id: "advanced", label: "Advanced", summary: "Adapters and log verbosity on this host." },
};

/** Section order for navigation. */
export const SECTION_ORDER: readonly SettingsSection[] = ["general", "appearance", "layout", "connections", "project", "advanced"];
