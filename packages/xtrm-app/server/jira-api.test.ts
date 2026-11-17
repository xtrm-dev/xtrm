// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JIRA_KEY_RE,
  acceptsJqlGuard,
  browseUrl,
  jiraApi,
  keyProject,
  keysJql,
  parseExternalBindings,
  parseIssueRow,
  parseKeys,
  parseSearch,
  projectJql,
  readJiraAuth,
  remoteScope,
} from "./jira-api.ts";

// The Jira bridge is the only component that holds the token or reaches Jira Cloud. These tests
// mount its real middleware the way Vite does, stub the upstream, and assert the contract:
// validation before any upstream call, a fixed JQL template, a per-request credential that never
// reaches a response, typed failure mapping, a 30 s cache that never stores an error, and a
// bounded Substrate join that degrades to "unknown" instead of inventing a sync state.

const TOKEN = "test-token-value-123";
const REPO = "mercuryintelligence/market-data";

type Reply = { status: number; body: unknown };
type Middleware = (req: unknown, res: unknown, next: () => void) => void;
type Hook = "configureServer" | "configurePreviewServer";

function mount(plugin: ReturnType<typeof jiraApi>, hook: Hook): Middleware {
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
  for (let i = 0; i < 400 && res.statusCode === 0 && !res.next; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { status: res.statusCode, next: res.next, body: payload ? JSON.parse(payload) : null, headers };
}

const HOOKS: Hook[] = ["configureServer", "configurePreviewServer"];

const issueBody = (key: string, summary = "Ship the Project surface", status = "In Progress", assignee: string | null = "Console lead") => ({
  key,
  fields: { summary, status: { name: status }, assignee: assignee ? { displayName: assignee } : null },
});

const searchBody = (keys: string[], isLast = true) => ({ issues: keys.map((key) => issueBody(key)), isLast });

const envelope = (bindings: unknown[]) =>
  JSON.stringify({ schema: "substrate-cli/v1", command: "external.list", ok: true, data: { bindings, limit: 100, truncated: false } });

function responder(reply: (url: string) => Reply) {
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const { status, body } = reply(String(input));
    return { status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, headers };
}

const noBindings = () => Promise.resolve({ status: 200, body: envelope([]) });

function setup(overrides: { writeToken?: boolean; runExternal?: (argv: string[]) => Promise<{ status: number; body: string }> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jira-bridge-"));
  const tokenFile = join(dir, "jira-token");
  if (overrides.writeToken !== false) writeFileSync(tokenFile, TOKEN);
  const configPath = join(dir, "pm.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      defaults: { jira_site: "https://mtl.atlassian.net", jira_token_file: tokenFile },
      projects: {
        mercury: { repo_slug: REPO, repo_name: "market-data", sb_project_id: "prj_mmd", jira_project: "MMD" },
        // Bound for the board, never for Jira.
        boardonly: { repo_slug: "someone/board-only", sb_project_id: "prj_board" },
      },
    }),
  );
  const middleware = (fetchImpl: typeof fetch, hook: Hook = "configureServer") =>
    mount(jiraApi({ configPath, fetchImpl, runExternal: overrides.runExternal ?? noBindings }), hook);
  return { configPath, tokenFile, middleware };
}

const issueUrl = (key: string) => `/xtrm-api/jira/issue?repo=${encodeURIComponent(REPO)}&key=${key}`;
const linksUrl = (keys: string) => `/xtrm-api/jira/links?repo=${encodeURIComponent(REPO)}&keys=${keys}`;
const searchUrl = (jql?: string) => `/xtrm-api/jira/search?repo=${encodeURIComponent(REPO)}${jql ? `&jql=${encodeURIComponent(jql)}` : ""}`;

