import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_DIR = process.env.XTS_CONFIG_DIR ?? path.join(os.homedir(), ".config", "xtrm");
export const CONFIG_FILE = path.join(CONFIG_DIR, "xts.json");

// Read lazily so tests can set XTS_CONFIG_DIR before any call.
function configPaths() {
  const dir = process.env.XTS_CONFIG_DIR ?? CONFIG_DIR;
  return { dir, file: path.join(dir, "xts.json") };
}

export function defaultConfig() {
  return { model: null };
}

export async function readConfig() {
  const { file } = configPaths();
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return defaultConfig();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isValidConfig(parsed)) return defaultConfig();
    return parsed;
  } catch {
    return defaultConfig();
  }
}

export async function writeConfig(config) {
  const { dir, file } = configPaths();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

function isValidConfig(config) {
  if (config === null || typeof config !== "object") return false;
  if (config.model === null) return true;
  if (typeof config.model !== "object" || config.model === null) return false;
  return typeof config.model.provider === "string" && typeof config.model.id === "string";
}
