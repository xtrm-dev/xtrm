// Dev-server bridge to the xtrm-research package through its documented CLI
// envelope (`xtrm-research --json ...`, schema xtrm-research-cli/v1).
//
// Read-only: there is no write path in this slice (run annotate is a mutation
// and is deliberately not exposed here). Only the commands built by
// `readArgv` can run. Inputs are validated so a value can never become a flag.

import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// Matches SAFE_SEGMENT_PATTERN (packages/research store.py): every operator-supplied
// identifier that becomes a path segment on the Python side (run id, experiment/workload id).
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$/;
const OFFSET_RE = /^\d{1,15}$/;
const TTL_MS = 5_000;
const MAX_COMPARE_RUNS = 20;

const id = (params: URLSearchParams, key: string) => {
  const v = params.get(key);
  return v && ID_RE.test(v) ? v : null;
};

/** Non-negative integer within a sane bound. `undefined` means "absent", `null` means "invalid". */
const offset = (params: URLSearchParams, key: string): number | null | undefined => {
  const v = params.get(key);
  if (v === null) return undefined;
  if (!OFFSET_RE.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

// The registry root is server configuration, not per-request input: it never comes from
// the query string, so it cannot be used to make the Python CLI read an arbitrary path.
const registryRoot = () => process.env.XTRM_RESEARCH_REGISTRY_ROOT || null;

function registryShowArgv(kind: "experiment" | "workload" | "question-spec", params: URLSearchParams): string[] | null {
  const definitionId = id(params, "id");
  const root = registryRoot();
  if (!definitionId || !root) return null;
  const version = params.get("version");
  if (version !== null && !ID_RE.test(version)) return null;
  // The CLI subcommand for question specs hyphenates the kind; experiment and
  // workload use the bare noun.
  const verb = kind === "question-spec" ? "question-spec" : kind;
  const argv = [verb, "show", definitionId, "--registry-root", root];
  if (version !== null) argv.push("--version", version);
  return argv;
}

/** Bare argv for one `xtrm-research` read verb; `--root`/`--json` are added by the caller. */
export function readArgv(pathname: string, params: URLSearchParams): string[] | null {
  switch (pathname) {
    case "/runs": {
      const lineage = params.get("lineage");
      if (lineage === null) return ["runs"];
      return ID_RE.test(lineage) ? ["runs", "--lineage", lineage] : null;
    }
    case "/run": {
      const runId = id(params, "id");
      return runId ? ["run", "show", runId] : null;
    }
    case "/experiment":
      return registryShowArgv("experiment", params);
    case "/workload":
      return registryShowArgv("workload", params);
    case "/question-spec":
      return registryShowArgv("question-spec", params);
    case "/tail": {
      const runId = id(params, "run");
      if (!runId) return null;
      const after = offset(params, "after");
      if (after === null) return null;
      return after === undefined ? ["tail", runId] : ["tail", runId, "--after", String(after)];
    }
    case "/metrics": {
      const runId = id(params, "run");
      return runId ? ["metrics", runId] : null;
    }
    case "/compare": {
      const runIds = params.getAll("run");
      if (runIds.length === 0 || runIds.length > MAX_COMPARE_RUNS || !runIds.every((r) => ID_RE.test(r))) return null;
      return ["compare", ...runIds];
    }
    case "/chart-data": {
      const runIds = params.getAll("run");
      const metric = id(params, "metric");
      if (!metric || runIds.length === 0 || runIds.length > MAX_COMPARE_RUNS || !runIds.every((r) => ID_RE.test(r))) return null;
      return ["chart-data", ...runIds, "--metric", metric];
    }
    default:
      return null;
  }
}

function runResearch(bin: string, root: string | undefined, argv: string[]): Promise<{ status: number; body: string }> {
  const full = [...(root ? ["--root", root] : []), "--json", ...argv];
  return new Promise((resolve) => {
    execFile(bin, full, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      // `xtrm-research` prints a JSON envelope even on failure; pass it through when present.
      const body = stdout.trim();
      if (body.startsWith("{")) return resolve({ status: 200, body });
      resolve({
        status: 502,
        body: JSON.stringify({ ok: false, error: err ? `xtrm-research failed: ${err.message}` : "xtrm-research returned no JSON", stderr: stderr.slice(0, 500) }),
      });
    });
  });
}

export function researchCliApi(opts: { bin?: string; prefix?: string } = {}): Plugin {
  const bin = opts.bin ?? process.env.XTRM_RESEARCH_BIN ?? "xtrm-research";
  const root = process.env.XTRM_RESEARCH_ROOT || undefined;
  const prefix = opts.prefix ?? "/xtrm-api/research";
  // ponytail: in-process TTL cache, same shape as the Substrate bridge's (server/substrate-cli.ts).
  const cache = new Map<string, { at: number; value: Promise<{ status: number; body: string }> }>();

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    const path = url.pathname.slice(prefix.length);
    res.setHeader("content-type", "application/json");

    if (req.method !== "GET") {
      res.statusCode = 405;
      return res.end();
    }

    const argv = readArgv(path, url.searchParams);
    if (!argv) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: "unsupported research read" }));
    }
    const key = argv.join(" ");
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      hit = { at: Date.now(), value: runResearch(bin, root, argv) };
      cache.set(key, hit);
    }
    const { status, body } = await hit.value;
    if (status !== 200) cache.delete(key);
    res.statusCode = status;
    return res.end(body);
  };

  return {
    name: "xtrm-research-cli",
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
}
