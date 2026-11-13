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

/**
 * `sb journal feed` support (XTRM-764). Unlike the paging probe, an old binary
 * answers with a valid envelope too: it fails on the VERB, not on the shape. So
 * the refusal text decides, and anything else with the envelope means the verb
 * exists (a bad probe project is still an answer from a binary that has it).
 */
export function interpretFeedProbe(body: string): boolean | null {
  if (/unknown journal verb: feed/.test(body)) return false;
  if (/unknown flag --limit/.test(body)) return false;
  if (/"schema"\s*:\s*"substrate-cli\/v1"/.test(body)) return true;
  return null;
}

/** A downgrade is re-probed after this long, so an sb upgrade needs no restart. */
export const JOURNAL_PROBE_MS = 10 * 60_000;

/** What `/capabilities` reports about how the CLI reaches the board. */
export interface BridgeConnection {
  /** `local` when the CLI reads its own database; `ssh` when it forwards to the server. */
  mode: string;
  host?: string;
  latencyMs?: number | null;
  serverVersion?: string;
  ok: boolean;
  error?: string;
}

/** The connection probe is cheap on a local db and ~0.5 s over ssh, so it is cached briefly. */
export const CONNECTION_PROBE_MS = 15_000;

/**
 * Parse `sb remote status`. A refusal names its own failure, so the footer can show
 * `offline` instead of silently presenting local reads as canonical.
 */
export function interpretRemoteStatus(body: string): BridgeConnection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const envelope = parsed as { ok?: unknown; error?: unknown; data?: Record<string, unknown> };
  if (envelope.ok === false) {
    return { ok: false, mode: "unknown", error: typeof envelope.error === "string" ? envelope.error : "remote status failed" };
  }
  const data = envelope.data;
  if (!data || typeof data.mode !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    ok: true,
    mode: data.mode,
    host: str(data.host),
    latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
    serverVersion: str(data.serverVersion),
  };
}

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
    case "/journal-feed": {
      // Project-wide feed (substrate >= 0.3.3): one page per call, newest
      // first. `cursor` is opaque and goes back as `--before` (older) or
      // `--since` (poll for newer); `since` also carries a time bound.
      // `prj` is the PROJECT_RE-validated value from the top of readArgv: this is
      // the trust boundary between a URL and an argv, so a project id that fails
      // the pattern must be refused here, not by the CLI's own parse downstream.
      if (!prj) return null;
      const feedLimit = Number(params.get("limit") ?? "50");
      if (!Number.isInteger(feedLimit) || feedLimit <= 0 || feedLimit > JOURNAL_PAGE_MAX) return null;
      const argv = ["journal", "feed", "--project", prj, "--limit", String(feedLimit)];
      const kindRaw = params.get("kind");
      if (kindRaw !== null) {
        const kinds = kindRaw.split(",").map((k) => str(k.trim(), 40)).filter((k): k is string => k !== null);
        if (kinds.length === 0 || kinds.length > 20) return null;
        argv.push("--kind", kinds.join(","));
      }
      const cursorRaw = params.get("cursor");
      const sinceRaw = params.get("since");
      // Both name the same page bound and the CLI refuses the pair; refusing it
      // here gives the caller one clear answer instead of a forwarded argv that
      // is guaranteed to fail.
      if (cursorRaw !== null && sinceRaw !== null) return null;
      if (cursorRaw !== null) {
        const cursor = str(cursorRaw);
        if (!cursor) return null;
        argv.push("--before", cursor);
      }
      if (sinceRaw !== null) {
        const since = str(sinceRaw);
        if (!since) return null;
        argv.push("--since", since);
      }
      return argv;
    }
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
/**
 * A binary resolved from an npm-prepended `node_modules/.bin` is the usual way a
 * newer `sb` gets shadowed: npm puts every ancestor `node_modules/.bin` first, so
 * an old install in a parent folder silently wins over the global one (XTRM-644).
 */
