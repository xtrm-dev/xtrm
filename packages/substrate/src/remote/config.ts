// Client-side remote configuration (ADR-008): one config file under
// ~/.xtrm/config/, never a store. The mapping cache lives here so steady-state
// invocations pay no discovery cost; every entry records how it was verified.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { RemoteError, parseRemoteSpec, type RemoteSpec } from "./spec.ts";

export interface CheckoutMapping {
  // Server checkout root for a repository key (never a guessed path).
  root: string;
  projectId: string | null;
  verifiedAt: number;
}

export interface RemoteConfig {
  remote: string;
  // Absolute path of `sb` on the server. Resolved once; steady state never pays
  // a login-shell cost.
  remoteSb: string | null;
  serverVersion: string | null;
  checkouts: Record<string, CheckoutMapping>;
}

export const CONFIG_FILENAME = "substrate.json";

export function remoteConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["SUBSTRATE_REMOTE_CONFIG"]?.trim();
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".xtrm", "config", CONFIG_FILENAME);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// A malformed config fails closed: silently falling back to local mode would
// open the stale local store, which is the defect this feature removes.
export function readRemoteConfig(env: NodeJS.ProcessEnv = process.env): RemoteConfig | null {
  const path = remoteConfigPath(env);
  if (!existsSync(path)) {
    const envRemote = asString(env["SUBSTRATE_REMOTE"]);
    return envRemote === null ? null : { remote: envRemote, remoteSb: null, serverVersion: null, checkouts: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new RemoteError("config", `cannot parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RemoteError("config", `invalid ${path}: expected a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  const remote = asString(env["SUBSTRATE_REMOTE"]) ?? asString(record["remote"]);
  if (remote === null) return null;
  const rawCheckouts = record["checkouts"];
  const checkouts: Record<string, CheckoutMapping> = {};
  if (rawCheckouts !== undefined && typeof rawCheckouts === "object" && rawCheckouts !== null) {
    for (const [key, value] of Object.entries(rawCheckouts as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const root = asString(entry["root"]);
      if (root === null) continue;
      checkouts[key] = {
        root,
        projectId: asString(entry["projectId"]),
        verifiedAt: typeof entry["verifiedAt"] === "number" ? entry["verifiedAt"] : 0,
      };
    }
  }
  return { remote, remoteSb: asString(record["remoteSb"]), serverVersion: asString(record["serverVersion"]), checkouts };
}

export function writeRemoteConfig(config: RemoteConfig, env: NodeJS.ProcessEnv = process.env): string {
  const path = remoteConfigPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = JSON.stringify(
    { remote: config.remote, remoteSb: config.remoteSb, serverVersion: config.serverVersion, checkouts: config.checkouts },
    null,
    2,
  );
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${body}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

export interface RemoteSelection {
  spec: RemoteSpec;
  config: RemoteConfig;
  configPath: string;
}

// Remote mode is opt-in and reversible (ADR-008: every setting works both
// ways). Removing the setting returns every consumer, hooks and in-process
// callers included, to fully local behaviour without an ssh dependency. The
// cache goes with it: those paths and versions were observed from a server
// that is no longer configured.
export function clearRemoteConfig(env: NodeJS.ProcessEnv = process.env): { configPath: string; cleared: boolean } {
  const path = remoteConfigPath(env);
  if (!existsSync(path)) return { configPath: path, cleared: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new RemoteError(
      "config",
      `cannot parse ${path}: ${err instanceof Error ? err.message : String(err)}. Delete the file to return to local mode.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RemoteError("config", `invalid ${path}: expected a JSON object. Delete the file to return to local mode.`);
  }
  const record = parsed as Record<string, unknown>;
  const cleared = record["remote"] !== undefined;
  if (!cleared) return { configPath: path, cleared: false };
  delete record["remote"];
  delete record["remoteSb"];
  delete record["serverVersion"];
  delete record["checkouts"];
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return { configPath: path, cleared: true };
}

// The one entry point: env override > config file > local mode (null).
export function selectRemote(env: NodeJS.ProcessEnv = process.env): RemoteSelection | null {
  const config = readRemoteConfig(env);
  if (config === null) return null;
  const spec = parseRemoteSpec(config.remote);
  if (spec === null) return null;
  return { spec, config, configPath: remoteConfigPath(env) };
}
