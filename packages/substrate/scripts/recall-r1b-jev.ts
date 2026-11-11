#!/usr/bin/env node
// Minimal Jev (TypeSafe System One) client for the CORE-2603 R1b run.
//
// Same key source as skill-suggest: TYPESAFE_API_KEY, else
// ~/.secrets/typesafe_api_key.txt (which may hold `TYPESAFE_API_KEY=<key>` or a
// bare key). The key is never printed, logged or returned. Every failure is a
// typed reason, never a thrown secret-bearing error.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-latest";

export type JevFailure =
  | "no_key"
  | "timeout"
  | "transport"
  | `http_${number}`
  | "bad_answer";

export interface JevOutcome {
  ok: boolean;
  /** Probability per question id, when ok. */
  nouls: Record<string, number>;
  model: string | null;
  latencyMs: number;
  failure: JevFailure | null;
}

export interface JevOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  apiKey?: string | null;
  /** Test seam: no key file read; apiKey is the only source. */
  noKeyFile?: boolean;
}

function keyFromFile(): string | null {
  try {
    const raw = readFileSync(join(homedir(), ".secrets", "typesafe_api_key.txt"), "utf8").trim();
    const value = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : raw;
    return value.trim() || null;
  } catch {
    return null;
  }
}

/** The resolved key, or null. Never log the returned value. */
export function readJevKey(options: JevOptions = {}): string | null {
  if (options.apiKey !== undefined) return options.apiKey === "" ? null : options.apiKey;
  const env = process.env["TYPESAFE_API_KEY"];
  if (env && env.trim()) return env.trim();
  return options.noKeyFile === true ? null : keyFromFile();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** A bool/noul answer object: skill-suggest accepts both shapes. */
function probabilityOf(raw: unknown): number | null {
  if (raw === null || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (answer["type"] === "choice") return null;
  const direct = toNumber(answer["noul"]);
  if (direct !== null) return direct;
  return toNumber(answer["probability"]);
}

export interface JevQuestionSpec {
  type: "noul";
  instructions: string;
}

export async function jevAsk(
  state: Record<string, unknown>,
  questions: Record<string, JevQuestionSpec>,
  options: JevOptions = {},
): Promise<JevOutcome> {
  const started = Date.now();
  const key = readJevKey(options);
  if (!key) return { ok: false, nouls: {}, model: null, latencyMs: 0, failure: "no_key" };
  const timeoutMs = options.timeoutMs ?? 4000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(options.endpoint ?? process.env["RECALL_JEV_ENDPOINT"] ?? DEFAULT_JEV_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: options.model ?? process.env["RECALL_JEV_MODEL"] ?? DEFAULT_JEV_MODEL, state, questions }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, nouls: {}, model: null, latencyMs, failure: `http_${response.status}` };
    const body = (await response.json()) as Record<string, unknown>;
    const answers = body["answers"];
    if (answers === null || typeof answers !== "object") {
      return { ok: false, nouls: {}, model: null, latencyMs, failure: "bad_answer" };
    }
    const nouls: Record<string, number> = {};
    for (const [id, raw] of Object.entries(answers as Record<string, unknown>)) {
      const value = probabilityOf(raw);
      if (value !== null) nouls[id] = value;
    }
    if (Object.keys(nouls).length !== Object.keys(questions).length) {
      return { ok: false, nouls: {}, model: null, latencyMs, failure: "bad_answer" };
    }
    return {
      ok: true,
      nouls,
      model: typeof body["model"] === "string" ? body["model"] : null,
      latencyMs,
      failure: null,
    };
  } catch {
    return {
      ok: false,
      nouls: {},
      model: null,
      latencyMs: Date.now() - started,
      failure: controller.signal.aborted ? "timeout" : "transport",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `worker` over `items` with a fixed concurrency (the contract caps it at 4). */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low]!;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

// -- quota probe -------------------------------------------------------------

if (import.meta.main) {
  const outcome = await jevAsk(
    { probe: "CORE-2603 R1b quota probe: one authenticated call. Answer the question." },
    { reachable: { type: "noul", instructions: "Is this probe request being answered?" } },
  );
  console.log(
    JSON.stringify({
      ok: outcome.ok,
      failure: outcome.failure,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      nouls: outcome.nouls,
    }),
  );
  process.exitCode = outcome.ok ? 0 : 1;
}
