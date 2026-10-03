// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DirectConnection, PairError, validateDeviceName, validateFrontUrl } from "./agent-host-direct.ts";
import { AgentHostConnection, agentHostHandler } from "./agent-host-ssh.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)));
}

const DEVICE_TOKEN = `xtd_${"a".repeat(43)}`;
const AUTH = "xtrm.agent-host-auth.v1";
const API = "xtrm.agent-host-api.v1";

/** A front that behaves like `xt host start --direct` behind a proxy: single-use pairing, bearer check, revoke. */
async function fakeFront() {
  const tokens = new Set(["xtp_good"]);
  const seen: Array<{ method?: string; url?: string; authorization?: string }> = [];
  let revoked = false;
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const body = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((r) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c));
      req.on("end", () => r(JSON.parse(raw || "{}")));
    });
  const port = await listen(async (req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    if (req.method === "POST" && req.url === "/v1/pair") {
      const b = await body(req);
      if (b.schema !== AUTH || b.kind !== "pair_request") return json(res, 400, { schema: API, kind: "error", code: "invalid_request", message: "bad" });
      if (!tokens.delete(b.pairingToken as string)) return json(res, 401, { schema: API, kind: "error", code: "invalid_pairing_token", message: "the pairing token is unknown, used or expired" });
      return json(res, 200, { schema: AUTH, kind: "device_session", device: { deviceId: "dev1", name: b.deviceName, createdAt: 1 }, token: DEVICE_TOKEN });
    }
    if (revoked || req.headers.authorization !== `Bearer ${DEVICE_TOKEN}`) return json(res, 401, { schema: API, kind: "error", code: "unauthorized", message: "a device session bearer token is required" });
    if (req.url?.startsWith("/v1/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end('id: 1\ndata: {"cursor":"1"}\n\n');
    }
    if (req.method === "POST") return json(res, 200, { schema: API, kind: "submit_result", commandId: "c1", status: "accepted" });
    return json(res, 200, { schema: API, kind: "session_list", sessions: [{ sessionId: "remote-1" }] });
  });
  return { url: `http://127.0.0.1:${port}`, seen, revoke: () => (revoked = true) };
}

const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "xh-direct-"));
  dirs.push(d);
  return d;
};
const tmpFile = () => join(tmpDir(), "app", "device.json");

describe("validateFrontUrl", () => {
  it("accepts https anywhere and http on loopback only, as a bare origin", () => {
    expect(validateFrontUrl("https://box.tailnet.ts.net")).toBe("https://box.tailnet.ts.net");
    expect(validateFrontUrl("https://box.tailnet.ts.net:8443/")).toBe("https://box.tailnet.ts.net:8443");
    expect(validateFrontUrl("http://127.0.0.1:9000")).toBe("http://127.0.0.1:9000");
    expect(validateFrontUrl("http://localhost:9000")).toBe("http://localhost:9000");
    expect(validateFrontUrl("http://box.tailnet.ts.net")).toBeNull();
    expect(validateFrontUrl("https://u:p@box.example")).toBeNull();
    expect(validateFrontUrl("https://box.example/api")).toBeNull();
    expect(validateFrontUrl("https://box.example/?t=1")).toBeNull();
    expect(validateFrontUrl("ftp://box.example")).toBeNull();
    expect(validateFrontUrl(42)).toBeNull();
  });

  it("cleans the device name", () => {
    expect(validateDeviceName(" phone\u0007 ")).toBe("phone");
    expect(validateDeviceName("")).toBe("xtrm-app");
    expect(validateDeviceName("x".repeat(100))).toHaveLength(64);
  });
});

describe("DirectConnection", () => {
  it("pairs once, keeps the device token in a 0600 file only, and refuses a replay", async () => {
    const front = await fakeFront();
    const file = tmpFile();
    const direct = new DirectConnection({ file });
    expect(direct.status()).toEqual({ phase: "unpaired", url: null });

    const state = await direct.pair({ url: front.url, pairingToken: "xtp_good", deviceName: "laptop" });
    expect(state).toEqual({ phase: "paired", url: front.url, device: { deviceId: "dev1", name: "laptop", createdAt: 1 } });
    expect(JSON.stringify(state)).not.toContain("xtd_");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(file, "..")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe(DEVICE_TOKEN);
    expect(direct.endpoint()).toMatchObject({ origin: front.url, local: false, bearer: DEVICE_TOKEN, id: `direct:${front.url}:dev1` });

    const replay = direct.pair({ url: front.url, pairingToken: "xtp_good", deviceName: "laptop" });
    await expect(replay).rejects.toBeInstanceOf(PairError);
    await expect(replay).rejects.toMatchObject({ code: "invalid_pairing_token" });
    // A failed pairing leaves the paired device in place.
    expect(direct.status().phase).toBe("paired");
    // A second process reads the same device.
    expect(new DirectConnection({ file }).endpoint()?.bearer).toBe(DEVICE_TOKEN);
  });

  it("rejects bad input before calling the front", async () => {
    const direct = new DirectConnection({ file: tmpFile(), fetch: () => Promise.reject(new Error("must not be called")) });
    await expect(direct.pair({ url: "http://box.example", pairingToken: "xtp_x", deviceName: "" })).rejects.toMatchObject({ code: "invalid_url" });
    await expect(direct.pair({ url: "https://box.example", pairingToken: "xtd_x", deviceName: "" })).rejects.toMatchObject({ code: "invalid_pairing_token" });
  });

  it("turns a refused token into a re-pair prompt, but not for a stale token", async () => {
    const front = await fakeFront();
    const file = tmpFile();
    const direct = new DirectConnection({ file });
    await direct.pair({ url: front.url, pairingToken: "xtp_good", deviceName: "laptop" });
    direct.refused("xtd_older");
    expect(direct.status().phase).toBe("paired");
    direct.refused(DEVICE_TOKEN);
    expect(direct.status()).toMatchObject({ phase: "repair", url: front.url, device: { name: "laptop" }, error: { code: "unauthorized" } });
    expect(direct.endpoint()).toBeNull();
    expect(readFileSync(file, "utf8")).not.toContain("xtd_");
    expect(new DirectConnection({ file }).status().phase).toBe("repair");
    expect(direct.forget()).toEqual({ phase: "unpaired", url: null });
  });
});

