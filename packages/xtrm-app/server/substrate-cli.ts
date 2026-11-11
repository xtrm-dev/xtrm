// Dev-server bridge to the Substrate typed service through its documented CLI
// envelope (`sb --json ...`, schema substrate-cli/v1).
//
// Why the CLI and not `openSubstrate()` from source: opening the canonical
// ~/.xtrm/state.db from this package's source tree runs `migrate()` with
// whatever schema this checkout carries, which may differ from the installed
// `sb`. The installed CLI is the typed service at the version that owns the
// database. No SQL is issued from this package (shell architecture §9.3).
//
// Only the commands built by `readArgv` / `writeArgv` can run. Inputs are validated.
// Writes are real Substrate mutations (Jira-style editing). Set XTRM_SUBSTRATE_WRITES=0
// to make the bridge read-only, or XTRM_SB_DB=<path> to target a development database.

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { delimiter, dirname, join } from "node:path";
import type { Plugin } from "vite";

const PROJECT_RE = /^prj_[a-z0-9_-]{1,64}$/i;
const REF_RE = /^[A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*$|^iss_[0-9a-f-]{36}$/;
const LIFECYCLE = new Set(["open", "deferred", "done", "cancelled", "archived"]);
const KINDS = new Set(["epic", "task", "bug", "decision", "research", "followup"]);
const NOTE_KINDS = new Set(["note", "finding", "decision", "blocker", "milestone", "handoff", "result"]);
const SCRUTINY = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const TTL_MS = 5_000;
const MAX_TEXT = 200_000;
/**
 * What a probe of `journal show --tail` proves. `false` only when the CLI names
 * the flag as unknown — a locked DB, an unknown ref or a missing binary must
 * not downgrade the console for its whole lifetime.
 */
export function interpretJournalProbe(body: string): boolean | null {
  if (/unknown flag --tail/.test(body)) return false;
  if (/"schema"\s*:\s*"substrate-cli\/v1"/.test(body)) return true;
  return null;
}

/** A downgrade is re-probed after this long, so an sb upgrade needs no restart. */
export const JOURNAL_PROBE_MS = 10 * 60_000;

/** Per-page ceiling for the journal read, paged or not. */
const JOURNAL_PAGE_MAX = 2000;
/** What a legacy CLI returns in one read; the fallback matches the old tab. */
const JOURNAL_LEGACY_LIMIT = 2000;

const project = (p: URLSearchParams | Record<string, unknown>, key = "project") => {
  const v = p instanceof URLSearchParams ? p.get(key) : p[key];
  return typeof v === "string" && PROJECT_RE.test(v) ? v : null;
};
const ref = (p: URLSearchParams | Record<string, unknown>, key = "ref") => {
  const v = p instanceof URLSearchParams ? p.get(key) : p[key];
  return typeof v === "string" && REF_RE.test(v) ? v : null;
};

export function readArgv(pathname: string, params: URLSearchParams): string[] | null {
  const prj = project(params);
  const r = ref(params);
  switch (pathname) {
    case "/projects":
      return ["project", "list"];
    case "/links":
      return ["project", "links"];
    case "/issues":
      return prj ? ["issue", "list", "--project", prj] : null;
    case "/query": {
      // Board projection (`sb issue query`, XTRM-393). Limit is an integer 1..500
      // (MAX_PAGE_LIMIT); the cursor is opaque base64url validated by str().
      if (!prj) return null;
      const rawLimit = params.get("limit");
      const limit = rawLimit === null ? 500 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return null;
      const argv = ["issue", "query", "--project", prj, "--limit", String(limit)];
      const rawCursor = params.get("cursor");
      if (rawCursor !== null) {
        const cursor = str(rawCursor);
        if (!cursor) return null;
        argv.push("--cursor", cursor);
      }
      return argv;
    }
    case "/issue":
      return r ? ["issue", "show", r] : null;
    case "/resume":
      return r ? ["issue", "resume", r] : null;
    case "/trace":
      return r ? ["provenance", "trace", r] : null;
    case "/journal": {
      if (!r) return null;
      // Paged reads (substrate >= 0.3.1): `tail` is the newest window, `before`
      // is the backwards cursor for older pages. `limit` alone keeps the
      // legacy oldest-first read.
      const tailRaw = params.get("tail");
      if (tailRaw !== null) {
        const tail = Number(tailRaw);
        return Number.isInteger(tail) && tail > 0 && tail <= JOURNAL_PAGE_MAX ? ["journal", "show", r, "--tail", String(tail)] : null;
      }
      const limit = Number(params.get("limit") ?? "50");
      if (!Number.isInteger(limit) || limit <= 0 || limit > JOURNAL_PAGE_MAX) return null;
      const beforeRaw = params.get("before");
      if (beforeRaw !== null) {
        const before = Number(beforeRaw);
        return Number.isInteger(before) && before > 0 ? ["journal", "show", r, "--before", String(before), "--limit", String(limit)] : null;
      }
      return ["journal", "show", r, "--limit", String(limit)];
    }
    default:
      return null;
  }
}

const str = (v: unknown, max = MAX_TEXT) => (typeof v === "string" && v.length > 0 && v.length <= max && !v.startsWith("-") ? v : null);

/** Mutations. Every write names its project so `sb` never resolves context from the server cwd. */
export function writeArgv(pathname: string, body: Record<string, unknown>): string[] | null {
  const prj = project(body);
  const r = ref(body);
  if (!prj) return null;
  switch (pathname) {
    case "/edit": {
      if (!r) return null;
      const rev = body.expectedRevision;
      if (!Number.isInteger(rev) || (rev as number) < 1) return null;
      const argv = ["issue", "edit", r, "--project", prj, "--expected-revision", String(rev)];
      let changes = 0;
      if (body.title !== undefined) {
        const t = str(body.title, 500);
        if (!t) return null;
        argv.push("--title", t);
        changes++;
      }
      if (body.priority !== undefined) {
        if (!Number.isInteger(body.priority) || (body.priority as number) < 0 || (body.priority as number) > 4) return null;
        argv.push("--priority", String(body.priority));
        changes++;
      }
      if (body.scrutiny !== undefined) {
        if (typeof body.scrutiny !== "string" || !SCRUTINY.has(body.scrutiny)) return null;
        argv.push("--scrutiny", body.scrutiny);
        changes++;
      }
      if (body.contract !== undefined) {
        if (!body.contract || typeof body.contract !== "object" || Array.isArray(body.contract)) return null;
        const json = JSON.stringify(body.contract);
        if (json.length > MAX_TEXT) return null;
        argv.push("--contract", json);
        changes++;
      }
      return changes ? argv : null;
    }
    case "/state": {
      const state = body.state;
      return r && typeof state === "string" && LIFECYCLE.has(state) ? ["issue", "state", r, state, "--project", prj] : null;
    }
    case "/note": {
      const text = str(body.text);
      const kind = typeof body.kind === "string" && NOTE_KINDS.has(body.kind) ? body.kind : "note";
      return r && text ? ["issue", "note", r, text, "--kind", kind, "--project", prj] : null;
    }
    case "/create": {
      const title = str(body.title, 500);
      const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
      const scrutiny = typeof body.scrutiny === "string" && SCRUTINY.has(body.scrutiny) ? body.scrutiny : null;
      if (!title || !kind || !scrutiny || !body.contract || typeof body.contract !== "object") return null;
      const argv = ["issue", "create", "--project", prj, "--title", title, "--kind", kind, "--scrutiny", scrutiny, "--contract", JSON.stringify(body.contract)];
      if (Number.isInteger(body.priority) && (body.priority as number) >= 0 && (body.priority as number) <= 4) argv.push("--priority", String(body.priority));
      const parent = ref(body, "parent");
      if (parent) argv.push("--parent", parent);
      return argv;
    }
    default:
      return null;
  }
}

/**
 * Resolve `sb` without trusting PATH alone. A dev server started from a
 * non-login shell (agent session, tmux, systemd, cron) has no nvm bin dir on
 * PATH even though the running node lives in one — and a globally installed
 * `sb` sits next to that node. Without this the bridge fails with
 * `spawn sb ENOENT` while `sb` works fine in every interactive shell.
 * A name containing a path separator is taken as given.
 */
export function resolveSbBin(bin: string): string {
  if (bin.includes("/") || bin.includes("\\")) return bin;
  for (const dir of [...(process.env.PATH ?? "").split(delimiter), dirname(process.execPath)]) {
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here; keep looking
    }
  }
  return bin; // nothing found: let execFile report ENOENT
}

