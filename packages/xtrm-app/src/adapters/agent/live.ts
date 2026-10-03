// Live AgentAdapter (XTRM-572): reads the XTRM agent host through the dev bridge
// (server/agent-host-ssh.ts): the SSH-forwarded remote host when connected, else the loopback host.
//
// - Sessions: GET /v1/sessions and /v1/sessions/:id (xtrm.agent-host-api.v1).
// - Frames and tool activity: the host's event stream, read with fetch streaming. EventSource is
//   not used: it cannot send headers and the host answers no CORS preflight (PRD §35.5). A
//   reconnect sends Last-Event-ID with the last cursor; the first request asks for the whole
//   replay buffer (Last-Event-ID 0).
// - Write path (XTRM-597): POST /v1/submit with an xtrm.agent-command.v1 command: prompt when idle,
//   steer / follow_up while working, abort, and extension_ui_response. The host answers busy for a
//   normal prompt while the session works (§35.8 item 5); that surfaces as BusyError and the
//   composer offers Steer or Follow-up. Nothing is retried or queued here.
// - @ references are a separate issue: a submit that carries references is refused.
import { AgentProjector } from "./projector.ts";
import {
  EVENT_SCHEMA,
  HOST_API_SCHEMA,
  type HostCapability,
  type HostCommand,
  type HostEventMessage,
  type HostSessionDetail,
  type HostSessionList,
  type HostSessionSummary,
  type HostSubmitRequest,
  type HostSubmitResult,
} from "./protocol.ts";
import { BusyError, type AgentAdapter, type AgentSessionDetail, type AgentSessionSummary, type Activity, type InteractionFrame, type SessionCapability, type SessionState } from "./types.ts";

const STATE: Record<HostSessionSummary["state"], SessionState> = {
  working: "working",
  waiting_for_input: "waiting",
  settled: "settled",
  failed: "failed",
  history_only: "history",
};

/** Presence-only producers (Claude hooks) advertise only `presence`; history-only sessions nothing. */
export function capabilities(s: Pick<HostSessionSummary, "state" | "capabilities">): SessionCapability[] {
  if (s.state === "history_only") return [];
  if (s.capabilities.length > 0 && s.capabilities.every((c) => c === "presence")) return ["presence"];
  return s.capabilities.filter((c: HostCapability): c is "prompt" | "steer" | "abort" => c === "prompt" || c === "steer" || c === "abort");
}

export function displayName(s: HostSessionSummary): string {
  return s.name ?? s.tmux?.session ?? s.sessionId.slice(0, 8);
}

/** Split an SSE buffer into complete events; returns the `data` of each and the unconsumed rest. */
export function parseSse(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.startsWith("data:"));
    if (lines.length) data.push(lines.map((l) => l.slice(l[5] === " " ? 6 : 5)).join("\n"));
  }
  return { data, rest };
}

/** Command ids are unique per submit; the host rejects a duplicate in flight. */
const commandId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Error text of a refused submit: the host's message, else its reason, else the status. */
export function submitError(r: HostSubmitResult): Error {
  return new Error(r.message ?? r.reason ?? `the agent host answered ${r.status}`);
}

export interface LiveAgentOptions {
  base?: string;
  fetch?: typeof fetch;
  /** Coalescing window for change notifications per session. */
  notifyMs?: number;
  /** Backoff bounds for stream reconnects. */
  retryMs?: [number, number];
}

