// The console's view of the shared settings model (XTRM-1103): resolved values with their source,
// plus the keys the console can already change and reset.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAdapters } from "../adapters/index.tsx";
import {
  DEFAULT_APP_SETTINGS,
  SETTING_KEYS,
  SETTING_LABELS,
  SETTINGS_SCOPE,
  formatSettingValue,
  hostLayerFromConnection,
  readDeviceSettings,
  resolveSettings,
  sectionOf,
  settingAnchor,
  type AppSettings,
  type SettingKey,
  type SettingsSection,
  type Source,
} from "../lib/settings/index.ts";
import { useShell } from "../shell/context.tsx";
import { defaultInspectorWidth } from "../shell/layout.ts";

/** Where a setting is changed today when this page cannot change it yet. Every key without a binding has one. */
export const WHERE_TO_CHANGE: Readonly<Partial<Record<SettingKey, string>>> = {
  "appearance.palette": "Changed in Threads today. The console control arrives with the appearance page (XTRM-1105).",
  "appearance.chatWidth": "Changed in Threads today. The console control arrives with the appearance page (XTRM-1105).",
  "appearance.density": "No control yet. It arrives with the appearance page (XTRM-1105).",
  "appearance.fontScale": "No control yet. It arrives with the appearance page (XTRM-1105).",
  "appearance.motion": "No control yet. It arrives with the appearance page (XTRM-1105).",
  "appearance.codeWordWrap": "No control yet. It arrives with the appearance page (XTRM-1105).",
  "layout.foldedGroups": "Fold and unfold groups in the Threads sidebar. The reset arrives with the layout page (XTRM-1105).",
  "layout.lastRepository": "Pick a repository in the sidebar's repository selector.",
  "layout.agentScope": "Switch between this repository and all repositories in the agent sidebar.",
  "layout.agentNames": "Rename a session in the agent sidebar.",
  "layout.view": "Switch the thread view in Threads.",
  "connections.hostMode": "Change it in the agent host panel. The form moves here with XTRM-1104.",
  "connections.sshTarget": "Change it in the agent host panel. The form moves here with XTRM-1104.",
  "connections.remoteCommand": "Change it in the agent host panel. The form moves here with XTRM-1104.",
  "connections.directUrl": "Pair a device in the agent host panel. The form moves here with XTRM-1104.",
  "connections.deviceName": "Set when you pair a device in the agent host panel.",
  "connections.peers": "Stored on this device. Editing arrives with the host settings document.",
  "connections.connectTo": "Stored on this device. Editing arrives with the host settings document.",
  "connections.endpoint": "Stored on the host. Editing arrives with the host settings document.",
  "connections.substrateRemote": "Stored on the host, with an optional project override. Editing arrives with the host settings document.",
  "project.pmProject": "An explicit override, stored on the host. Editing arrives with the host settings document.",
  "project.jiraSite": "An explicit override, stored on the host. Editing arrives with the host settings document.",
  "project.jiraProject": "An explicit override, stored on the host. Editing arrives with the host settings document.",
  "project.boardSite": "An explicit override, stored on the host. Editing arrives with the host settings document.",
  "project.boardStateDir": "An explicit override, stored on the host. Editing arrives with the host settings document.",
  "project.credentialFile": "An explicit override, stored on the host. Editing arrives with the host settings document.",
  "advanced.adapters": "Set by the build environment (VITE_XTRM_* variables) today.",
  "advanced.logLevel": "Stored on the host. Editing arrives with the host settings document.",
};

export interface SettingRow {
  /** True when the value comes from the agent host and the host did not answer: the shown value is not known. */
  unknown?: boolean;
  key: SettingKey;
  label: string;
  anchor: string;
  value: string;
  source: Source;
  /** True when the value differs from the compiled default and this page can put it back. */
  resettable: boolean;
  reset?: () => void;
  note?: string;
}