describe("jira bridge: pure boundaries", () => {
  it("pins the key shape and refuses malformed lists", () => {
    expect(JIRA_KEY_RE.test("MMD-551")).toBe(true);
    expect(JIRA_KEY_RE.test("ISSUE-1")).toBe(true);
    expect(JIRA_KEY_RE.test("mmd-551")).toBe(false);
    expect(JIRA_KEY_RE.test("M-1")).toBe(false);
    expect(JIRA_KEY_RE.test("MMD-551;drop")).toBe(false);
    expect(parseKeys("MMD-1, MMD-2,MMD-1")).toEqual(["MMD-1", "MMD-2"]);
    expect(parseKeys("MMD-1,bad")).toBeNull();
    expect(parseKeys(null)).toBeNull();
    expect(parseKeys(Array.from({ length: 51 }, (_, i) => `MMD-${i + 1}`).join(","))).toBeNull();
    expect(keyProject("MMD-551")).toBe("MMD");
  });

  it("builds JQL from fixed templates only", () => {
    expect(projectJql("MMD")).toBe("project = MMD ORDER BY updated DESC");
    expect(keysJql(["MMD-1", "MMD-2"])).toBe("key in (MMD-1, MMD-2) ORDER BY updated DESC");
    expect(acceptsJqlGuard(null, "MMD")).toBe(true);
    expect(acceptsJqlGuard("  project   =   mmd ", "MMD")).toBe(true);
    expect(acceptsJqlGuard("project = OTHER", "MMD")).toBe(false);
    expect(acceptsJqlGuard("project = MMD OR project = OTHER", "MMD")).toBe(false);
    expect(browseUrl("https://x.atlassian.net/", "MMD-1")).toBe("https://x.atlassian.net/browse/MMD-1");
    expect(remoteScope("https://x.atlassian.net", "MMD")).toBe("x.atlassian.net:MMD");
    expect(remoteScope("not a url", "MMD")).toBeNull();
  });

  it("reads a ready header, a JSON email/token pair, and a plain token; never invents one", () => {
    expect(readJiraAuth("/x", () => "Bearer abc12345")).toEqual({ header: "Bearer abc12345" });
    const basic = readJiraAuth("/x", () => JSON.stringify({ email: "ops@example.com", token: "tok-123456" }));
    expect(basic?.header.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(basic!.header.slice(6), "base64").toString()).toBe("ops@example.com:tok-123456");
    expect(readJiraAuth("/x", () => JSON.stringify({ token: "tok-123456" }))).toEqual({ header: "Bearer tok-123456" });
    expect(readJiraAuth("/x", () => "plain-token-123")).toEqual({ header: "Bearer plain-token-123" });
    expect(readJiraAuth(null, () => TOKEN)).toBeNull();
    expect(readJiraAuth("/x", () => "")).toBeNull();
    expect(
      readJiraAuth("/x", () => {
        throw new Error("missing");
      }),
    ).toBeNull();
  });

  it("parses the sb external-bindings envelope and refuses anything else", () => {
    const parsed = parseExternalBindings(envelope([{ issue: "XTRM-816", remoteKey: "MMD-551", syncState: "in_sync", url: "https://x/browse/MMD-551" }]));
    expect(parsed?.get("MMD-551")).toEqual({ issueRef: "XTRM-816", syncState: "in_sync", url: "https://x/browse/MMD-551" });
    expect(parseExternalBindings("{}")).toBeNull();
    expect(parseExternalBindings("not json")).toBeNull();
    expect(parseExternalBindings(JSON.stringify({ schema: "substrate-cli/v1", ok: false, error: "nope" }))).toBeNull();
    expect(parseExternalBindings(envelope([{ issue: "XTRM-1", remoteKey: "not-a-key" }]))?.size).toBe(0);
  });

  it("parses issue and search rows without inventing fields", () => {
    expect(parseIssueRow(issueBody("MMD-1", "s", "Done", null))).toEqual({ key: "MMD-1", summary: "s", status: "Done", assignee: null });
    expect(parseIssueRow({ key: "bad" })).toBeNull();
    expect(parseIssueRow({ key: "MMD-9", fields: {} })).toEqual({ key: "MMD-9", summary: null, status: null, assignee: null });
    expect(parseSearch(searchBody(["MMD-1"], false))?.truncated).toBe(true);
    expect(parseSearch({ issues: "no" })).toBeNull();
  });
});

