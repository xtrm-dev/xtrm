import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowedPath,
  createBoardClient,
  defaultConfigPath,
  loadPmConfig,
  normaliseDoc,
  normaliseRepo,
  publicBinding,
  readHealth,
  resolveBinding,
  statusBoardApi,
  unboundBody,
  type PmConfig,
} from "./status-board-api.ts";

const CONFIG: PmConfig = {
  defaults: {
    jira_site: "https://mercuryintel.atlassian.net",
    jira_token_file: "/home/dawid/.secrets/atlassian-api-token.txt",
    timezone: "Europe/Berlin",
  },
  projects: {
    mercury: {
      repo_slug: "mercuryintelligence/market-data",
      repo_name: "market-data",
      sb_project_id: "prj_mmd",
      status_board_site: "velvet-breeze-fbm8",
      status_board_state_dir: "/home/dawid/.xtrm/product/market-data/tabellone",
      status_board_key_file: "/home/dawid/.herenow/credentials",
      status_board_unit: "status-board-sync.service",
      jira_project: "ISSUE",
      jira_board_id: "1",
    },
  },
};

describe("binding resolution", () => {
  it("matches the repository by repo_slug, which is the file the sync reads", () => {
    const b = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    expect(b.resolvedBy).toBe("repo_slug");
    expect(b.pmProject).toBe("mercury");
    expect(b.substrateProjectId).toBe("prj_mmd");
    expect(b.site).toBe("velvet-breeze-fbm8");
    expect(b.timezone).toBe("Europe/Berlin");
    expect(b.jira).toEqual({
      site: "https://mercuryintel.atlassian.net",
      project: "ISSUE",
      boardId: "1",
      tokenFile: "/home/dawid/.secrets/atlassian-api-token.txt",
    });
  });

  it("prefers an explicit project, then the environment, then repo_name", () => {
    expect(resolveBinding(CONFIG, "someone/other", { explicit: "mercury", env: {} }).resolvedBy).toBe("explicit");
    expect(resolveBinding(CONFIG, "someone/other", { env: { XTRM_PM_PROJECT: "mercury" } }).resolvedBy).toBe("env");
    expect(resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} }).pmProject).toBe("mercury");
    const byName = resolveBinding({ projects: { alias: { repo_name: "market-data" } } }, "mercuryintelligence/market-data", { env: {} });
    expect(byName.resolvedBy).toBe("repo_name");
  });

  it("ignores a project entry that is not an object instead of throwing", () => {
    // A hand-edited config can hold `null`. resolveBinding read `project.repo_slug`
    // off it unguarded, inside a middleware whose rejection has no handler.
    const broken = { projects: { bad: null, alias: { repo_name: "market-data" } } } as unknown as PmConfig;
    expect(() => resolveBinding(broken, "mercuryintelligence/market-data", { env: {} })).not.toThrow();
    expect(resolveBinding(broken, "mercuryintelligence/market-data", { env: {} }).resolvedBy).toBe("repo_name");
    expect(resolveBinding(broken, "xtrm-dev/xtrm", { env: {} }).configured).toBe(false);
  });

  it("reports an unconfigured repository instead of guessing", () => {
    const b = resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} });
    expect(b.configured).toBe(false);
    expect(b.configPresent).toBe(true);
    expect(b.resolvedBy).toBe("none");
    expect(b.site).toBeNull();
    expect(b.timezone).toBe("Europe/Berlin");
    expect(readHealth(b).reason).toBe("repo_not_bound");
    expect(readHealth(b).stale).toBe(false);
  });

  it("survives an absent or unreadable config at plugin init, so a build cannot fail on it", () => {
    // The production unit runs `vite build` then preview: a throw in the plugin
    // factory would take the whole console down and restart it in a loop.
    const dir = mkdtempSync(join(tmpdir(), "pm-absent-"));
    const asDirectory = join(dir, "as-directory.json");
    mkdirSync(asDirectory);
    expect(loadPmConfig(asDirectory)).toBeNull();
    for (const configPath of [join(dir, "absent.json"), asDirectory, "/nope/none.json"]) {
      expect(() => statusBoardApi({ configPath })).not.toThrow();
      expect(statusBoardApi({ configPath }).name).toBe("xtrm-status-board");
    }
    const unconfigured = resolveBinding(null, "mercuryintelligence/market-data", { env: {} });
    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.configPresent).toBe(false);
    expect(unconfigured.site).toBeNull();
    expect(readHealth(unconfigured).configured).toBe(false);
    expect(readHealth(unconfigured).reason).toBe("config_absent");
    expect(readHealth(unconfigured).stale).toBe(false);
    // The distinct sentences: "not configured on this deployment" vs "this repository is not bound".
    expect(unboundBody(unconfigured)).toMatchObject({ reason: "config_absent", configPath: defaultConfigPath() });
    expect(unboundBody(resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} }))).toMatchObject({ reason: "repo_not_bound" });
  });

  it("treats a missing or malformed config as no bindings", () => {
    expect(loadPmConfig("/nope/does-not-exist.json")).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "pm-config-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(loadPmConfig(bad)).toBeNull();
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(CONFIG));
    expect(loadPmConfig(good)?.projects?.mercury).toBeTruthy();
    expect(defaultConfigPath({ XTRM_PM_CONFIG: good })).toBe(good);
  });

  it("names the config file it actually read, not the default path", () => {
    const explicit = unboundBody(
      resolveBinding(null, "mercuryintelligence/market-data", { env: {}, configPath: "/srv/xtrm/pm.json" }),
    );
    expect(explicit.configPath).toBe("/srv/xtrm/pm.json");
    const fromEnv = unboundBody(
      resolveBinding(null, "mercuryintelligence/market-data", { env: { XTRM_PM_CONFIG: "/srv/env.json" } }),
    );
    expect(fromEnv.configPath).toBe("/srv/env.json");
  });

  it("gives the client two distinct unbound reasons, with the resolved config path", () => {
    const noConfig = unboundBody(resolveBinding(null, "mercuryintelligence/market-data", { env: {} }));
    expect(noConfig.reason).toBe("config_absent");
    expect(noConfig.configPath).toBe(defaultConfigPath());
    const noEntry = unboundBody(resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} }));
    expect(noEntry.reason).toBe("repo_not_bound");
    expect(noEntry.configPath).toBeUndefined();
  });

  it("rejects anything that is not a plain owner/name slug", () => {
    expect(normaliseRepo("mercuryintelligence/market-data")).toBe("mercuryintelligence/market-data");
    expect(normaliseRepo("MercuryIntelligence/Market-Data")).toBe("mercuryintelligence/market-data");
    expect(normaliseRepo("../etc/passwd")).toBeNull();
    expect(normaliseRepo("owner/name/extra")).toBeNull();
    expect(normaliseRepo(null)).toBeNull();
  });
});