function runSb(bin: string, db: string | undefined, argv: string[]): Promise<{ status: number; body: string }> {
  const full = [...(db ? ["--db", db] : []), "--json", ...argv];
  return new Promise((resolve) => {
    execFile(bin, full, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      // `sb` prints a JSON envelope even on failure; pass it through when present.
      const body = stdout.trim();
      if (body.startsWith("{")) return resolve({ status: 200, body });
      resolve({
        status: 502,
        body: JSON.stringify({ ok: false, error: err ? `sb failed (bin=${bin}): ${err.message}` : "sb returned no JSON", stderr: stderr.slice(0, 500) }),
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > MAX_TEXT * 2) req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export function substrateCliApi(opts: { bin?: string; prefix?: string } = {}): Plugin {
  const bin = resolveSbBin(opts.bin ?? process.env.XTRM_SB_BIN ?? "sb");
  const db = process.env.XTRM_SB_DB || undefined;
  const writes = process.env.XTRM_SUBSTRATE_WRITES !== "0";
  const prefix = opts.prefix ?? "/xtrm-api/substrate";
  // ponytail: in-process TTL cache cleared on every write; a real host needs a shared read model + change feed (XTRM-393).
  const cache = new Map<string, { at: number; value: Promise<{ status: number; body: string }> }>();
  let pagingSupport: { value: boolean; at: number } | null = null;
  // Flags are validated before arguments, so this probe needs no real ref. The
  // answer is time-boxed, not process-lifetime: after an sb upgrade a restart
  // would otherwise be the only way back to the paged read.
  const journalPaging = async (): Promise<boolean | null> => {
    if (pagingSupport && Date.now() - pagingSupport.at < JOURNAL_PROBE_MS) return pagingSupport.value;
    const { body } = await runSb(bin, db, ["journal", "show", "--tail", "1"]);
    const value = interpretJournalProbe(body);
    if (value !== null) pagingSupport = { value, at: Date.now() };
    return value;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    const path = url.pathname.slice(prefix.length);
    res.setHeader("content-type", "application/json");

    if (req.method === "GET") {
      if (path === "/capabilities") return res.end(JSON.stringify({ writes, db: db ? "custom" : "default", journalPaging: await journalPaging() }));
      const argv = readArgv(path, url.searchParams);
      if (!argv) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: "unsupported substrate read" }));
      }
      // An installed sb older than 0.3.1 rejects `--tail`/`--before`. Probe it,
      // then serve the legacy read so the tab degrades to its previous content
      // instead of failing. An inconclusive probe (null) leaves the request
      // alone so the caller sees the real error rather than a silent downgrade.
      const paged = argv[0] === "journal" && (argv.includes("--tail") || argv.includes("--before"));
      const support = paged && path === "/journal" ? await journalPaging() : null;
      const effective = support === false ? ["journal", "show", argv[2]!, "--limit", String(JOURNAL_LEGACY_LIMIT)] : argv;
      // Tell the app which read it actually got: legacy cannot page at all.
      if (path === "/journal" && argv[0] === "journal") res.setHeader("x-xtrm-journal-paging", effective === argv ? "cursor" : "legacy");
      const key = effective.join(" ");
      let hit = cache.get(key);
      if (!hit || Date.now() - hit.at > TTL_MS) {
        hit = { at: Date.now(), value: runSb(bin, db, effective) };
        cache.set(key, hit);
      }
      const { status, body } = await hit.value;
      if (status !== 200) cache.delete(key);
      res.statusCode = status;
      return res.end(body);
    }

    if (req.method === "POST") {
      if (!writes) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok: false, error: "substrate writes are disabled (XTRM_SUBSTRATE_WRITES=0)" }));
      }
      // Same-origin only: the dev server may be reachable on the tailnet.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ ok: false, error: "cross-origin write rejected" }));
      }
      const body = await readBody(req);
      const argv = body ? writeArgv(path, body) : null;
      if (!argv) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: "invalid substrate write" }));
      }
      const { status, body: out } = await runSb(bin, db, argv);
      cache.clear();
      res.statusCode = status;
      return res.end(out);
    }

    res.statusCode = 405;
    res.end();
  };

  return {
    name: "xtrm-substrate-cli",
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
}
