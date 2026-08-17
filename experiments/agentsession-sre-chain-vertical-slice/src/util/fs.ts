import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

/** Atomic replace for authoritative JSON state files. */
export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const data = JSON.stringify(value, null, 2) + "\n";
  const fh = await fsp.open(tmp, "w");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, target);
}

/** Serialized JSONL append with per-file mutex. */
const _appendLocks: Map<string, Promise<void>> = new Map();
export async function appendJsonl(target: string, record: unknown): Promise<void> {
  const line = JSON.stringify(record) + "\n";
  const prev = _appendLocks.get(target) ?? Promise.resolve();
  const doAppend = prev.then(async () => {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const fh = await fsp.open(target, "a");
    try {
      await fh.writeFile(line);
      await fh.sync();
    } finally {
      await fh.close();
    }
  });
  _appendLocks.set(target, doAppend.catch(() => {}));
  await doAppend;
}

export async function readJsonl<T>(target: string): Promise<T[]> {
  if (!fs.existsSync(target)) return [];
  const raw = await fsp.readFile(target, "utf8");
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // skip malformed authoritative-line? — record as forensic event upstream
    }
  }
  return out;
}

export async function readJsonSafe<T>(target: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(target, "utf8");
    return JSON.parse(raw) as T;
  } catch (e: any) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

export function sha256String(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