describe("path allowlisting", () => {
  it("accepts the documented collections only", () => {
    expect(allowedPath("workers/dawid-main")).toBe(true);
    expect(allowedPath("schedule/2026-11-17")).toBe(true);
    expect(allowedPath("answers/q-42")).toBe(true);
    expect(allowedPath("board/next")).toBe(true);
  });

  it("refuses traversal, unknown collections and nested paths", () => {
    expect(allowedPath("workers/../../etc/passwd")).toBe(false);
    expect(allowedPath("secrets/key")).toBe(false);
    expect(allowedPath("workers/a/b")).toBe(false);
    expect(allowedPath("")).toBe(false);
    expect(allowedPath("workers/")).toBe(false);
    expect(allowedPath("workers//x")).toBe(false);
  });
});

describe("document normalisation", () => {
  it("parses a JSON string doc and passes objects through", () => {
    expect(normaliseDoc('{"answer":"yes"}')).toEqual({ answer: "yes" });
    expect(normaliseDoc({ answer: "yes" })).toEqual({ answer: "yes" });
    expect(normaliseDoc("{broken")).toBe("{broken");
  });
});

describe("board client", () => {
  const page = (records: unknown[], next?: string) => ({
    ok: true,
    json: async () => ({ records, nextCursor: next }),
  });
  const record = (path: string) => ({ id: `rec_${path}`, updatedAt: "2026-11-17T08:00:00Z", data: { path, doc: '{"status":"active"}' } });

  it("pages through the store, filters by prefix, and sends the bearer", async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    const fetchImpl = (async (url: URL, init?: RequestInit) => {
      const cursor = new URL(url).searchParams.get("cursor");
      calls.push({ url: url.toString(), auth: (init?.headers as Record<string, string>).authorization });
      return cursor
        ? page([record("workers/bob"), record("followups/f-1")])
        : page([record("workers/alice")], "cursor-2");
    }) as unknown as typeof fetch;

    const client = createBoardClient({ site: "site-a", key: () => "secret-value", fetchImpl });
    const result = await client.list("workers/", { limit: 200 });
    expect(result.records.map((r) => r.path)).toEqual(["workers/alice", "workers/bob"]);
    expect(result.records[0]!.doc).toEqual({ status: "active" });
    expect(result.truncated).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/publishes/site-a/data/docs");
    expect(calls.every((c) => c.auth === "Bearer secret-value")).toBe(true);
  });

  it("caps at the requested limit and reports truncation", async () => {
    const fetchImpl = (async () => page([record("workers/a"), record("workers/b"), record("workers/c")])) as unknown as typeof fetch;
    const client = createBoardClient({ site: "site-a", key: () => "k", fetchImpl });
    const result = await client.list("workers/", { limit: 2 });
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("finds one record by exact path and reports absence separately from incompleteness", async () => {
    const fetchImpl = (async () => page([record("workers/a"), record("workers/b")])) as unknown as typeof fetch;
    const client = createBoardClient({ site: "site-a", key: () => "k", fetchImpl });
    const found = await client.record("workers/b");
    expect(found.outcome).toBe("found");
    expect(found.outcome === "found" && found.record.path).toBe("workers/b");
    expect(await client.record("workers/zzz")).toEqual({ outcome: "absent" });
  });

  it("says truncated when the page budget runs out with a cursor still set", async () => {
    // Every page offers a next cursor and no matching record: the loop stops on
    // MAX_PAGES, which is "I stopped looking", never "that is the whole board".
    const fetchImpl = (async () => page([record("followups/f-1")], "cursor-again")) as unknown as typeof fetch;
    const client = createBoardClient({ site: "site-a", key: () => "k", fetchImpl });
    expect(await client.list("workers/", { limit: 200 })).toEqual({ records: [], truncated: true });
  });

  it("reports an inconclusive record lookup instead of a definite absence", async () => {
    const fetchImpl = (async () => page([record("followups/f-1")], "cursor-again")) as unknown as typeof fetch;
    const client = createBoardClient({ site: "site-a", key: () => "k", fetchImpl });
    expect(await client.record("workers/never-seen")).toEqual({ outcome: "incomplete" });
  });

  it("puts a deadline on every upstream call and never lets an abort surface raw", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_url: URL, init?: RequestInit) => {
      seen = init;
      return page([record("workers/a")]);
    }) as unknown as typeof fetch;
    await createBoardClient({ site: "site-a", key: () => "k", fetchImpl }).list("workers/", { limit: 10 });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect((seen?.signal as AbortSignal).aborted).toBe(false);

    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const aborting = (async () => {
      throw timeout;
    }) as unknown as typeof fetch;
    await expect(
      createBoardClient({ site: "site-a", key: () => "k", fetchImpl: aborting, timeoutMs: 50 }).list("workers/", { limit: 10 }),
    ).rejects.toThrow("status board read timed out after 50 ms");
    await expect(
      createBoardClient({ site: "site-a", key: () => "k", fetchImpl: aborting, timeoutMs: 50 }).list("workers/", { limit: 10 }),
    ).rejects.not.toThrow("secret-value");
  });

  it("never echoes the credential on an upstream failure", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    const client = createBoardClient({ site: "site-a", key: () => "secret-value", fetchImpl });
    await expect(client.list("workers/", { limit: 10 })).rejects.toThrow("status board read failed (401)");
    await expect(client.list("workers/", { limit: 10 })).rejects.not.toThrow("secret-value");
  });
});