export function createLiveAgent(opts: LiveAgentOptions = {}): AgentAdapter & { close(): void; projector(): AgentProjector } {
  const base = opts.base ?? "/xtrm-api/agent-host";
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const notifyMs = opts.notifyMs ?? 150;
  const [retryMin, retryMax] = opts.retryMs ?? [1_000, 15_000];

  let projector = new AgentProjector();
  let hostId: string | null = null;
  let cursor: string | null = null;
  let started = false;
  let closed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<(sessionId: string) => void>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const repoCache = new Map<string, Promise<string | null>>();
  /** Answers given from this app, by extension UI request id: the host event does not carry them. */
  const answers = new Map<string, string>();

  const notify = (sessionId: string) => {
    if (pending.has(sessionId)) return;
    pending.set(
      sessionId,
      setTimeout(() => {
        pending.delete(sessionId);
        for (const l of listeners) l(sessionId);
      }, notifyMs),
    );
  };

  async function get<T>(path: string): Promise<{ status: number; body: T | null }> {
    const res = await doFetch(`${base}${path}`, { headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, body };
  }

  function hostError(status: number, body: unknown): Error {
    const b = body as { message?: unknown; error?: unknown } | null;
    const text = typeof b?.message === "string" ? b.message : typeof b?.error === "string" ? b.error : `agent host bridge answered ${status}`;
    return new Error(text);
  }

  async function consume(res: Response) {
    // The bridge names the host it reads; a different host means a different event space.
    const id = res.headers.get("x-xtrm-agent-host");
    if (id !== hostId) {
      hostId = id;
      projector = new AgentProjector();
      cursor = null;
      for (const l of listeners) l("");
    }
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const parsed = parseSse(buffer + value);
      buffer = parsed.rest;
      for (const line of parsed.data) {
        let msg: HostEventMessage;
        try {
          msg = JSON.parse(line) as HostEventMessage;
        } catch {
          continue;
        }
        if (msg?.schema !== HOST_API_SCHEMA || msg.kind !== "event" || msg.frame?.schema !== EVENT_SCHEMA) continue;
        cursor = msg.cursor;
        notify(projector.apply(msg));
      }
    }
  }

  async function run() {
    let delay = retryMin;
    while (!closed) {
      abort = new AbortController();
      try {
        const res = await doFetch(`${base}/api/v1/events`, { headers: { accept: "text/event-stream", "last-event-id": cursor ?? "0" }, signal: abort.signal });
        if (res.ok && res.body) {
          delay = retryMin;
          await consume(res);
        }
      } catch {
        // Aborted, bridge restarted, or forward closed: reconnect below.
      }
      if (closed) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(retryMax, delay * 2);
    }
  }

  const ensureStream = () => {
    if (started || closed) return;
    started = true;
    void run();
  };

  /** `owner/name` of a local repository path, through the bridge; null when unknown or remote. */
  const repoOf = (path: string | undefined): Promise<string | null> => {
    if (!path) return Promise.resolve(null);
    let p = repoCache.get(path);
    if (!p) {
      p = get<{ repo: string | null }>(`/repo?path=${encodeURIComponent(path)}`)
        .then((r) => r.body?.repo ?? null)
        .catch(() => null);
      repoCache.set(path, p);
    }
    return p;
  };

  async function summarize(h: HostSessionSummary): Promise<AgentSessionSummary> {
    const proj = projector.sessions.get(h.sessionId);
    const frames = proj?.frames ?? [];
    const first = frames.find((f) => f.ingress.text);
    const name = displayName(h);
    return {
      id: h.sessionId,
      name,
      title: first?.title ?? name,
      provider: h.provider,
      state: STATE[h.state] ?? "settled",
      role: h.role ?? null,
      workRef: h.workItem?.ref ?? null,
      repo: await repoOf(h.repository ?? h.worktree ?? h.cwd),
      model: h.model ?? proj?.model ?? null,
      thinking: h.thinkingLevel ?? proj?.thinking ?? null,
      context: h.contextUsage ? { used: h.contextUsage.tokens, window: h.contextUsage.contextWindow } : null,
      startedAt: h.startedAt ?? 0,
      lastActivityAt: h.lastActivityAt ?? h.startedAt ?? 0,
      parentId: h.parentSessionId ?? null,
      childCount: h.childCount ?? 0,
      frameCount: Math.max(h.frameCount ?? 0, frames.length),
      capabilities: capabilities(h),
      origin: h.launch ?? "terminal",
    };
  }

  async function send(sessionId: string, command: HostCommand): Promise<void> {
    const body: HostSubmitRequest = { schema: HOST_API_SCHEMA, kind: "submit_request", sessionId, command };
    const res = await doFetch(`${base}/api/v1/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const r = (await res.json().catch(() => null)) as HostSubmitResult | null;
    if (r?.kind !== "submit_result") throw hostError(res.status, r);
    if (r.status === "accepted") return;
    // The extension may refuse a prompt itself when Pi is not idle: the same busy rule.
    if (r.status === "busy" || r.reason === "busy") throw new BusyError();
    throw submitError(r);
  }

  /** Fill in the answers this app gave, which the event stream does not carry. */
  const withAnswers = (frames: InteractionFrame[]): InteractionFrame[] => {
    if (!answers.size) return frames;
    const fill = (a: Activity) => {
      if ((a.kind === "prompt" || (a.kind === "tool" && a.ui)) && a.ui && answers.has(a.id)) a.ui.answer = answers.get(a.id)!;
    };
    for (const f of frames) f.activity.forEach(fill);
    return frames;
  };

  return {
    source: "live",
    async listSessions() {
      ensureStream();
      const { status, body } = await get<HostSessionList>("/api/v1/sessions");
      if (status !== 200 || body?.kind !== "session_list") throw hostError(status, body);
      return Promise.all(body.sessions.map(summarize));
    },
    async getSession(id) {
      ensureStream();
      const { status, body } = await get<HostSessionDetail>(`/api/v1/sessions/${encodeURIComponent(id)}`);
      if (status === 404) return null;
      if (status !== 200 || body?.kind !== "session_detail") throw hostError(status, body);
      const h = body.session;
      const summary = await summarize(h);
      const proj = projector.sessions.get(id);
      const detail: AgentSessionDetail = {
        ...summary,
        cwd: h.cwd,
        worktree: h.worktree ?? null,
        branch: h.branch ?? null,
        tmux: h.tmux ? `${h.tmux.session}:${h.tmux.paneId}` : null,
        tokens: proj?.tokens ?? null,
        costUsd: proj?.costUsd ?? null,
        frames: withAnswers(projector.snapshot(id, h.frameCount ?? 0)),
      };
      return detail;
    },
    async submit(sessionId, input) {
      if (input.refs.length) throw new Error("References are not sent to the agent host yet. Remove them to send this message.");
      const type = input.mode === "follow-up" ? "follow_up" : input.mode;
      await send(sessionId, { type, commandId: commandId(), message: input.text });
    },
    async abort(sessionId) {
      await send(sessionId, { type: "abort", commandId: commandId() });
    },
    async respond(sessionId, activityId, answer) {
      const ui = projector.sessions.get(sessionId)?.prompts.get(activityId)?.ui;
      if (!ui) throw new Error("This request is no longer open.");
      const base = { type: "extension_ui_response" as const, commandId: commandId(), id: activityId };
      const command: HostCommand =
        answer === null ? { ...base, cancelled: true } : ui.type === "confirm" ? { ...base, confirmed: answer === ui.options[0] } : { ...base, value: answer };
      await send(sessionId, command);
      answers.set(activityId, answer ?? "Cancelled");
      notify(sessionId);
    },
    searchReferences: () => Promise.resolve([]),
    resolveReference: () => Promise.resolve(null),
    subscribe(listener) {
      ensureStream();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      abort?.abort();
      for (const t of pending.values()) clearTimeout(t);
    },
    projector: () => projector,
  };
}

export const liveAgent = createLiveAgent();