export function shadowedBinHint(bin: string): string | null {
  return /[\\/]node_modules[\\/]\.bin[\\/]/.test(bin)
    ? "resolved from node_modules/.bin, which npm puts first on PATH: a newer global sb may be shadowed"
    : null;
}

/** One line naming the binary a journal-paging downgrade came from. */
export function downgradeNotice(bin: string, version: string | null): string {
  return `[substrate bridge] ${bin} (sb ${version ?? "unknown"}) rejects \`journal show --tail\`: journal reads use one page. Set XTRM_SB_BIN to an sb >= 0.3.2 if this is a shadowed copy.`;
}

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

/** A repository named `owner/name`; the only shape a URL may supply. */
const GIT_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** The git log window the Activity feed asks for. */
export const GIT_LOG_MAX = 100;

interface GitCommit {
  sha: string;
  author: string;
  subject: string;
  at: number;
}

/**
 * Resolve the on-disk checkout for a repository by asking sb for the linked
 * git roots and comparing each root's `origin` remote. The path never comes
 * from the request: a URL supplies only `owner/name`, and an unmatched name
 * fails closed instead of reading whatever directory happens to sit there.
 */
export function resolveCheckoutRoot(roots: string[], remotes: Map<string, string | null>, repo: string): string | null {
  for (const root of roots) {
    const remote = remotes.get(root) ?? null;
    if (remote === null) continue;
    const normalized = remote
      .replace(/^git@github\.com:/, "")
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
    if (normalized.toLowerCase() === repo.toLowerCase()) return root;
  }
  return null;
}

