import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  allowedPath,
  createBoardClient,
  defaultConfigPath,
  evictExpired,
  loadPmConfig,
  normaliseDoc,
  normaliseRepo,
  probeSync,
  probeUnit,
  publicBinding,
  readHealth,
  resolveBinding,
  statusBoardApi,
  timerUnitFor,
  unboundBody,
  type PmConfig,
  type SyncProbe,
  type UnitProbeRun,
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
    // Deliberately carries no repo_slug/repo_name: only explicit selection reaches it.
    other: {
      status_board_site: "other-site",
      status_board_key_file: "/home/dawid/.herenow/other-credentials",
    },
  },
};

/** A probe fixture: every fact unverified unless the test says otherwise. */
const syncProbe = (over: Partial<SyncProbe> = {}): SyncProbe => ({
  timerUnit: null,
  scheduleActive: null,
  scheduleActiveReason: "unit_not_found",
  runInProgress: null,
  runInProgressReason: "unit_not_found",
  unitActive: null,
  unitActiveReason: "unit_not_found",
  ...over,
});

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

  it("pins a repository-bound read to its own board, ignoring ?project= and XTRM_PM_PROJECT", () => {
    // Retargeting a repo-bound read to another project's board was the divergence from
    // ADR-002: the repository entry is the authority the sync timer reads, so it wins.
    for (const opts of [
      { explicit: "other" },
      { env: { XTRM_PM_PROJECT: "other" } },
      { explicit: "other", env: { XTRM_PM_PROJECT: "other" } },
    ]) {
      const b = resolveBinding(CONFIG, "mercuryintelligence/market-data", opts);
      expect(b.pmProject).toBe("mercury");
      expect(b.resolvedBy).toBe("repo_slug");
      expect(b.site).toBe("velvet-breeze-fbm8");
    }
    // The repo_name fallback is just as binding as repo_slug.
    const byName = resolveBinding(
      { projects: { alias: { repo_name: "market-data", status_board_site: "alias-site" }, other: { status_board_site: "other-site" } } },
      "mercuryintelligence/market-data",
      { explicit: "other", env: { XTRM_PM_PROJECT: "other" } },
    );
    expect(byName.resolvedBy).toBe("repo_name");
    expect(byName.site).toBe("alias-site");
  });

  it("honours explicit selection for an unbound site, reporting the source that resolved", () => {
    expect(resolveBinding(CONFIG, "someone/other", { explicit: "other", env: {} }).resolvedBy).toBe("explicit");
    expect(resolveBinding(CONFIG, "someone/other", { explicit: "other", env: {} }).site).toBe("other-site");
    expect(resolveBinding(CONFIG, "someone/other", { env: { XTRM_PM_PROJECT: "other" } }).resolvedBy).toBe("env");
    expect(resolveBinding(CONFIG, "someone/other", { env: { XTRM_PM_PROJECT: "other" } }).site).toBe("other-site");
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
    const health = readHealth({ ...binding, stateDir: dir }, Date.parse("2026-11-17T09:00:00Z"), syncProbe({ unitActive: true }));
    expect(health.lastSyncOkAt).toBe("2026-11-17T06:00:00.000Z");
    expect(health.driftCount).toBe(2);
    expect(health.stale).toBe(true);
    expect(health.unitActive).toBe(true);
    expect(health.unitActiveReason).toBeNull();
    expect(health.configured).toBe(true);
  });

  it("reports unknown, not zero, when the state files are absent", () => {
    const binding = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    const probe = syncProbe({ unitActive: null, unitActiveReason: "probe_timeout" });
    const health = readHealth({ ...binding, stateDir: join(tmpdir(), "definitely-absent-dir-xyz") }, Date.now(), probe);
    expect(health.lastSyncOkAt).toBeNull();
    expect(health.driftCount).toBeNull();
    expect(health.unitActive).toBeNull();
    // null is "not verified", and it says why: it is never published beside an alarm.
    expect(health.unitActiveReason).toBe("probe_timeout");
    expect(health.stale).toBe(true);
  });

  it("is not stale for an unconfigured repository, and carries a null reason when configured", () => {
    const binding = resolveBinding(CONFIG, "xtrm-dev/xtrm", { env: {} });
    expect(readHealth(binding).stale).toBe(false);
    const bound = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });
    expect(readHealth(bound).reason).toBeNull();
  });
});