describe("health", () => {
  it("derives the sync marker and drift count from the state directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-state-"));
    writeFileSync(join(dir, "state.json"), "{}");
    writeFileSync(join(dir, "drift.jsonl"), '{"a":1}\n{"b":2}\n');
    const old = new Date("2026-11-17T06:00:00Z");
    utimesSync(join(dir, "state.json"), old, old);
    const binding = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    const health = readHealth({ ...binding, stateDir: dir }, Date.parse("2026-11-17T09:00:00Z"), true);
    expect(health.lastSyncOkAt).toBe("2026-11-17T06:00:00.000Z");
    expect(health.driftCount).toBe(2);
    expect(health.stale).toBe(true);
    expect(health.unitActive).toBe(true);
    expect(health.configured).toBe(true);
  });

  it("reports unknown, not zero, when the state files are absent", () => {
    const binding = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    const health = readHealth({ ...binding, stateDir: join(tmpdir(), "definitely-absent-dir-xyz") }, Date.now(), null);
    expect(health.lastSyncOkAt).toBeNull();
    expect(health.driftCount).toBeNull();
    expect(health.unitActive).toBeNull();
    expect(health.stale).toBe(true);
  });

  it("is not stale for an unconfigured repository, and carries a null reason when configured", () => {
    const binding = resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} });
    expect(readHealth(binding).stale).toBe(false);
    const bound = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    expect(readHealth(bound).reason).toBeNull();
  });
});

