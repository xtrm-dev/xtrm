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

  it("reports an unconfigured repository instead of guessing", () => {
    const b = resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} });
    expect(b.configured).toBe(false);
    expect(b.resolvedBy).toBe("none");
    expect(b.site).toBeNull();
    expect(b.timezone).toBe("Europe/Berlin");
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
    expect(unconfigured.site).toBeNull();
    expect(readHealth(unconfigured).configured).toBe(false);
    expect(readHealth(unconfigured).stale).toBe(false);
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

  it("finds one record by exact path and returns null when absent", async () => {
    const fetchImpl = (async () => page([record("workers/a"), record("workers/b")])) as unknown as typeof fetch;
    const client = createBoardClient({ site: "site-a", key: () => "k", fetchImpl });
    expect((await client.record("workers/b"))?.path).toBe("workers/b");
    expect(await client.record("workers/zzz")).toBeNull();
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

  it("is not stale for an unconfigured repository", () => {
    const binding = resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} });
    expect(readHealth(binding).stale).toBe(false);
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
