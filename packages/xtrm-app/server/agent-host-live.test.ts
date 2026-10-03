// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localEndpoint, proxyEvents, repoFromRemote } from "./agent-host-live.ts";
import { AgentHostConnection, agentHostHandler } from "./agent-host-ssh.ts";

const servers: Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)));
}

describe("localEndpoint", () => {
  it("prefers XTRM_AGENT_HOST_PORT, then a live info file", () => {
    const dir = mkdtempSync(join(tmpdir(), "xh-"));
    const info = join(dir, "agent-host.json");
    expect(localEndpoint({ XTRM_AGENT_HOST_PORT: "4100" }, info)).toEqual({ origin: "http://127.0.0.1:4100", id: "local:4100", local: true });
    expect(localEndpoint({}, info)).toBeNull();
    writeFileSync(info, JSON.stringify({ port: 4200, pid: process.pid }));
    expect(localEndpoint({}, info)).toEqual({ origin: "http://127.0.0.1:4200", id: `local:4200:${process.pid}`, local: true });
    writeFileSync(info, JSON.stringify({ port: 4200, pid: 2 ** 22 + 12345 }));
    expect(localEndpoint({}, info)).toBeNull();
  });
});

describe("repoFromRemote", () => {
  it("reads owner/name from https, ssh and scp-like remotes", () => {
    expect(repoFromRemote("https://github.com/xtrm-dev/xtrm.git\n")).toBe("xtrm-dev/xtrm");
    expect(repoFromRemote("git@github.com:xtrm-dev/core.git")).toBe("xtrm-dev/core");
    expect(repoFromRemote("ssh://git@github.com/xtrm-dev/xtrm")).toBe("xtrm-dev/xtrm");
    expect(repoFromRemote("/srv/git/repo")).toBeNull();
  });
});

describe("event stream proxy", () => {
  it("forwards Last-Event-ID and the session filter, names the host, and streams the body", async () => {
    let seen: { url?: string; lastEventId?: string } = {};
    const hostPort = await listen((req, res) => {
      seen = { url: req.url, lastEventId: req.headers["last-event-id"] as string };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": xtrm agent host\n\n");
      res.end('id: 8\ndata: {"cursor":"8"}\n\n');
    });
    const port = await listen((req, res) => proxyEvents({ origin: `http://127.0.0.1:${hostPort}`, id: "local:x", local: true }, req, res, "s1"));
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "last-event-id": "7" } });
    expect(res.headers.get("x-xtrm-agent-host")).toBe("local:x");
    expect(await res.text()).toContain('data: {"cursor":"8"}');
    expect(seen).toEqual({ url: "/v1/events?sessionId=s1", lastEventId: "7" });
  });

  it("answers 502 when the host is unreachable", async () => {
    const dead = await listen(() => {});
    servers.pop()!.close();
    const port = await listen((req, res) => proxyEvents({ origin: `http://127.0.0.1:${dead}`, id: "x", local: true }, req, res, null));
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(502);
  });
});

describe("bridge read routes", () => {
  it("reads the loopback host while no SSH connection is up", async () => {
    const hostPort = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ schema: "xtrm.agent-host-api.v1", kind: "session_list", sessions: [], path: req.url }));
    });
    const conn = new AgentHostConnection({ settingsFile: join(mkdtempSync(join(tmpdir(), "xh-")), "c.json"), run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }) });
    const handle = agentHostHandler(conn, undefined, () => ({ origin: `http://127.0.0.1:${hostPort}`, id: "local:t", local: true }));
    const port = await listen((req, res) => void handle(req, res, () => ((res.statusCode = 404), res.end())));
    const res = await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/sessions`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-xtrm-agent-host")).toBe("local:t");
    expect(((await res.json()) as { path: string }).path).toBe("/v1/sessions");
    // Session history (XTRM-604) is a read route too.
    const history = await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/sessions/s-1/history`);
    expect(((await history.json()) as { path: string }).path).toBe("/v1/sessions/s-1/history");
    expect((await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/sessions/s-1/other`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/events?sessionId=bad%20id`)).status).toBe(400);
    expect(await (await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/repo?path=relative`)).json()).toEqual({ repo: null });

    const none = agentHostHandler(conn, undefined, () => null);
    const port2 = await listen((req, res) => void none(req, res, () => ((res.statusCode = 404), res.end())));
    expect((await fetch(`http://127.0.0.1:${port2}/xtrm-api/agent-host/api/v1/events`)).status).toBe(409);
  });
});