describe("public binding", () => {
  it("names the credential file but never its value", () => {
    const binding = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    const view = publicBinding(binding, true);
    expect(view.keyFile).toBe("/home/dawid/.herenow/credentials");
    expect(view.keyPresent).toBe(true);
    expect(JSON.stringify(view)).not.toContain("Bearer");
    expect(Object.keys(view)).not.toContain("key");
  });
});


type Middleware = (req: unknown, res: unknown, next: () => void) => void;

/** Mount the plugin's real middleware the way Vite does, so routes are exercised end to end. */
function mount(
  plugin: ReturnType<typeof statusBoardApi>,
  hook: "configureServer" | "configurePreviewServer" = "configureServer",
): Middleware {
  let middleware: Middleware = () => {
    throw new Error("middleware was never registered");
  };
  const server = { middlewares: { use: (fn: Middleware) => (middleware = fn) } };
  (plugin[hook] as unknown as (s: unknown) => void)(server);
  return middleware;
}

async function send(middleware: Middleware, method: string, url: string) {
  const headers: Record<string, unknown> = {};
  let payload = "";
  const res = {
    statusCode: 0,
    next: false,
    setHeader(key: string, value: unknown) {
      headers[key] = value;
    },
    end(body: string) {
      payload = body;
    },
  };
  middleware({ method, url }, res, () => {
    res.next = true;
  });
  // the handler is async and its promise is intentionally not returned by the hook
  for (let i = 0; i < 200 && res.statusCode === 0 && !res.next; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { status: res.statusCode, next: res.next, body: payload ? JSON.parse(payload) : null, headers };
}

describe("status-board middleware", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-mw-"));
  const keyFile = join(dir, "credentials");
  writeFileSync(keyFile, "secret-value");
  const configPath = join(dir, "pm.json");
  const config: PmConfig = {
    defaults: { timezone: "Europe/Berlin" },
    projects: {
      mercury: {
        repo_slug: "mercuryintelligence/market-data",
        status_board_site: "site-a",
        status_board_key_file: keyFile,
        status_board_state_dir: join(dir, "tabellone"),
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const page = (records: unknown[], next?: string) => ({ ok: true, json: async () => ({ records, nextCursor: next }) });
  const wire = (path: string) => ({ id: `rec_${path}`, updatedAt: "2026-11-17T08:00:00Z", data: { path, doc: { status: "active" } } });
  const repo = "mercuryintelligence/market-data";

  it("refuses everything that is not a GET, before touching config or credential", async () => {
    const middleware = mount(statusBoardApi({ configPath, fetchImpl: (async () => page([])) as unknown as typeof fetch }));
    const res = await send(middleware, "POST", `/xtrm-api/status-board/list?repo=${repo}`);
    expect(res.status).toBe(405);
    expect(res.body.error).toContain("read-only");
  });

  it("passes unrelated paths to the next middleware instead of answering them", async () => {
    const middleware = mount(statusBoardApi({ configPath }));
    const res = await send(middleware, "GET", "/api/other");
    expect(res.next).toBe(true);
    expect(res.status).toBe(0);
  });

  it("answers 404 with repo_not_bound for a repository the config does not mention", async () => {
    const middleware = mount(statusBoardApi({ configPath }));
    const res = await send(middleware, "GET", "/xtrm-api/status-board/binding?repo=xtrm-dev/xtrm");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, reason: "repo_not_bound" });
  });

  it("registers the same handler on the preview hook, which is the production path", async () => {
    // `npm run research:serve` is `vite preview`, not `vite dev`: a bridge that only
    // works under configureServer is untested in the mode production runs.
    const middleware = mount(statusBoardApi({ configPath, fetchImpl: (async () => page([wire("workers/alice")])) as unknown as typeof fetch }), "configurePreviewServer");
    const res = await send(middleware, "GET", `/xtrm-api/status-board/list?repo=${repo}&prefix=workers`);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
  });

  it("answers instead of exiting when a projects entry is not an object", async () => {
    // The failure this guards: `{"projects":{"bad":null}}` made resolveBinding throw
    // inside `(req,res,next) => void handle(...)`, so the rejection had no handler and
    // Node's default policy exited the preview process — the console restart loop.
    const brokenPath = join(dir, "pm-broken.json");
    writeFileSync(brokenPath, JSON.stringify({ defaults: { timezone: "UTC" }, projects: { bad: null, mercury: config.projects!.mercury } }));
    const middleware = mount(statusBoardApi({ configPath: brokenPath, fetchImpl: (async () => page([wire("workers/alice")])) as unknown as typeof fetch }));
    const bound = await send(middleware, "GET", `/xtrm-api/status-board/binding?repo=${repo}`);
    expect(bound.status).toBe(200);
    expect(bound.body.binding.resolvedBy).toBe("repo_slug");
    const health = await send(middleware, "GET", "/xtrm-api/status-board/health?repo=xtrm-dev/xtrm");
    expect(health.status).toBe(404);
    expect(health.body).toMatchObject({ ok: false, reason: "repo_not_bound" });
    const list = await send(middleware, "GET", `/xtrm-api/status-board/list?repo=${repo}&prefix=workers`);
    expect(list.status).toBe(200);
  });

  it("answers 200 with a record, and 404 for a completed scan that finds nothing", async () => {
    const middleware = mount(
      statusBoardApi({
        configPath,
        fetchImpl: (async () => page([wire("workers/alice"), wire("workers/bob")])) as unknown as typeof fetch,
      }),
    );
    const hit = await send(middleware, "GET", `/xtrm-api/status-board/record?repo=${repo}&path=workers/bob`);
    expect(hit.status).toBe(200);
    expect(hit.body.record.path).toBe("workers/bob");
    const miss = await send(middleware, "GET", `/xtrm-api/status-board/record?repo=${repo}&path=workers/zzz`);
    expect(miss.status).toBe(404);
    expect(miss.body.error).toContain("not found");
  });

  it("answers 502 reason:inconclusive, and does not cache it", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return page([wire("followups/f-1")], "cursor-again");
    }) as unknown as typeof fetch;
    const middleware = mount(statusBoardApi({ configPath, fetchImpl }));
    const url = `/xtrm-api/status-board/record?repo=${repo}&path=workers/never-seen`;
    const first = await send(middleware, "GET", url);
    expect(first.status).toBe(502);
    expect(first.body).toMatchObject({ ok: false, reason: "inconclusive" });
    const afterFirst = calls;
    const second = await send(middleware, "GET", url);
    expect(second.status).toBe(502);
    // a failed read is not an answer: the second request must reach upstream again
    expect(calls).toBeGreaterThan(afterFirst);
  });

  it("reports truncation at the route, and serves a repeat read from cache", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return page([wire("followups/f-1")], "cursor-again");
    }) as unknown as typeof fetch;
    const middleware = mount(statusBoardApi({ configPath, fetchImpl }));
    const url = `/xtrm-api/status-board/list?repo=${repo}&prefix=workers&limit=50`;
    const first = await send(middleware, "GET", url);
    expect(first.status).toBe(200);
    expect(first.body.truncated).toBe(true);
    const afterFirst = calls;
    const second = await send(middleware, "GET", url);
    expect(second.status).toBe(200);
    expect(calls).toBe(afterFirst);
  });

  it("answers 503 when the credential file is missing, without calling upstream", async () => {
    const withoutKey = { ...config, projects: { mercury: { ...config.projects!.mercury, status_board_key_file: join(dir, "absent-key") } } };
    const missingKeyPath = join(dir, "pm-nokey.json");
    writeFileSync(missingKeyPath, JSON.stringify(withoutKey));
    let calls = 0;
    const middleware = mount(
      statusBoardApi({
        configPath: missingKeyPath,
        fetchImpl: (async () => {
          calls += 1;
          return page([]);
        }) as unknown as typeof fetch,
      }),
    );
    const res = await send(middleware, "GET", `/xtrm-api/status-board/list?repo=${repo}&prefix=workers`);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, error: "status board credential unavailable" });
    expect(calls).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain("secret-value");
  });
});
