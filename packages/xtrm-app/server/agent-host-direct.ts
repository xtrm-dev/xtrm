// Direct-mode client side of the dev bridge (PRD §35.5 "Binding and authentication"; XTRM-600).
//
// The agent host binds 127.0.0.1 and is reached from other machines through an HTTPS front
// (`tailscale serve`). A client pairs once: the operator runs `xt host pair` on the host, enters the
// one-time `xtp_…` token here, and the bridge exchanges it at the front (POST /v1/pair,
// xtrm.agent-host-auth.v1) for a `xtd_…` device token. The bridge keeps that token in its own file
// (mode 0600, directory 0700) and adds `Authorization: Bearer` to every request it sends to the front.
// The page never sees the token: it talks to the bridge on its own origin, and the bridge answers
// with the device summary only. Tokens are never put in URLs, logs or error messages.
//
// When the front answers 401 to a request that carried the stored token, the device was revoked (or
// the host no longer knows it): the token is deleted and the state becomes `repair`, which the
// connection panel shows as a re-pair prompt. The front URL and device name stay for the new pairing.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEVICE_TOKEN_RE, HOST_AUTH_SCHEMA, PAIRING_TOKEN_RE, type HostDeviceSession, type HostDeviceSummary, type HostPairRequest } from "../src/adapters/agent/host-auth.ts";
import type { DirectConnectionState, DirectPairInput } from "../src/adapters/agent/host-connection.ts";
import type { HostEndpoint } from "./agent-host-live.ts";

const PAIR_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const REPAIR_MESSAGE = "The agent host no longer accepts this device: it was revoked or the host does not know it. Pair again with a new token from `xt host pair`.";

export class PairError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PairError";
  }
}

/**
 * The front's origin: `https://` on any host, or `http://` on a loopback host only (a local stand-in
 * for the HTTPS front; a bearer token never crosses the network in clear text). No credentials, path,
 * query or fragment.
 */
export function validateFrontUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return u.origin;
  return null;
}

/** Device name sent with the pair request; the host sanitizes it again. */
export function validateDeviceName(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) : "";
  return name || "xtrm-app";
}

interface DeviceFile {
  url: string;
  device: HostDeviceSummary;
  token?: string;
}

function isDevice(v: unknown): v is HostDeviceSummary {
  const d = v as Record<string, unknown> | null;
  return !!d && typeof d.deviceId === "string" && d.deviceId.length > 0 && typeof d.name === "string" && Number.isInteger(d.createdAt);
}

export function defaultDeviceFile(): string {
  return join(homedir(), ".xtrm", "app", "agent-host-device.json");
}

export interface DirectOptions {
  /** Device file (default ~/.xtrm/app/agent-host-device.json, or XTRM_AGENT_DEVICE_FILE). */
  file?: string;
  fetch?: typeof fetch;
}

export class DirectConnection {
  private readonly file: string;
  private readonly doFetch: typeof fetch;
  private stored: DeviceFile | null;
  private error: { code: string; message: string } | undefined;

  constructor(opts: DirectOptions = {}) {
    this.file = opts.file ?? defaultDeviceFile();
    this.doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.stored = this.load();
    if (this.stored && !this.stored.token) this.error = { code: "unauthorized", message: REPAIR_MESSAGE };
  }

  status(): DirectConnectionState {
    const s = this.stored;
    if (!s) return { phase: "unpaired", url: null };
    return { phase: s.token ? "paired" : "repair", url: s.url, device: s.device, ...(this.error && !s.token ? { error: this.error } : {}) };
  }

  /** The front with the device token while paired; null otherwise. */
  endpoint(): HostEndpoint | null {
    const s = this.stored;
    return s?.token ? { origin: s.url, id: `direct:${s.url}:${s.device.deviceId}`, local: false, bearer: s.token } : null;
  }

  /** POST /v1/pair at the front. A failure leaves the current device untouched. */
  async pair(input: DirectPairInput): Promise<DirectConnectionState> {
    const url = validateFrontUrl(input.url);
    if (!url) throw new PairError("invalid_url", "Enter the HTTPS front URL, for example https://machine.tailnet.ts.net (http:// only on 127.0.0.1 or localhost).");
    const pairingToken = typeof input.pairingToken === "string" ? input.pairingToken.trim() : "";
    if (!PAIRING_TOKEN_RE.test(pairingToken) || pairingToken.length > 256) throw new PairError("invalid_pairing_token", "A pairing token starts with xtp_. Run `xt host pair` on the agent host.");
    const body: HostPairRequest = { schema: HOST_AUTH_SCHEMA, kind: "pair_request", pairingToken, deviceName: validateDeviceName(input.deviceName) };

    let res: Response;
    try {
      res = await this.doFetch(`${url}/v1/pair`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
      });
    } catch (e) {
      throw new PairError("front_unreachable", `${url} did not answer: ${e instanceof Error ? e.message : String(e)}`);
    }
    const reply = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 200 && reply?.schema === HOST_AUTH_SCHEMA && reply.kind === "device_session") {
      const session = reply as unknown as HostDeviceSession;
      if (typeof session.token !== "string" || !DEVICE_TOKEN_RE.test(session.token) || !isDevice(session.device)) {
        throw new PairError("invalid_reply", `${url} answered a device_session this app cannot read.`);
      }
      this.save({ url, device: session.device, token: session.token });
      this.error = undefined;
      return this.status();
    }
    const code = typeof reply?.code === "string" ? reply.code : `http_${res.status}`;
    if (code === "invalid_pairing_token") {
      throw new PairError(code, "The pairing token is unknown, used or expired. Run `xt host pair` on the agent host for a new one.");
    }
    if (code === "direct_mode_disabled") {
      throw new PairError(code, "The agent host does not accept direct connections. Start it with `xt host start --direct --direct-host <front name>`.");
    }
    if (code === "forbidden_host") {
      throw new PairError(code, "The agent host does not answer this front's host name. Add it with `--direct-host` when you start the host.");
    }
    const message = typeof reply?.message === "string" ? reply.message.slice(0, 300) : `HTTP ${res.status}`;
    throw new PairError(code, `${url} refused the pairing: ${message}`);
  }

  /** Delete the stored token and URL. Revoke the device on the host with `xt host revoke <id>`. */
  forget(): DirectConnectionState {
    rmSync(this.file, { force: true });
    this.stored = null;
    this.error = undefined;
    return this.status();
  }

  /**
   * The front answered 401 to a request that carried `token`. Only the token that was refused is
   * dropped: a request still in flight with an older token must not undo a new pairing.
   */
  refused(token: string | undefined): void {
    const s = this.stored;
    if (!s?.token || s.token !== token) return;
    this.save({ url: s.url, device: s.device });
    this.error = { code: "unauthorized", message: REPAIR_MESSAGE };
  }

  private save(data: DeviceFile) {
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Write a new 0600 file and rename it over the old one: an older file's mode never carries over.
    const tmp = join(dir, `.agent-host-device.${process.pid}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.stored = data;
  }

  private load(): DeviceFile | null {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
      const url = validateFrontUrl(raw.url);
      if (!url || !isDevice(raw.device)) return null;
      const token = typeof raw.token === "string" && DEVICE_TOKEN_RE.test(raw.token) ? raw.token : undefined;
      return { url, device: raw.device, ...(token ? { token } : {}) };
    } catch {
      return null;
    }
  }
}
