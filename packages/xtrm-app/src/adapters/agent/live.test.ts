import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilities, createLiveAgent, parseSse } from "./live.ts";
import type { HostSessionSummary } from "./protocol.ts";

const summary = (over: Partial<HostSessionSummary> = {}): HostSessionSummary => ({
  sessionId: "s1",
  provider: "pi",
  state: "working",
  cwd: "/w",
  extensionConnected: true,
  capabilities: ["presence", "stream", "prompt", "steer", "abort"],
  frameCount: 3,
  startedAt: 100,
  lastActivityAt: 200,
  tmux: { session: "probe", paneId: "%0" },
  ...over,
});

const event = (cursor: number, payload: object, sessionId = "s1") =>
  `id: ${cursor}\ndata: ${JSON.stringify({ schema: "xtrm.agent-host-api.v1", kind: "event", cursor: String(cursor), frame: { schema: "xtrm.agent-event.v1", seq: cursor, sessionId, at: 1000 + cursor, payload } })}\n\n`;

/** Fake bridge: JSON routes plus one scripted event stream per request. */
function bridge(streams: string[][], sessions: HostSessionSummary[] = [summary()]) {
  const requests: Array<{ url: string; lastEventId: string | null }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, lastEventId: headers.get("last-event-id") });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/v1/events")) {
      const chunks = streams.shift();
      if (!chunks) return new Promise<Response>(() => {});
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-xtrm-agent-host": "local:1" } });
    }
    if (url.includes("/repo?")) return json({ repo: "xtrm-dev/xtrm" });
    const m = /\/api\/v1\/sessions\/([^/]+)$/.exec(url);
    if (m) {
      const s = sessions.find((x) => x.sessionId === decodeURIComponent(m[1]!));
      return s ? json({ schema: "xtrm.agent-host-api.v1", kind: "session_detail", session: s }) : json({ schema: "xtrm.agent-host-api.v1", kind: "error", code: "session_not_found", message: "no session" }, 404);
    }
    if (url.endsWith("/api/v1/sessions")) return json({ schema: "xtrm.agent-host-api.v1", kind: "session_list", sessions });
    return json({ ok: false, error: "no route" }, 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

const settle = () => new Promise((r) => setTimeout(r, 30));
let adapter: ReturnType<typeof createLiveAgent> | null = null;
afterEach(() => adapter?.close());

describe("parseSse", () => {
  it("returns complete events and keeps a partial one", () => {
    const { data, rest } = parseSse(": comment\n\nid: 1\ndata: {\"a\":1}\n\nid: 2\r\ndata: {\"b\"");
    expect(data).toEqual(['{"a":1}']);
    expect(rest).toBe('id: 2\ndata: {"b"');
  });
});

describe("capabilities", () => {
  it("maps presence-only, history-only and promptable sessions", () => {
    expect(capabilities(summary({ provider: "claude", capabilities: ["presence"] }))).toEqual(["presence"]);
    expect(capabilities(summary({ state: "history_only", capabilities: [] }))).toEqual([]);
    expect(capabilities(summary())).toEqual(["prompt", "steer"]);
  });
});

describe("live agent adapter", () => {
  it("maps host sessions and projects Frames from the event stream", async () => {
    const { fetchImpl, requests } = bridge([
      [
        ": xtrm agent host\n\n",
        event(1, { type: "session_identity", runtime: { name: "pi", version: "1.0.0" }, cwd: "/w", capabilities: ["prompt"] }),
        event(2, { type: "before_agent_start", prompt: "Read the notes", ingress: { origin: "terminal" } }),
        // An event split across chunks.
        event(3, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "notes.txt" }, origin: { class: "native" } }).slice(0, 40),
        event(3, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "notes.txt" }, origin: { class: "native" } }).slice(40),
        event(4, { type: "agent_settled" }),
      ],
    ]);
    adapter = createLiveAgent({ fetch: fetchImpl, notifyMs: 5, retryMs: [5, 10] });
    const changed: string[] = [];
    adapter.subscribe((id) => changed.push(id));
    await settle();

    expect(requests.find((r) => r.url.endsWith("/events"))?.lastEventId).toBe("0");
    expect(changed).toContain("s1");

    const [s] = await adapter.listSessions();
    expect(s).toMatchObject({ id: "s1", name: "probe", title: "Read the notes", state: "working", repo: "xtrm-dev/xtrm", capabilities: ["prompt", "steer"], frameCount: 3, origin: "terminal" });

    const d = await adapter.getSession("s1");
    expect(d).toMatchObject({ tmux: "probe:%0", cwd: "/w" });
    expect(d!.frames).toHaveLength(1);
    expect(d!.frames[0]).toMatchObject({ index: 3, status: "settled", title: "Read the notes" });
    expect(d!.frames[0]!.activity[0]).toMatchObject({ kind: "tool", class: "native", subject: "notes.txt" });
    expect(await adapter.getSession("missing")).toBeNull();
  });

  it("reconnects with Last-Event-ID set to the last cursor", async () => {
    const { fetchImpl, requests } = bridge([[event(41, { type: "agent_start" })], []]);
    adapter = createLiveAgent({ fetch: fetchImpl, notifyMs: 5, retryMs: [5, 10] });
    adapter.subscribe(() => {});
    await settle();
    const streams = requests.filter((r) => r.url.endsWith("/events"));
    expect(streams.map((r) => r.lastEventId)).toEqual(["0", "41", "41"]);
  });

  it("ignores frames of another contract major", async () => {
    const other = `data: ${JSON.stringify({ schema: "xtrm.agent-host-api.v2", kind: "event", cursor: "1", frame: { schema: "xtrm.agent-event.v2", seq: 0, sessionId: "s1", at: 1, payload: { type: "agent_start" } } })}\n\n`;
    const { fetchImpl } = bridge([[other]]);
    adapter = createLiveAgent({ fetch: fetchImpl, notifyMs: 5, retryMs: [5, 10] });
    adapter.subscribe(() => {});
    await settle();
    expect(adapter.projector().sessions.size).toBe(0);
  });

  it("is read-only", async () => {
    adapter = createLiveAgent({ fetch: bridge([]).fetchImpl });
    await expect(adapter.submit("s1", { text: "hi", refs: [], mode: "prompt" })).rejects.toThrow(/read-only/);
  });
});