/** One line per commit; the separators are unit/record separators so a subject with tabs survives. */
export function parseGitLog(stdout: string): GitCommit[] {
  const out: GitCommit[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const [sha, author, at, subject] = line.split("\u001f");
    if (!sha || !author || !at) continue;
    const seconds = Number(at);
    if (!Number.isFinite(seconds)) continue;
    out.push({ sha, author, subject: subject ?? "", at: seconds * 1000 });
  }
  return out;
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
  const shadowed = shadowedBinHint(bin);
  if (shadowed) console.log(`[substrate bridge] sb: ${bin} — ${shadowed}`);
  let binVersion: string | null = null;
  let versionRead = false;
  const readBinVersion = async (): Promise<string | null> => {
    if (versionRead) return binVersion;
    versionRead = true;
    try {
      const { body } = await runSb(bin, undefined, ["--version"]);
      const parsed = JSON.parse(body) as { data?: { version?: unknown } };
      if (typeof parsed.data?.version === "string") binVersion = parsed.data.version;
    } catch {
      // keep null: the notice says "unknown"
    }
    return binVersion;
  };
  const journalPaging = async (): Promise<boolean | null> => {
    if (pagingSupport && Date.now() - pagingSupport.at < JOURNAL_PROBE_MS) return pagingSupport.value;
    const { body } = await runSb(bin, db, ["journal", "show", "--tail", "1"]);
    const value = interpretJournalProbe(body);
    if (value !== null) {
      if (value === false && pagingSupport?.value !== false) console.warn(downgradeNotice(bin, await readBinVersion()));
      pagingSupport = { value, at: Date.now() };
    }
    return value;
  };
  // XTRM-764: the project-wide feed. Kept beside journalPaging because a caller
  // that wants the mixed Activity feed needs both (a feed page, then bodies).
  let feedSupport: { value: boolean; at: number } | null = null;
  const journalFeed = async (): Promise<boolean | null> => {
    if (feedSupport && Date.now() - feedSupport.at < JOURNAL_PROBE_MS) return feedSupport.value;
    // The probe project does not exist on purpose: a binary that HAS the verb
    // answers with a project error, and the interpreter reads only the refusal
    // shape, so the probe neither reads nor writes real board state.
    const { body } = await runSb(bin, db, ["journal", "feed", "--project", "__probe__", "--limit", "1"]);
    const value = interpretFeedProbe(body);
    if (value !== null) {
      if (value === false && feedSupport?.value !== false) console.warn(downgradeNotice(bin, await readBinVersion()));
      feedSupport = { value, at: Date.now() };
    }
    return value;
  };
  // Where the board actually lives. Without this the footer cannot tell a canonical
  // ssh read from a local one, which is how a shadowed binary looked like a regression.
  let connection: { value: BridgeConnection; at: number } | null = null;
  const readConnection = async (): Promise<BridgeConnection | null> => {
    if (connection && Date.now() - connection.at < CONNECTION_PROBE_MS) return connection.value;
    try {
      const { body } = await runSb(bin, db, ["remote", "status"]);
      const value = interpretRemoteStatus(body);
      if (value) connection = { value, at: Date.now() };
      return value;
    } catch {
      return null;
    }
  };

  // XTRM-757: the local git log behind the Activity feed's git source. The
  // checkout is resolved from sb's own links, so a request can only name a
  // repository the board already knows.
  const readGitLog = async (repo: string, limit: number): Promise<{ status: number; body: string }> => {
    const fail = (error: string) => ({ status: 200, body: JSON.stringify({ ok: false, error }) });
    const links = await runSb(bin, db, ["project", "links"]);
    let roots: string[] = [];
    try {
      const parsed = JSON.parse(links.body) as { ok?: boolean; data?: { links?: Array<{ gitRoot?: unknown }> } };
      if (parsed.ok === false) return fail("sb project links failed");
      roots = (parsed.data?.links ?? []).map((l) => l.gitRoot).filter((r): r is string => typeof r === "string" && r !== "");
    } catch {
      return fail("sb project links returned no JSON");
    }
    if (roots.length === 0) return fail("no linked git checkout to read");
    const remotes = new Map<string, string | null>();
    for (const root of roots) {
      remotes.set(
        root,
        await new Promise<string | null>((resolve) => {
          execFile("git", ["-C", root, "config", "--get", "remote.origin.url"], { timeout: 5_000 }, (err, stdout) =>
            resolve(err ? null : stdout.trim() || null),
          );
        }),
      );
    }
    const root = resolveCheckoutRoot(roots, remotes, repo);
    if (root === null) return fail(`no linked checkout for ${repo}`);
    const log = await new Promise<string | null>((resolve) => {
      execFile(
        "git",
        ["-C", root, "log", `-${limit}`, "--date=unix", "--format=%H%x1f%an%x1f%at%x1f%s"],
        { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : stdout),
      );
    });
    if (log === null) return fail(`git log failed in ${root}`);
    return { status: 200, body: JSON.stringify({ ok: true, repo, root, commits: parseGitLog(log) }) };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(prefix)) return next();
    const path = url.pathname.slice(prefix.length);
    res.setHeader("content-type", "application/json");

    if (req.method === "GET") {
      if (path === "/capabilities") {
        return res.end(
          JSON.stringify({
            writes,
            db: db ? "custom" : "default",
            journalPaging: await journalPaging(),
            journalFeed: await journalFeed(),
            sb: bin,
            sbVersion: await readBinVersion(),
            connection: await readConnection(),
          }),
        );
      }
      if (path === "/git-log") {
        // XTRM-757: the git source. The bridge reads the checkout on disk; the
        // request names a repository, never a path.
        const repo = url.searchParams.get("repo") ?? "";
        const rawLimit = Number(url.searchParams.get("limit") ?? "40");
        if (!GIT_REPO_RE.test(repo)) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: "expected repo=owner/name" }));
        }
        if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > GIT_LOG_MAX) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: `limit must be 1..${GIT_LOG_MAX}` }));
        }
        const key = `git-log ${repo} ${rawLimit}`;
        let hit = cache.get(key);
        if (!hit || Date.now() - hit.at > TTL_MS) hit = { at: Date.now(), value: readGitLog(repo, rawLimit) };
        cache.set(key, hit);
        const { status, body } = await hit.value;
        if (status !== 200) cache.delete(key);
        res.statusCode = status;
        return res.end(body);
      }
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
