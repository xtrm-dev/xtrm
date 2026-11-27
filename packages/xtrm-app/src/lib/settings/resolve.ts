// Provenance resolver (settings-research.md 3.2): default < device < host < project, one source per key.
import { DEFAULT_APP_SETTINGS, SETTING_KEYS, SETTINGS_SCOPE, parseSetting, type AppSettings, type Scope, type SettingKey } from "./schema.ts";

export type Source = "default" | "device" | "host" | "project";
export type Resolved<T> = { value: T; source: Source };
export type ResolvedSettings = { [K in SettingKey]: Resolved<AppSettings[K]> };

/** Raw layer documents; each is validated per key, so a stored value of the wrong shape falls through. */
export interface SettingsLayers {
  device?: unknown;
  host?: unknown;
  /** Explicit project overrides. Stored in the host document (operator, 2026-11-27), never committed. */
  project?: unknown;
}

/**
 * Which layers may supply a key of each scope, lowest first. A device layer cannot set a host value and a
 * host value is not overridden from a device. A project-scoped key takes the host value unless an explicit
 * project override exists.
 */
export const LAYERS_FOR_SCOPE: Readonly<Record<Scope, readonly Exclude<Source, "default">[]>> = {
  device: ["device"],
  host: ["host"],
  project: ["host", "project"],
};

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function resolveSetting<K extends SettingKey>(key: K, layers: SettingsLayers): Resolved<AppSettings[K]> {
  let resolved: Resolved<AppSettings[K]> = { value: DEFAULT_APP_SETTINGS[key], source: "default" };
  for (const layer of LAYERS_FOR_SCOPE[SETTINGS_SCOPE[key]]) {
    const value = parseSetting(key, asRecord(layers[layer])[key]);
    if (value !== undefined) resolved = { value, source: layer };
  }
  return resolved;
}

export function resolveSettings(layers: SettingsLayers): ResolvedSettings {
  const out = {} as Record<SettingKey, Resolved<unknown>>;
  for (const key of SETTING_KEYS) out[key] = resolveSetting(key, layers);
  return out as ResolvedSettings;
}

/** The plain values of a resolved document. */
export function settingsValues(resolved: ResolvedSettings): AppSettings {
  const out = {} as Record<SettingKey, unknown>;
  for (const key of SETTING_KEYS) out[key] = resolved[key].value;
  return out as AppSettings;
}

/** True when the resolved value differs from the compiled default: the UI shows "reset" only then. */
export function differsFromDefault<K extends SettingKey>(key: K, value: AppSettings[K]): boolean {
  return JSON.stringify(value) !== JSON.stringify(DEFAULT_APP_SETTINGS[key]);
}