describe.each(HOOKS)("jira middleware (%s)", (hook) => {
  it("reads one issue with the per-request credential and returns no credential material", async () => {
    const { fetchImpl, calls, headers } = responder(() => ({ status: 200, body: issueBody("MMD-551") }));
    const res = await send(setup().middleware(fetchImpl, hook), "GET", issueUrl("MMD-551"));

    expect(res.status).toBe(200);
    expect(res.body.issue).toMatchObject({
      key: "MMD-551",
      summary: "Ship the Project surface",
      status: "In Progress",
      assignee: "Console lead",
      url: "https://mtl.atlassian.net/browse/MMD-551",
      syncState: null,
      issueRef: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
    const upstreamUrl = new URL(calls[0]!);
    expect(upstreamUrl.pathname).toBe("/rest/api/3/issue/MMD-551");
    expect(upstreamUrl.searchParams.get("fields")).toBe("summary,status,assignee");
    expect(headers[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("refuses a malformed key with 400 before any upstream call", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: issueBody("MMD-551") }));
    const middleware = setup().middleware(fetchImpl, hook);
    for (const key of ["bad", "mmd-1", "MMD-1 OR 1=1"]) {
      expect((await send(middleware, "GET", issueUrl(encodeURIComponent(key)))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a key outside the bound project with 403 before any upstream call", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: issueBody("OTHER-1") }));
    const res = await send(setup().middleware(fetchImpl, hook), "GET", issueUrl("OTHER-1"));
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("outside the bound jira project");
    expect(calls).toHaveLength(0);
  });

  it("joins links with Substrate bindings through sb external list", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: searchBody(["MMD-551", "MMD-700"]) }));
    const argvSeen: string[][] = [];
    const runExternal = async (argv: string[]) => {
      argvSeen.push(argv);
      return {
        status: 200,
        body: envelope([
          { issue: "XTRM-816", remoteKey: "MMD-551", syncState: "in_sync", url: "https://mtl.atlassian.net/browse/MMD-551" },
          { issue: "XTRM-820", remoteKey: "MMD-700", syncState: "pending", url: "https://mtl.atlassian.net/browse/MMD-700" },
        ]),
      };
    };
    const res = await send(setup({ runExternal }).middleware(fetchImpl, hook), "GET", linksUrl("MMD-551,MMD-700"));

    expect(res.status).toBe(200);
    expect(res.body.bindingsAvailable).toBe(true);
    expect(res.body.links.map((i: { key: string }) => i.key)).toEqual(["MMD-551", "MMD-700"]);
    expect(res.body.links[0]).toMatchObject({ key: "MMD-551", issueRef: "XTRM-816", syncState: "in_sync" });
    expect(res.body.links[1]).toMatchObject({ key: "MMD-700", issueRef: "XTRM-820", syncState: "pending" });
    expect(argvSeen[0]).toEqual(["external", "list", "--provider", "jira", "--scope", "mtl.atlassian.net:MMD", "--project", "prj_mmd"]);
    expect(new URL(calls[0]!).searchParams.get("jql")).toBe("key in (MMD-551, MMD-700) ORDER BY updated DESC");
  });

  it("refuses a malformed or foreign key list before any upstream call", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: searchBody([]) }));
    const middleware = setup().middleware(fetchImpl, hook);

    expect((await send(middleware, "GET", linksUrl("MMD-1,bad"))).status).toBe(400);
    expect((await send(middleware, "GET", linksUrl(""))).status).toBe(400);
    expect((await send(middleware, "GET", linksUrl("MMD-1,OTHER-1"))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("degrades the join to 'unknown' when Substrate cannot answer, without failing the read", async () => {
    const { fetchImpl } = responder(() => ({ status: 200, body: searchBody(["MMD-551"]) }));
    const res = await send(setup({ runExternal: () => Promise.resolve({ status: 502, body: "" }) }).middleware(fetchImpl, hook), "GET", linksUrl("MMD-551"));

    expect(res.status).toBe(200);
    expect(res.body.bindingsAvailable).toBe(false);
    expect(res.body.links[0]).toMatchObject({ key: "MMD-551", issueRef: null, syncState: null });
  });

  it("search sends the fixed project template and refuses foreign JQL", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: searchBody(["MMD-551", "MMD-612"], false) }));
    const middleware = setup().middleware(fetchImpl, hook);

    const ok = await send(middleware, "GET", searchUrl("project = MMD"));
    expect(ok.status).toBe(200);
    expect(ok.body.truncated).toBe(true);
    const upstreamUrl = new URL(calls[0]!);
    expect(upstreamUrl.pathname).toBe("/rest/api/3/search/jql");
    expect(upstreamUrl.searchParams.get("jql")).toBe("project = MMD ORDER BY updated DESC");
    expect(upstreamUrl.searchParams.get("maxResults")).toBe("50");

    const refused = await send(middleware, "GET", searchUrl("project = OTHER"));
    expect(refused.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("answers 503 when the credential file is missing and still describes the binding", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: issueBody("MMD-551") }));
    const middleware = setup({ writeToken: false }).middleware(fetchImpl, hook);

    const binding = await send(middleware, "GET", `/xtrm-api/jira/binding?repo=${encodeURIComponent(REPO)}`);
    expect(binding.status).toBe(200);
    expect(binding.body.binding).toMatchObject({ configured: true, project: "MMD", credentialPresent: false, tokenFile: expect.stringContaining("jira-token") });
    expect(JSON.stringify(binding.body)).not.toContain(TOKEN);

    const res = await send(middleware, "GET", issueUrl("MMD-551"));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(calls).toHaveLength(0);
  });

  it("maps upstream statuses to generic bridge failures", async () => {
    const middlewareFor = (status: number, body: unknown = {}) => {
      const { fetchImpl } = responder(() => ({ status, body }));
      return setup().middleware(fetchImpl, hook);
    };

    const rejected = await send(middlewareFor(401, { errorMessages: ["secret upstream body"] }), "GET", issueUrl("MMD-551"));
    expect(rejected.status).toBe(502);
    expect(rejected.body.error).toBe("jira rejected the credential");
    expect(JSON.stringify(rejected.body)).not.toContain("secret upstream body");

    expect((await send(middlewareFor(403), "GET", issueUrl("MMD-551"))).status).toBe(502);
    const missing = await send(middlewareFor(404), "GET", issueUrl("MMD-551"));
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("jira issue not found");
    expect((await send(middlewareFor(500), "GET", issueUrl("MMD-551"))).status).toBe(502);
  });

  it("reports an unbound repository and a repository bound without Jira", async () => {
    const { fetchImpl } = responder(() => ({ status: 200, body: issueBody("MMD-551") }));
    const middleware = setup().middleware(fetchImpl, hook);

    const unbound = await send(middleware, "GET", `/xtrm-api/jira/issue?repo=someone%2Funknown&key=MMD-551`);
    expect(unbound.status).toBe(404);
    expect(unbound.body).toMatchObject({ configured: false, reason: "repo_not_bound" });

    const noJira = await send(middleware, "GET", `/xtrm-api/jira/issue?repo=someone%2Fboard-only&key=MMD-551`);
    expect(noJira.status).toBe(404);
    expect(noJira.body).toMatchObject({ configured: false, reason: "jira_not_configured" });
  });

  it("caches a successful read and never caches a failure", async () => {
    let reply: Reply = { status: 200, body: issueBody("MMD-551") };
    const { fetchImpl, calls } = responder(() => reply);
    const middleware = setup().middleware(fetchImpl, hook);

    expect((await send(middleware, "GET", issueUrl("MMD-551"))).status).toBe(200);
    expect((await send(middleware, "GET", issueUrl("MMD-551"))).status).toBe(200);
    expect(calls).toHaveLength(1);

    // A failure on a second key is not cached: the retry reaches upstream again.
    reply = { status: 500, body: {} };
    expect((await send(middleware, "GET", issueUrl("MMD-612"))).status).toBe(502);
    reply = { status: 200, body: issueBody("MMD-612") };
    expect((await send(middleware, "GET", issueUrl("MMD-612"))).status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("answers read-only and unknown routes without touching upstream", async () => {
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: issueBody("MMD-551") }));
    const middleware = setup().middleware(fetchImpl, hook);

    expect((await send(middleware, "POST", issueUrl("MMD-551"))).status).toBe(405);
    expect((await send(middleware, "GET", `/xtrm-api/jira/write?repo=${encodeURIComponent(REPO)}`)).status).toBe(404);
    expect((await send(middleware, "GET", "/xtrm-api/jira/issue?key=MMD-551")).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
