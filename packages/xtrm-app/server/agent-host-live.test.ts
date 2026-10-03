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
    expect(localEndpoint({ XTRM_AGENT_HOST_PORT: "4100" }, info)).toEqual({ port: 4100, id: "local:4100", local: true });
    expect(localEndpoint({}, info)).toBeNull();
    writeFileSync(info, JSON.stringify({ port: 4200, pid: process.pid }));
    expect(localEndpoint({}, info)).toEqual({ port: 4200, id: `local:4200:${process.pid}`, local: true });
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
    const port = await listen((req, res) => proxyEvents({ port: hostPort, id: "local:x", local: true }, req, res, "s1"));
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "last-event-id": "7" } });
    expect(res.headers.get("x-xtrm-agent-host")).toBe("local:x");
    expect(await res.text()).toContain('data: {"cursor":"8"}');
    expect(seen).toEqual({ url: "/v1/events?sessionId=s1", lastEventId: "7" });
  });

  it("answers 502 when the host is unreachable", async () => {
    const dead = await listen(() => {});
    servers.pop()!.close();
    const port = await listen((req, res) => proxyEvents({ port: dead, id: "x", local: true }, req, res, null));
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
    const handle = agentHostHandler(conn, undefined, () => ({ port: hostPort, id: "local:t", local: true }));
    const port = await listen((req, res) => void handle(req, res, () => ((res.statusCode = 404), res.end())));
    const res = await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/sessions`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-xtrm-agent-host")).toBe("local:t");
    expect(((await res.json()) as { path: string }).path).toBe("/v1/sessions");
    expect((await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/events?sessionId=bad%20id`)).status).toBe(400);
    expect(await (await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/repo?path=relative`)).json()).toEqual({ repo: null });

    const none = agentHostHandler(conn, undefined, () => null);
    const port2 = await listen((req, res) => void none(req, res, () => ((res.statusCode = 404), res.end())));
    expect((await fetch(`http://127.0.0.1:${port2}/xtrm-api/agent-host/api/v1/events`)).status).toBe(409);
  });
});