describe("bridge submit route (XTRM-597)", () => {
  const submit = (sessionId = "s1") => ({
    schema: "xtrm.agent-host-api.v1",
    kind: "submit_request",
    sessionId,
    command: { type: "prompt", commandId: "c1", message: "hi" },
  });

  it("forwards a same-origin JSON submit_request to the host and returns its answer", async () => {
    let seen: { url?: string; type?: string; body?: unknown } = {};
    const hostPort = await listen((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c));
      req.on("end", () => {
        seen = { url: req.url, type: req.headers["content-type"], body: JSON.parse(raw) };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ schema: "xtrm.agent-host-api.v1", kind: "submit_result", commandId: "c1", status: "busy", reason: "session_working" }));
      });
    });
    const conn = new AgentHostConnection({ settingsFile: join(mkdtempSync(join(tmpdir(), "xh-")), "c.json"), run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }) });
    const handle = agentHostHandler(conn, undefined, () => ({ origin: `http://127.0.0.1:${hostPort}`, id: "local:t", local: true }));
    const port = await listen((req, res) => void handle(req, res, () => ((res.statusCode = 404), res.end())));
    const url = `http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/submit`;
    const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
      fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

    const res = await post(submit());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "submit_result", status: "busy" });
    expect(seen).toEqual({ url: "/v1/submit", type: "application/json", body: submit() });

    expect((await post(submit(), { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(submit("bad id"))).status).toBe(400);
    expect((await post({ ...submit(), kind: "launch_request" })).status).toBe(400);
    expect((await post(submit(), { "content-type": "application/json", origin: "http://evil.example" })).status).toBe(403);
  });
});

describe("bridge reference route (XTRM-598)", () => {
  const resolve = (references: unknown = ["@file:a.ts"]) => ({ schema: "xtrm.agent-host-api.v1", kind: "reference_resolve_request", sessionId: "s1", references });

  it("forwards a reference_resolve_request to the host and accepts submit bodies above 64 KB", async () => {
    const seen: Array<{ url?: string; body?: unknown }> = [];
    const hostPort = await listen((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c));
      req.on("end", () => {
        seen.push({ url: req.url, body: JSON.parse(raw) });
        res.setHeader("content-type", "application/json");
        const kind = req.url === "/v1/submit" ? "submit_result" : "reference_resolve_result";
        res.end(JSON.stringify({ schema: "xtrm.agent-host-api.v1", kind, commandId: "c1", status: "accepted", references: [], totalBytes: 0 }));
      });
    });
    const conn = new AgentHostConnection({ settingsFile: join(mkdtempSync(join(tmpdir(), "xh-")), "c.json"), run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }) });
    const handle = agentHostHandler(conn, undefined, () => ({ origin: `http://127.0.0.1:${hostPort}`, id: "local:t", local: true }));
    const port = await listen((req, res) => void handle(req, res, () => ((res.statusCode = 404), res.end())));
    const post = (path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
      fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    const res = await post("/references/resolve", resolve());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "reference_resolve_result" });
    expect(seen[0]).toEqual({ url: "/v1/references/resolve", body: resolve() });
    expect((await post("/references/resolve", resolve([]))).status).toBe(400);
    expect((await post("/references/resolve", resolve([1]))).status).toBe(400);
    expect((await post("/references/resolve", resolve(), { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("/references/resolve", resolve(), { "content-type": "application/json", origin: "http://evil.example" })).status).toBe(403);

    const content = "x".repeat(200 * 1024);
    const big = { schema: "xtrm.agent-host-api.v1", kind: "submit_request", sessionId: "s1", command: { type: "prompt", commandId: "c1", message: content }, references: [{ kind: "file", raw: "@file:a", status: "resolved", content }] };
    expect((await post("/submit", big)).status).toBe(200);
    expect(seen[1]).toMatchObject({ url: "/v1/submit" });
  });
});