describe("unit probe", () => {
  const run = (
    stdout: string,
    error: (Error & { killed?: boolean }) | null = null,
    stderr = "",
  ): UnitProbeRun =>
    (_command, _args, _options, callback) => {
      callback(error, stdout, stderr);
    };

  it("is true only when systemd reports the unit running", async () => {
    expect(await probeUnit("sync.service", run("active"))).toEqual({ active: true, reason: null });
    expect(await probeUnit("sync.service", run("reloading"))).toEqual({ active: true, reason: null });
  });

  it("is false for a unit that is not running, and only then", async () => {
    expect(await probeUnit("sync.service", run("inactive"))).toEqual({ active: false, reason: null });
    expect(await probeUnit("sync.service", run("failed"))).toEqual({ active: false, reason: null });
  });

  it("is unverified, never down, when the state does not name a known unit", async () => {
    // The live bug (XTRM-823): these answered `false` beside a fresh lastSyncOkAt.
    expect(await probeUnit("sync.service", run("unknown"))).toEqual({ active: null, reason: "probe_failed" });
    expect(await probeUnit("sync.service", run("maintenance"))).toEqual({ active: null, reason: "probe_failed" });
    expect(await probeUnit(null, run("active"))).toEqual({ active: null, reason: "unit_not_found" });
    const missing = Object.assign(new Error("Command failed: systemctl"), { killed: false });
    expect(await probeUnit("sync.service", run("", missing, "Unit sync.service could not be found."))).toEqual({
      active: null,
      reason: "unit_not_found",
    });
    // What systemd actually prints for an uninstalled unit: `inactive`, exit 4, empty stderr.
    const absent = Object.assign(new Error("Command failed: systemctl"), { killed: false, code: 4 });
    expect(await probeUnit("sync.service", run("inactive", absent))).toEqual({ active: null, reason: "unit_not_found" });
  });

  it("names why the probe could not answer", async () => {
    const killed = Object.assign(new Error("The operation was killed"), { killed: true });
    expect(await probeUnit("sync.service", run("", killed))).toEqual({ active: null, reason: "probe_timeout" });
    expect(await probeUnit("sync.service", run("", new Error("Failed to connect to bus: No medium found")))).toEqual({
      active: null,
      reason: "non_user_session",
    });
    expect(await probeUnit("sync.service", run("", new Error("spawn systemctl ENOENT")))).toEqual({
      active: null,
      reason: "probe_failed",
    });
  });
});

