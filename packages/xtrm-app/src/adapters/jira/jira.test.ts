import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptersFromEnv, fixtureAdapters } from "../index.tsx";
import { FIXTURE_JIRA_PROJECT, FIXTURE_JIRA_REPO, FIXTURE_JIRA_SITE, createJiraFixtureAdapter, fixtureJira } from "./fixture.ts";
import { createJiraLiveAdapter, isKnownSyncState, mapIssue } from "./live.ts";
import { JiraError, type JiraIssue } from "./types.ts";

// The adapter boundary against the bridge's wire shapes (server/jira-api.ts). The live adapter is
// exercised with a stubbed fetch; the fixture must return the same shape with no network at all.

const REPO = "mercury/market-data";

type Reply = { status: number; body: unknown };

function responder(reply: (url: string) => Reply) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const { status, body } = reply(String(input));
    return { status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const wireIssue = (key: string, overrides: Partial<JiraIssue> = {}) => ({
  key,
  summary: "Ship the Project surface",
  status: "In Progress",
  assignee: "Console lead",
  url: `${FIXTURE_JIRA_SITE}/browse/${key}`,
  syncState: "in_sync",
  issueRef: "XTRM-816",
  bindingsAvailable: true,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live jira adapter: reads through the bridge only", () => {
  it("maps a binding, and reports an unbound repository instead of throwing", async () => {
    let reply: Reply = {
      status: 200,
      body: {
        ok: true,
        binding: {
          repository: REPO,
          configured: true,
          reason: null,
          resolvedBy: "repo_slug",
          pmProject: "market-data",
          substrateProject: "prj_mmd",
          site: FIXTURE_JIRA_SITE,
          project: FIXTURE_JIRA_PROJECT,
          boardId: "7",
          tokenFile: "/home/operator/.config/xtrm/jira-token",
          credentialPresent: true,
        },
      },
    };
    const { fetchImpl, calls } = responder(() => reply);
    const adapter = createJiraLiveAdapter({ fetchImpl });

    const bound = await adapter.binding(REPO);
    expect(bound).toMatchObject({ configured: true, site: FIXTURE_JIRA_SITE, project: "MMD", credentialPresent: true, resolvedBy: "repo_slug" });
    expect(calls[0]).toContain("/xtrm-api/jira/binding?repo=mercury%2Fmarket-data");

    reply = { status: 404, body: { ok: false, configured: false, reason: "repo_not_bound", repository: REPO, resolvedBy: "none" } };
    const unbound = await adapter.binding("xtrm-dev/xtrm");
    expect(unbound).toMatchObject({ configured: false, reason: "repo_not_bound", tokenFile: null, credentialPresent: false });
  });

  it("maps an issue, a search page and a links page without inventing fields", async () => {
    let reply: Reply = { status: 200, body: { ok: true, issue: wireIssue("MMD-551"), cachedAt: "2026-11-17T22:00:00.000Z" } };
    const { fetchImpl, calls } = responder(() => reply);
    const adapter = createJiraLiveAdapter({ fetchImpl });

    const issue = await adapter.issue(REPO, "MMD-551");
    expect(issue).toEqual({
      key: "MMD-551",
      summary: "Ship the Project surface",
      status: "In Progress",
      assignee: "Console lead",
      url: `${FIXTURE_JIRA_SITE}/browse/MMD-551`,
      syncState: "in_sync",
      issueRef: "XTRM-816",
      bindingsAvailable: true,
    });
    expect(calls[0]).toContain("key=MMD-551");

    reply = {
      status: 200,
      body: {
        ok: true,
        issues: [
          wireIssue("MMD-551"),
          wireIssue("MMD-612", { summary: null, status: null, assignee: null, syncState: null, issueRef: null, bindingsAvailable: false }),
        ],
        truncated: true,
        bindingsAvailable: false,
        bindingsReason: "sb_truncated",
        cachedAt: "2026-11-17T22:00:00.000Z",
      },
    };
    const page = await adapter.search(REPO, { jql: "project = MMD" });
    expect(page.truncated).toBe(true);
    expect(page.bindingsAvailable).toBe(false);
    expect(page.bindingsReason).toBe("sb_truncated");
    expect(page.cachedAt).toBe("2026-11-17T22:00:00.000Z");
    expect(page.issues[1]).toMatchObject({ key: "MMD-612", summary: null, status: null, assignee: null, syncState: null, issueRef: null, bindingsAvailable: false });

    reply = { status: 200, body: { ok: true, links: [wireIssue("MMD-551")], bindingsAvailable: false, bindingsReason: "sb_unavailable", cachedAt: null } };
    const links = await adapter.links(REPO, ["MMD-551"]);
    expect(links.bindingsAvailable).toBe(false);
    expect(links.bindingsReason).toBe("sb_unavailable");
    expect(links.links.map((i) => i.key)).toEqual(["MMD-551"]);
  });

  it("maps every bridge failure to a typed error", async () => {
    const cases: Array<{ name: string; status: number; body: unknown; kind: string }> = [
      { name: "bad request", status: 400, body: { ok: false, error: "rejected" }, kind: "bad_request" },
      { name: "foreign project", status: 403, body: { ok: false, error: "outside" }, kind: "forbidden" },
      { name: "unbound", status: 404, body: { ok: false, configured: false, reason: "repo_not_bound" }, kind: "unbound" },
      { name: "missing issue", status: 404, body: { ok: false, error: "jira issue not found" }, kind: "not_found" },
      { name: "credential", status: 503, body: { ok: false, error: "jira credential unavailable" }, kind: "credential" },
      { name: "unusable config", status: 503, body: { ok: false, configured: false, reason: "jira_invalid_config" }, kind: "config" },
      { name: "upstream", status: 502, body: { ok: false, error: "jira read failed" }, kind: "upstream" },
    ];
    for (const c of cases) {
      const { fetchImpl } = responder(() => ({ status: c.status, body: c.body }));
      const error = await createJiraLiveAdapter({ fetchImpl })
        .issue(REPO, "MMD-551")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(JiraError);
      expect((error as JiraError).kind).toBe(c.kind);
    }
  });

  it("maps a non-JSON bridge body and an unreachable bridge", async () => {
    const malformed = (async () => ({ status: 200, json: async () => Promise.reject(new Error("not json")) })) as unknown as typeof fetch;
    await expect(createJiraLiveAdapter({ fetchImpl: malformed }).issue(REPO, "MMD-551")).rejects.toMatchObject({ kind: "malformed" });

    const unreachable = (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    await expect(createJiraLiveAdapter({ fetchImpl: unreachable }).links(REPO, ["MMD-551"])).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("jira mapping rules", () => {
  it("keeps an unknown sync state as carried and never coerces it", () => {
    const mapped = mapIssue(wireIssue("MMD-1", { syncState: "mystery" }));
    expect(mapped.syncState).toBe("mystery");
    expect(isKnownSyncState(mapped.syncState)).toBe(false);
    expect(isKnownSyncState("in_sync")).toBe(true);
    expect(isKnownSyncState(null)).toBe(false);
  });
});

describe("fixture jira adapter", () => {
  it("serves the same issue shape as the live adapter, with no network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const fixture = createJiraFixtureAdapter();
    const fromFixture = await fixture.issue(FIXTURE_JIRA_REPO, "MMD-551");
    expect(fromFixture).toEqual({
      key: "MMD-551",
      summary: "Ship the Project surface",
      status: "In Progress",
      assignee: "Console lead",
      url: `${FIXTURE_JIRA_SITE}/browse/MMD-551`,
      syncState: "in_sync",
      issueRef: "XTRM-816",
      bindingsAvailable: true,
    });

    // The live adapter, given the same bridge payload, yields the identical typed view.
    const live = createJiraLiveAdapter({ fetchImpl: responder(() => ({ status: 200, body: { ok: true, issue: { ...fromFixture } } })).fetchImpl });
    expect(await live.issue(FIXTURE_JIRA_REPO, "MMD-551")).toEqual(fromFixture);
    expect(spy).not.toHaveBeenCalled();
  });

  it("mirrors the bridge's refusals and the unbound state", async () => {
    await expect(fixtureJira.issue(FIXTURE_JIRA_REPO, "bad")).rejects.toMatchObject({ kind: "bad_request" });
    await expect(fixtureJira.issue(FIXTURE_JIRA_REPO, "OTHER-1")).rejects.toMatchObject({ kind: "forbidden" });
    await expect(fixtureJira.issue(FIXTURE_JIRA_REPO, "MMD-999")).rejects.toMatchObject({ kind: "not_found" });
    await expect(fixtureJira.issue("xtrm-dev/xtrm", "MMD-551")).rejects.toMatchObject({ kind: "unbound" });
    await expect(fixtureJira.links("xtrm-dev/xtrm", ["MMD-551"])).rejects.toMatchObject({ kind: "unbound" });

    expect(await fixtureJira.binding("xtrm-dev/xtrm")).toMatchObject({ configured: false, reason: "repo_not_bound" });
    expect(await fixtureJira.binding(FIXTURE_JIRA_REPO)).toMatchObject({ configured: true, project: "MMD", credentialPresent: true });
  });

  it("exposes search inside the bound project and joined links", async () => {
    const page = await fixtureJira.search(FIXTURE_JIRA_REPO, { jql: "project = MMD" });
    expect(page.issues).toHaveLength(3);
    expect(page.truncated).toBe(false);
    expect(page.bindingsAvailable).toBe(true);
    expect(page.bindingsReason).toBeNull();
    expect(page.issues.every((i) => i.bindingsAvailable)).toBe(true);
    expect(page.issues.map((i) => i.syncState)).toContain("in_sync");
    expect(page.issues.map((i) => i.syncState)).toContain("pending");
    await expect(fixtureJira.search(FIXTURE_JIRA_REPO, { jql: "project = OTHER" })).rejects.toMatchObject({ kind: "bad_request" });

    const links = await fixtureJira.links(FIXTURE_JIRA_REPO, ["MMD-551", "MMD-700"]);
    expect(links.bindingsAvailable).toBe(true);
    expect(links.bindingsReason).toBeNull();
    expect(links.links.map((i) => i.issueRef)).toEqual(["XTRM-816", "XTRM-820"]);
  });
});

describe("jira adapter registration", () => {
  it("is selected by configuration, defaulting to the fixture", () => {
    expect(adaptersFromEnv({}).jira.source).toBe("fixture");
    expect(adaptersFromEnv({ VITE_XTRM_JIRA: "live" }).jira.source).toBe("live");
    expect(fixtureAdapters.jira.source).toBe("fixture");
  });
});