describe("bridge in direct mode", () => {
  it("pairs through the bridge, sends the bearer on reads, writes and the stream, and asks to re-pair on 401", async () => {
    const front = await fakeFront();
    const conn = new AgentHostConnection({ settingsFile: join(tmpDir(), "c.json"), run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }) });
    const direct = new DirectConnection({ file: tmpFile() });
    const handle = agentHostHandler(conn, undefined, () => null, direct);
    const port = await listen((req, res) => void handle(req, res, () => ((res.statusCode = 404), res.end())));
    const base = `http://127.0.0.1:${port}/xtrm-api/agent-host`;
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    expect((await fetch(`${base}/api/v1/sessions`)).status).toBe(409);
    const paired = await post("/direct/pair", { url: front.url, pairingToken: "xtp_good", deviceName: "laptop" });
    const pairedText = await paired.text();
    expect(paired.status).toBe(200);
    expect(pairedText).not.toContain("xtd_");
    expect(JSON.parse(pairedText)).toMatchObject({ phase: "unconfigured", direct: { phase: "paired", device: { deviceId: "dev1" } } });
    const replay = await post("/direct/pair", { url: front.url, pairingToken: "xtp_good", deviceName: "laptop" });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ code: "invalid_pairing_token" });

    const list = await fetch(`${base}/api/v1/sessions`);
    expect(list.status).toBe(200);
    expect(list.headers.get("x-xtrm-agent-host")).toBe(`direct:${front.url}:dev1`);
    expect(await list.json()).toMatchObject({ sessions: [{ sessionId: "remote-1" }] });
    expect(await (await fetch(`${base}/api/v1/events`)).text()).toContain('data: {"cursor":"1"}');
    const submit = await post("/api/v1/submit", { schema: API, kind: "submit_request", sessionId: "remote-1", command: { type: "prompt", commandId: "c1", message: "hi" } });
    expect(submit.status).toBe(200);
    // Remote paths do not exist on this machine.
    expect(await (await fetch(`${base}/repo?path=/srv/x`)).json()).toEqual({ repo: null });
    const authed = front.seen.filter((s) => s.url !== "/v1/pair");
    expect(authed.length).toBe(3);
    expect(authed.every((s) => s.authorization === `Bearer ${DEVICE_TOKEN}`)).toBe(true);
    expect(front.seen.filter((s) => s.url === "/v1/pair").every((s) => s.authorization === undefined)).toBe(true);

    front.revoke();
    const stream = await fetch(`${base}/api/v1/events`);
    expect(stream.status).toBe(401);
    const status = (await (await fetch(`${base}/connection`)).json()) as { direct: { phase: string; error?: { message: string } } };
    expect(status.direct.phase).toBe("repair");
    expect(status.direct.error?.message).toMatch(/Pair again/);
    expect((await fetch(`${base}/api/v1/sessions`)).status).toBe(409);

    expect(await (await post("/direct/forget", {})).json()).toMatchObject({ direct: { phase: "unpaired", url: null } });
  });

  it("answers 401 with a re-pair code when a read is refused", async () => {
    const front = await fakeFront();
    const conn = new AgentHostConnection({ settingsFile: join(tmpDir(), "c.json"), run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false }) });
    const direct = new DirectConnection({ file: tmpFile() });
    await direct.pair({ url: front.url, pairingToken: "xtp_good", deviceName: "x" });
    front.revoke();
    const handle = agentHostHandler(conn, undefined, () => null, direct);
    const port = await listen((req, res) => void handle(req, res, () => ((res.statusCode = 404), res.end())));
    const res = await fetch(`http://127.0.0.1:${port}/xtrm-api/agent-host/api/v1/sessions`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "repair_required" });
    expect(direct.status().phase).toBe("repair");
  });
});