describe("timer-driven sync health", () => {
  const SERVICE = "status-board-sync.service";
  const TIMER = "status-board-sync.timer";
  type Canned = { stdout: string; error?: (Error & { killed?: boolean; code?: number | string }) | null; stderr?: string };

  /**
   * One canned `is-active` answer per unit. An unlisted unit answers the way systemd really does
   * for a unit nobody installed: `inactive` on stdout, exit code 4, empty stderr.
   */
  const runUnits = (states: Record<string, Canned>): UnitProbeRun =>
    (_command, args, _options, callback) => {
      const unit = String(args[args.length - 1]);
      const hit = states[unit];
      if (!hit) {
        const missing = Object.assign(new Error(`Command failed: systemctl --user is-active ${unit}`), { killed: false, code: 4 });
        return callback(missing, "inactive\n", "");
      }
      callback(hit.error ?? null, hit.stdout, hit.stderr ?? "");
    };
  const probe = (states: Record<string, Canned>) => probeSync(SERVICE, runUnits(states));
  const binding = resolveBinding(CONFIG, "mercuryintelligence/market-data", { env: {} });

  it("derives the timer instance from the configured service unit", () => {
    expect(timerUnitFor(SERVICE)).toBe(TIMER);
    expect(timerUnitFor("sync")).toBe("sync.timer");
    expect(timerUnitFor(null)).toBeNull();
  });

  it("does not report a healthy idle sync as down (timer active, service inactive)", async () => {
    // The bug: between ticks the oneshot is `inactive`, and that was published as `false`.
    const state = await probe({ [TIMER]: { stdout: "active" }, [SERVICE]: { stdout: "inactive" } });
    expect(state).toMatchObject({
      timerUnit: TIMER,
      scheduleActive: true,
      scheduleActiveReason: null,
      runInProgress: false,
      unitActive: true,
      unitActiveReason: null,
    });
    const health = readHealth(binding, Date.now(), state);
    expect(health.unitActive).toBe(true);
    expect(health.unitActiveReason).toBeNull();
    expect(health.scheduleActive).toBe(true);
    expect(health.runInProgress).toBe(false);
  });

  it("does not report a run in progress as not running (timer active, service activating)", async () => {
    // The live observation 2026-11-17 13:44: `is-active` answered `activating`, /health said false.
    const state = await probe({ [TIMER]: { stdout: "active" }, [SERVICE]: { stdout: "activating" } });
    expect(state.runInProgress).toBe(true);
    expect(state.runInProgressReason).toBeNull();
    expect(state.unitActive).toBe(true);
    const health = readHealth(binding, Date.now(), state);
    expect(health.runInProgress).toBe(true);
    expect(health.unitActive).toBe(true);
  });

  it("reports a genuinely dead schedule as inactive (timer inactive or failed, service inactive)", async () => {
    for (const timerState of ["inactive", "failed"]) {
      const state = await probe({ [TIMER]: { stdout: timerState }, [SERVICE]: { stdout: "inactive" } });
      expect(state.scheduleActive).toBe(false);
      expect(state.scheduleActiveReason).toBeNull();
      expect(state.runInProgress).toBe(false);
      expect(state.unitActive).toBe(false);
      expect(state.unitActiveReason).toBeNull();
      expect(readHealth(binding, Date.now(), state).unitActive).toBe(false);
    }
  });

  it("reports an unprobeable timer as unverified, never as down", async () => {
    // No timer unit for this service: absence is not evidence that the sync is down.
    const state = await probe({ [SERVICE]: { stdout: "inactive" } });
    expect(state.timerUnit).toBe(TIMER);
    expect(state.scheduleActive).toBeNull();
    expect(state.scheduleActiveReason).toBe("unit_not_found");
    expect(state.runInProgress).toBe(false);
    expect(state.unitActive).toBeNull();
    expect(state.unitActiveReason).toBe("unit_not_found");
    const health = readHealth(binding, Date.now(), state);
    expect(health.unitActive).toBeNull();
    expect(health.unitActiveReason).toBe("unit_not_found");
    expect(health.scheduleActiveReason).toBe("unit_not_found");
  });

  it("does not read systemd's `inactive` + exit 4 as not-armed", async () => {
    // Verified on the canonical host: `systemctl --user is-active <missing>.timer` prints
    // `inactive`, exits 4, and writes nothing to stderr. Reading stdout alone says "dead".
    const missing = Object.assign(new Error("Command failed: systemctl"), { killed: false, code: 4 });
    const state = await probe({ [SERVICE]: { stdout: "inactive" }, [TIMER]: { stdout: "inactive", error: missing } });
    expect(state.scheduleActive).toBeNull();
    expect(state.scheduleActiveReason).toBe("unit_not_found");
    expect(state.unitActive).toBeNull();
    expect(readHealth(binding, Date.now(), state).unitActive).toBeNull();
  });

  it("keeps each fact's own reason when only one probe failed", async () => {
    const killed = Object.assign(new Error("The operation was killed"), { killed: true });
    const noTimer = await probe({ [TIMER]: { stdout: "", error: killed }, [SERVICE]: { stdout: "inactive" } });
    expect(noTimer.scheduleActive).toBeNull();
    expect(noTimer.scheduleActiveReason).toBe("probe_timeout");
    expect(noTimer.runInProgress).toBe(false);
    expect(noTimer.unitActiveReason).toBe("probe_timeout");
    const noService = await probe({ [TIMER]: { stdout: "active" }, [SERVICE]: { stdout: "", error: killed } });
    expect(noService.runInProgress).toBeNull();
    expect(noService.runInProgressReason).toBe("probe_timeout");
    expect(noService.unitActive).toBe(true);
  });

  it("publishes both facts as unverified when there is no unit at all", async () => {
    const state = await probeSync(null, runUnits({}));
    expect(state).toEqual({ ...syncProbe() });
    const health = readHealth(binding, Date.now(), state);
    expect(health).toMatchObject({ unitActive: null, timerUnit: null, scheduleActive: null, runInProgress: null });
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
  hook: "configureServer" | "configurePreviewServer",
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

// `npm run research:serve` is `vite preview`, not `vite dev`: every middleware
// case runs under both hooks, so a bridge that only works under configureServer
// cannot pass while production runs preview (XTRM-832).
const HOOKS: Array<"configureServer" | "configurePreviewServer"> = ["configureServer", "configurePreviewServer"];

describe.each(HOOKS)("status-board middleware (%s)", (hook) => {
  const mountHere = (plugin: ReturnType<typeof statusBoardApi>) => mount(plugin, hook);
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
      // A second board the request could try to reach with ?project=other.
      other: {
        repo_slug: "someone/other",
        status_board_site: "site-other",
        status_board_key_file: keyFile,
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const page = (records: unknown[], next?: string) => ({ ok: true, json: async () => ({ records, nextCursor: next }) });
  const wire = (path: string) => ({ id: `rec_${path}`, updatedAt: "2026-11-17T08:00:00Z", data: { path, doc: { status: "active" } } });
  const repo = "mercuryintelligence/market-data";

  it("refuses everything that is not a GET, before touching config or credential", async () => {
    const middleware = mountHere(statusBoardApi({ configPath, fetchImpl: (async () => page([])) as unknown as typeof fetch }));
    const res = await send(middleware, "POST", `/xtrm-api/status-board/list?repo=${repo}`);
    expect(res.status).toBe(405);
    expect(res.body.error).toContain("read-only");
  });

  it("passes unrelated paths to the next middleware instead of answering them", async () => {
    const middleware = mountHere(statusBoardApi({ configPath }));
    const res = await send(middleware, "GET", "/api/other");
    expect(res.next).toBe(true);
    expect(res.status).toBe(0);
  });

  it("answers 404 with repo_not_bound for a repository the config does not mention", async () => {
    const middleware = mountHere(statusBoardApi({ configPath }));
    const res = await send(middleware, "GET", "/xtrm-api/status-board/binding?repo=xtrm-dev/xtrm");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, reason: "repo_not_bound" });
  });

  it("answers instead of exiting when a projects entry is not an object", async () => {
    // The failure this guards: `{"projects":{"bad":null}}` made resolveBinding throw
    // inside `(req,res,next) => void handle(...)`, so the rejection had no handler and
    // Node's default policy exited the preview process — the console restart loop.
    const brokenPath = join(dir, "pm-broken.json");
    writeFileSync(brokenPath, JSON.stringify({ defaults: { timezone: "UTC" }, projects: { bad: null, mercury: config.projects!.mercury } }));
    const middleware = mountHere(statusBoardApi({ configPath: brokenPath, fetchImpl: (async () => page([wire("workers/alice")])) as unknown as typeof fetch }));
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
    const middleware = mountHere(
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
    const middleware = mountHere(statusBoardApi({ configPath, fetchImpl }));
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
    const middleware = mountHere(statusBoardApi({ configPath, fetchImpl }));
    const url = `/xtrm-api/status-board/list?repo=${repo}&prefix=workers&limit=50`;
    const first = await send(middleware, "GET", url);
    expect(first.status).toBe(200);
    expect(first.body.truncated).toBe(true);
    const afterFirst = calls;
    const second = await send(middleware, "GET", url);
    expect(second.status).toBe(200);
    expect(calls).toBe(afterFirst);
  });

  it("stamps a cached read with the upstream fetch time, not the time it was served", async () => {
    // The read is served from the 60 s cache, so the second response must report
    // how old the data is — the entry's `at` — and not "now".
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return page([wire("workers/alice")]);
    }) as unknown as typeof fetch;
    const middleware = mountHere(statusBoardApi({ configPath, fetchImpl }));
    const url = `/xtrm-api/status-board/list?repo=${repo}&prefix=workers`;
    const first = await send(middleware, "GET", url);
    expect(first.status).toBe(200);
    expect(Number.isNaN(Date.parse(first.body.cachedAt))).toBe(false);
    // A real gap between the two reads: a wall-clock stamp at response time would advance.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await send(middleware, "GET", url);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);
    expect(second.body.cachedAt).toBe(first.body.cachedAt);
  });

  it("re-reads an expired entry instead of serving it forever", async () => {
    // Only Date is faked: the handler's polling in `send` needs real timers.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return page([wire("workers/alice")]);
    }) as unknown as typeof fetch;
    const middleware = mountHere(statusBoardApi({ configPath, fetchImpl }));
    const url = `/xtrm-api/status-board/list?repo=${repo}&prefix=workers`;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));
      const first = await send(middleware, "GET", url);
      expect(first.status).toBe(200);
      vi.setSystemTime(new Date("2026-11-17T08:01:01Z"));
      const second = await send(middleware, "GET", url);
      expect(second.status).toBe(200);
      expect(calls).toBe(2);
      expect(second.body.cachedAt).not.toBe(first.body.cachedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops cache entries whose TTL has run out", () => {
    const cache = new Map([
      ["record:site:workers/stale", { at: 0, value: 1 }],
      ["record:site:workers/fresh", { at: 30_000, value: 2 }],
    ]);
    evictExpired(cache, 60_000);
    expect([...cache.keys()]).toEqual(["record:site:workers/fresh"]);
  });

  it("publishes unitActive null with a reason when there is no unit to probe", async () => {
    // The binding has no status_board_unit, so nothing was verified: null, never false.
    const middleware = mountHere(statusBoardApi({ configPath }));
    const res = await send(middleware, "GET", `/xtrm-api/status-board/health?repo=${repo}`);
    expect(res.status).toBe(200);
    expect(res.body.health).toMatchObject({ unitActive: null, unitActiveReason: "unit_not_found" });
    // Neither fact is guessed: the schedule and the run are unverified in their own right.
    expect(res.body.health).toMatchObject({
      timerUnit: null,
      scheduleActive: null,
      scheduleActiveReason: "unit_not_found",
      runInProgress: null,
      runInProgressReason: "unit_not_found",
    });
    expect(res.body.health.lastSyncOkAt).toBeNull();
  });

  it("answers 404 for an unknown subpath, and 400 only for a malformed query", async () => {
    const middleware = mountHere(statusBoardApi({ configPath }));
    const unknown = await send(middleware, "GET", `/xtrm-api/status-board/unknown?repo=${repo}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ ok: false, error: "unsupported status board read" });
    const malformed = await send(middleware, "GET", `/xtrm-api/status-board/list?repo=${repo}&prefix=bogus`);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("unknown collection");
  });

  it("never lets a repo-bound read be retargeted by ?project= or XTRM_PM_PROJECT", async () => {
    const fetchImpl = (async (url: URL) => {
      // Name the board that was actually read, so a retarget cannot hide behind a 200.
      return page([{ ...wire("workers/alice"), id: url.pathname.includes("site-other") ? "other" : "mercury" }]);
    }) as unknown as typeof fetch;
    const middleware = mountHere(statusBoardApi({ configPath, fetchImpl }));

    const explicit = await send(middleware, "GET", `/xtrm-api/status-board/binding?repo=${repo}&project=other`);
    expect(explicit.status).toBe(200);
    expect(explicit.body.binding).toMatchObject({ pmProject: "mercury", site: "site-a", resolvedBy: "repo_slug" });

    // The reverse direction: a request for the other repo cannot be pointed at mercury either.
    const other = await send(middleware, "GET", `/xtrm-api/status-board/binding?repo=someone/other&project=mercury`);
    expect(other.body.binding).toMatchObject({ pmProject: "other", site: "site-other", resolvedBy: "repo_slug" });

    const previous = process.env.XTRM_PM_PROJECT;
    process.env.XTRM_PM_PROJECT = "other";
    try {
      const viaEnv = await send(middleware, "GET", `/xtrm-api/status-board/binding?repo=${repo}`);
      expect(viaEnv.body.binding).toMatchObject({ pmProject: "mercury", site: "site-a", resolvedBy: "repo_slug" });
    } finally {
      if (previous === undefined) delete process.env.XTRM_PM_PROJECT;
      else process.env.XTRM_PM_PROJECT = previous;
    }

    // Explicit selection still works when the repository itself is not bound.
    const unbound = await send(middleware, "GET", "/xtrm-api/status-board/binding?repo=xtrm-dev/xtrm&project=other");
    expect(unbound.body.binding).toMatchObject({ pmProject: "other", resolvedBy: "explicit" });
  });

  it("answers 503 when the credential file is missing, without calling upstream", async () => {
    const withoutKey = { ...config, projects: { mercury: { ...config.projects!.mercury, status_board_key_file: join(dir, "absent-key") } } };
    const missingKeyPath = join(dir, "pm-nokey.json");
    writeFileSync(missingKeyPath, JSON.stringify(withoutKey));
    let calls = 0;
    const middleware = mountHere(
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