/** The same query key as the agent host panel, so both read one cache entry. */
const HOST_KEY = ["agent", "host-connection"] as const;

function stores() {
  try {
    return { local: localStorage, session: sessionStorage };
  } catch {
    return { local: null, session: null };
  }
}

export interface SettingRows {
  rows: Record<SettingsSection, SettingRow[]>;
  /** The agent host's error when its status read failed; host- and project-scoped rows are then unknown. */
  hostError: string | null;
}

/** The source a row reports: a live value at its default reads "default", a live value off it "device". */
function rowSource(resolved: Source, bound: { isDefault: boolean } | undefined): Source {
  if (!bound) return resolved;
  if (bound.isDefault) return "default";
  return resolved === "default" ? "device" : resolved;
}

export function useSettingRows(): SettingRows {
  const shell = useShell();
  const { agentHost } = useAdapters();
  const host = useQuery({ queryKey: HOST_KEY, queryFn: () => agentHost.status(), staleTime: 30_000 });
  const { layout, themePreference, setThemePreference, dispatch } = shell;

  return useMemo(() => {
    const resolved = resolveSettings({
      device: readDeviceSettings("console", stores()),
      host: host.data ? hostLayerFromConnection(host.data) : undefined,
    });
    const inspectorDefault = defaultInspectorWidth();

    // Keys the console already owns as live state: the page shows the live value and can reset it.
    const live: Partial<Record<SettingKey, { value: unknown; isDefault: boolean; reset: () => void }>> = {
      "appearance.theme": {
        value: themePreference,
        isDefault: themePreference === DEFAULT_APP_SETTINGS["appearance.theme"],
        reset: () => setThemePreference(DEFAULT_APP_SETTINGS["appearance.theme"]),
      },
      "layout.sidebarOpen": {
        value: layout.sidebar.open,
        isDefault: layout.sidebar.open === DEFAULT_APP_SETTINGS["layout.sidebarOpen"],
        // The reducer only toggles, so reset toggles only when the value is off its default.
        reset: () => {
          if (layout.sidebar.open !== DEFAULT_APP_SETTINGS["layout.sidebarOpen"]) dispatch({ type: "sidebar/toggle" });
        },
      },
      "layout.sidebarWidth": {
        value: layout.sidebar.lastExpandedWidth,
        isDefault: layout.sidebar.lastExpandedWidth === DEFAULT_APP_SETTINGS["layout.sidebarWidth"],
        reset: () => dispatch({ type: "sidebar/resize", width: DEFAULT_APP_SETTINGS["layout.sidebarWidth"] }),
      },
      "layout.inspectorWidth": {
        value: layout.inspector.width,
        // The default is "derived from the window width", so the derived width counts as the default.
        isDefault: layout.inspector.width === inspectorDefault,
        reset: () => dispatch({ type: "drawer/resize", width: inspectorDefault }),
      },
    };

    const hostError = host.isError ? (host.error instanceof Error ? host.error.message : String(host.error)) : null;
    const rows = { general: [], appearance: [], layout: [], connections: [], project: [], advanced: [] } as Record<SettingsSection, SettingRow[]>;
    for (const key of SETTING_KEYS) {
      const bound = live[key];
      const value = (bound ? bound.value : resolved[key].value) as AppSettings[typeof key];
      const resettable = bound ? !bound.isDefault : false;
      rows[sectionOf(key)].push({
        key,
        label: SETTING_LABELS[key],
        anchor: settingAnchor(key),
        value: formatSettingValue(key, value),
        source: rowSource(resolved[key].source, bound),
        unknown: hostError !== null && SETTINGS_SCOPE[key] !== "device",
        resettable,
        reset: bound?.reset,
        note: bound ? undefined : WHERE_TO_CHANGE[key],
      });
    }
    return { rows, hostError };
  }, [host.data, host.isError, host.error, layout, themePreference, setThemePreference, dispatch]);
}
