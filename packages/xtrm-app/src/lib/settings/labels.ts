// Per-key labels, anchors and value text (XTRM-1103). Shared so the console's settings rows, threads
// and settings search (XTRM-1106) name every setting the same way. Framework-free like the rest.
import { PALETTE_PRESETS, type AppSettings, type PalettePreset, type SettingKey } from "./schema.ts";

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  "appearance.theme": "Theme",
  "appearance.palette": "Palette",
  "appearance.chatWidth": "Chat width",
  "appearance.density": "Density",
  "appearance.fontScale": "Font size",
  "appearance.motion": "Motion",
  "appearance.codeWordWrap": "Wrap code",
  "layout.sidebarOpen": "Sidebar open",
  "layout.sidebarWidth": "Sidebar width",
  "layout.inspectorWidth": "Inspector width",
  "layout.foldedGroups": "Folded groups",
  "layout.lastRepository": "Last repository",
  "layout.agentScope": "Agent sessions shown",
  "layout.agentNames": "Agent session names",
  "layout.view": "Thread view",
  "connections.hostMode": "Connection mode",
  "connections.sshTarget": "SSH target",
  "connections.remoteCommand": "Remote command",
  "connections.directUrl": "Direct URL",
  "connections.deviceName": "Device name",
  "connections.peers": "Known hosts",
  "connections.connectTo": "Connect to",
  "connections.endpoint": "This host's endpoint",
  "connections.substrateRemote": "Substrate remote",
  "project.pmProject": "PM project",
  "project.jiraSite": "Jira site",
  "project.jiraProject": "Jira project",
  "project.boardSite": "Board site",
  "project.boardStateDir": "Board state directory",
  "project.credentialFile": "Credential file",
  "advanced.adapters": "Adapters",
  "advanced.logLevel": "Log level",
};

/** The anchor id of a setting's row: `/settings/<section>#<anchor>`. Dot-free, so it is a valid CSS id. */
export const settingAnchor = (key: SettingKey): string => key.replace(".", "-");

const ENUM_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  "appearance.theme",
  "appearance.density",
  "appearance.motion",
  "layout.view",
  "connections.hostMode",
  "advanced.adapters",
  "advanced.logLevel",
]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const count = (n: number, one: string, many: string) => (n === 0 ? "None" : `${n} ${n === 1 ? one : many}`);

/** A one-line value for display. `null` reads as the meaning the model gives it for that key. */
export function formatSettingValue<K extends SettingKey>(key: K, value: AppSettings[K]): string {
  const v = value as unknown;
  switch (key) {
    case "appearance.palette": {
      const p = v as AppSettings["appearance.palette"];
      const preset = (Object.keys(PALETTE_PRESETS) as PalettePreset[]).find((id) => {
        const q = PALETTE_PRESETS[id];
        return q.sidebar === p.sidebar && q.chat === p.chat && q.text === p.text;
      });
      return preset ? cap(preset.replace("-", " ")) : `Custom (${p.sidebar}, ${p.chat}, ${p.text} text)`;
    }
    case "appearance.chatWidth": {
      const w = v as AppSettings["appearance.chatWidth"];
      return w.mode === "custom" ? `${w.rem}rem` : cap(w.mode);
    }
    case "appearance.fontScale":
      return `${Math.round((v as number) * 100)}%`;
    case "layout.sidebarWidth":
      return `${v as number}px`;
    case "layout.inspectorWidth":
      return v === null ? "From the window width" : `${v as number}px`;
    case "layout.foldedGroups":
      return count((v as string[]).length, "group", "groups");
    case "layout.agentScope":
      return v === "all" ? "All repositories" : "This repository";
    case "layout.agentNames":
      return count(Object.keys(v as object).length, "name", "names");
    case "connections.peers":
      return count((v as unknown[]).length, "host", "hosts");
    case "connections.connectTo": {
      const c = v as AppSettings["connections.connectTo"];
      return c.mode === "this" ? "This host only" : c.mode === "all" ? "All known hosts" : `Chosen: ${c.chosen.join(", ") || "none"}`;
    }
    case "connections.endpoint": {
      const e = v as AppSettings["connections.endpoint"];
      const port = e.port === 0 ? "any port" : `port ${e.port}`;
      return `${e.bindAddress}, ${port}, ${e.acceptRemoteReaders ? "accepts" : "refuses"} remote readers`;
    }
    case "connections.substrateRemote":
      return v === null ? "This host's sb configuration" : String(v);
  }
  if (key.startsWith("project.")) return v === null ? "Derived (no override)" : String(v);
  if (v === null) return "Not set";
  if (v === "") return "Not set";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (v === "ssh") return "SSH";
  // Enumerated values read as words; free text (targets, URLs, names, repositories) stays verbatim.
  if (typeof v === "string") return ENUM_KEYS.has(key) ? cap(v) : v;
  return String(v);
}
