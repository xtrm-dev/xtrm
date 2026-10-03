// Read routes of the live Agent half (XTRM-572): which agent host the bridge reads, the event
// stream proxy, and repository identity for local session paths.
//
// Host selection: the SSH-forwarded remote host while the SSH connection is up (XTRM-585), else
// the loopback host on this machine: XTRM_AGENT_HOST_PORT, or the port in the host's info file
// (~/.xtrm/run/agent-host.json, written by `xt host start`) when its pid is alive. Requests carry a
// loopback Host header and no proxy headers, so the host treats them as local (PRD §35.5).

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HostEndpoint {
  port: number;
  /** Stable identity of the host instance; sent to the app as `x-xtrm-agent-host`. */
  id: string;
  /** True for the loopback host on this machine: its session paths exist here. */
  local: boolean;
}

export function defaultInfoFile(): string {
  return join(homedir(), ".xtrm", "run", "agent-host.json");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The loopback agent host: an explicit port, else a live info file; null when none runs. */
export function localEndpoint(env: NodeJS.ProcessEnv = process.env, infoFile = env.XTRM_AGENT_HOST_INFO || defaultInfoFile()): HostEndpoint | null {
  const explicit = Number(env.XTRM_AGENT_HOST_PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit < 65536) return { port: explicit, id: `local:${explicit}`, local: true };
  try {
    const info = JSON.parse(readFileSync(infoFile, "utf8")) as { port?: unknown; pid?: unknown };
    const { port, pid } = info;
    if (Number.isInteger(port) && Number.isInteger(pid) && alive(pid as number)) return { port: port as number, id: `local:${port}:${pid}`, local: true };
  } catch {
    // no info file: no local host
  }
  return null;
}

/**
 * Pipe the host's SSE stream (GET /v1/events) to the client. Last-Event-ID is forwarded so a
 * reconnecting client resumes from the host's replay buffer. The upstream request ends with the
 * client, and the client response ends with the upstream (host stopped, forward closed).
 */
export function proxyEvents(ep: HostEndpoint, req: IncomingMessage, res: ServerResponse, sessionId: string | null) {
  const lastEventId = req.headers["last-event-id"];
  const path = `/v1/events${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`;
  const upstream = request(
    {
      host: "127.0.0.1",
      port: ep.port,
      path,
      method: "GET",
      headers: { accept: "text/event-stream", ...(typeof lastEventId === "string" && /^\d{1,20}$/.test(lastEventId) ? { "last-event-id": lastEventId } : {}) },
    },
    (up) => {
      if (up.statusCode !== 200) {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, error: `agent host event stream answered ${up.statusCode}` }));
        up.resume();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-xtrm-agent-host": ep.id,
      });
      res.flushHeaders();
      up.on("data", (chunk: Buffer) => res.write(chunk));
      up.on("end", () => res.end());
      up.on("error", () => res.end());
    },
  );
  upstream.on("error", (e) => {
    if (res.headersSent) return void res.end();
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: `agent host unreachable: ${e.message}` }));
  });
  const stop = () => upstream.destroy();
  req.on("close", stop);
  res.on("close", stop);
  upstream.end();
}

/** `owner/name` from a git remote URL (https, ssh, scp-like); null for anything else. */
export function repoFromRemote(url: string): string | null {
  const m = /^(?:https?:\/\/[^/]+\/|ssh:\/\/[^/]+\/|[^@\s]+@[^:\s]+:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

const repoCache = new Map<string, Promise<string | null>>();

/** Repository identity of a local path: its `origin` remote as `owner/name`. */
export function resolveRepo(path: string): Promise<string | null> {
  let p = repoCache.get(path);
  if (!p) {
    p = new Promise((resolve) =>
      execFile("git", ["-C", path, "remote", "get-url", "origin"], { timeout: 3_000 }, (err, stdout) => resolve(err ? null : repoFromRemote(stdout))),
    );
    repoCache.set(path, p);
  }
  return p;
}
