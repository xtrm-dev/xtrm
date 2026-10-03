// Frames from provider session history (XTRM-604; PRD §26, §36.11 criterion 28).
//
// The host's replay buffer holds the last 1024 events, so the event stream alone misses older
// Frames. The session journal is authoritative for the transcript: the host returns its entries
// (GET /v1/sessions/:id/history, xtrm.agent-host-api.v1 session_history) and this module projects
// them through the same AgentProjector as live events, then merges the two Frame lists.
//
// Projection of journal entries (Pi):
// - A user message opens a Frame, unless the last assistant message asked for tools: then the
//   run was still going and the message is a delivered steer.
// - An assistant message ends as message_end; each toolCall part starts its call; a toolResult
//   message ends it. Tool origin and nested calls are not in the journal: those calls show as
//   unclassified (§36.7 rule 6) unless a live Frame carries them.
// - A Frame closes when the next one opens, or at the end once the last assistant message did not
//   ask for tools. A stopped session closes its last Frame.
//
// Merging (no duplicate, no gap at the buffer boundary):
// - A live Frame matches a history Frame that has one of its user-message timestamps (Pi writes the
//   same message object to the journal and the stream), or one of its tool call ids (a live Frame
//   that started before the buffer has no user message, but its calls are in the journal).
// - A matched pair shows the live Frame (origins, nested calls, prompts, current status), preceded
//   by history activity the live Frame lacks. Unmatched live Frames are newer and come last.
// - Exception (XTRM-613): when the host reports the session idle, a live Frame still working missed
//   its end event (the stream reconnected past the replay buffer); it takes the settled status of its
//   last history Frame.
import { AgentProjector } from "./projector.ts";
import { EVENT_SCHEMA, HOST_API_SCHEMA, type HostAgentMessage, type HostEventMessage, type HostEventPayload } from "./protocol.ts";
import type { Activity, InteractionFrame } from "./types.ts";

type Entry = Record<string, unknown>;

/** Frames projected from a session journal, with the user-message timestamps of each Frame. */
export interface HistoryFrames {
  frames: InteractionFrame[];
  keys: Map<string, number[]>;
  truncated: boolean;
  /** Usage the journal recorded on assistant messages (XTRM-601): totals, cost, and the last context. */
  tokens?: { input: number; output: number } | null;
  costUsd?: number | null;
  contextTokens?: number | null;
  model?: string | null;
}

interface ToolCallPart {
  type: "toolCall";
  id: string;
  name: string;
  arguments?: unknown;
}

const isToolCall = (p: unknown): p is ToolCallPart =>
  !!p && typeof p === "object" && (p as { type?: unknown }).type === "toolCall" && typeof (p as { id?: unknown }).id === "string" && typeof (p as { name?: unknown }).name === "string";

const epoch = (v: unknown, fallback: number): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : fallback;
};

/** Host events equivalent to the journal entries, in order, for AgentProjector.apply. */
export function historyEvents(sessionId: string, entries: Entry[], ended: boolean): HostEventMessage[] {
  const out: HostEventMessage[] = [];
  let at = 0;
  let open = false;
  /** The last assistant message asked for tools: the run continues after their results. */
  let toolUse = false;
  const emit = (payload: HostEventPayload) =>
    out.push({ schema: HOST_API_SCHEMA, kind: "event", cursor: `h${out.length}`, frame: { schema: EVENT_SCHEMA, seq: out.length, sessionId, at, payload } });

  for (const e of entries) {
    at = epoch(e.timestamp, at);
    if (e.type === "compaction") {
      emit({ type: "session_compact", reason: "journal" });
      continue;
    }
    if (e.type !== "message" || !e.message || typeof e.message !== "object") continue;
    const m = e.message as HostAgentMessage & { toolCallId?: unknown; toolName?: unknown; isError?: unknown };
    at = epoch(m.timestamp, at);
    if (m.role === "user") {
      if (!open || !toolUse) {
        if (open) emit({ type: "agent_settled" });
        const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("") : "";
        emit({ type: "before_agent_start", prompt: text, ingress: { origin: "terminal" } });
        open = true;
      }
      toolUse = false;
      emit({ type: "message_end", message: m });
    } else if (m.role === "assistant") {
      emit({ type: "message_end", message: m });
      const calls = Array.isArray(m.content) ? m.content.filter(isToolCall) : [];
      for (const c of calls) emit({ type: "tool_execution_start", toolCallId: c.id, toolName: c.name, args: c.arguments });
      toolUse = calls.length > 0 || m.stopReason === "toolUse";
    } else if (m.role === "toolResult" && typeof m.toolCallId === "string") {
      emit({ type: "tool_execution_end", toolCallId: m.toolCallId, toolName: typeof m.toolName === "string" ? m.toolName : "", result: { content: m.content }, isError: m.isError === true });
    }
  }
  if (open && (ended || !toolUse)) emit(ended && toolUse ? { type: "session_shutdown", reason: "history" } : { type: "agent_settled" });
  return out;
}

/** Project a session_history body into Frames; every Frame is kept. */
export function projectHistory(sessionId: string, entries: Entry[], ended: boolean, truncated = false): HistoryFrames {
  const projector = new AgentProjector(Infinity);
  for (const ev of historyEvents(sessionId, entries, ended)) projector.apply(ev);
  const s = projector.sessions.get(sessionId);
  return {
    frames: s?.frames ?? [],
    keys: s?.keys ?? new Map(),
    truncated,
    tokens: s?.tokens ?? null,
    costUsd: s?.costUsd ?? null,
    contextTokens: s?.contextTokens ?? null,
    model: s?.model ?? null,
  };
}

/** Top-level tool call ids of a Frame. */
const toolIds = (f: InteractionFrame): string[] => f.activity.filter((a) => a.kind === "tool").map((a) => a.id);

/** History activity the live Frame lacks: calls by id, notes by kind and text; compaction once. */
function missing(history: Activity[], live: Activity[]): Activity[] {
  const ids = new Set(live.map((a) => a.id));
  const notes = new Set(live.filter((a) => a.kind !== "tool" && a.kind !== "prompt").map((a) => `${a.kind}:${"text" in a ? a.text : ""}`));
  const compacted = live.some((a) => a.kind === "compaction");
  return history.filter((a) => {
    if (a.kind === "tool" || a.kind === "prompt") return !ids.has(a.id);
    if (a.kind === "compaction") return !compacted;
    return !notes.has(`${a.kind}:${"text" in a ? a.text : ""}`);
  });
}

function combine(hs: InteractionFrame[], live: InteractionFrame, idle: boolean): InteractionFrame {
  const first = hs[0]!;
  const last = hs[hs.length - 1]!;
  const partial = !live.ingress.text && !!first.ingress.text;
  const missedEnd = idle && live.status === "working" && last.status !== "working";
  return {
    ...live,
    ...(missedEnd ? { status: last.status, settledAt: last.settledAt } : {}),
    ...(partial ? { title: first.title, ingress: first.ingress } : {}),
    activity: [...missing(hs.flatMap((h) => h.activity), live.activity), ...live.activity],
    response: live.response ?? hs[hs.length - 1]!.response,
    startedAt: Math.min(live.startedAt, first.startedAt),
  };
}

/**
 * Every Frame of the session: history Frames in journal order, each matched live Frame in place of
 * the history Frames it covers, then the live Frames newer than the journal. Numbered 1..n.
 * `idle`: the host reports the session not working (settled, failed, or history only).
 */
export function mergeFrames(history: HistoryFrames, live: InteractionFrame[], liveKeys: Map<string, number[]>, idle = false): InteractionFrame[] {
  const byKey = new Map<number, InteractionFrame>();
  const byTool = new Map<string, InteractionFrame>();
  for (const h of history.frames) {
    for (const k of history.keys.get(h.id) ?? []) byKey.set(k, h);
    for (const id of toolIds(h)) byTool.set(id, h);
  }
  /** History Frames covered by each live Frame, and the live Frame covering each history Frame. */
  const covered = new Map<InteractionFrame, InteractionFrame[]>();
  const owner = new Map<InteractionFrame, InteractionFrame>();
  for (const l of live) {
    const hs = new Set<InteractionFrame>();
    for (const k of liveKeys.get(l.id) ?? []) {
      const h = byKey.get(k);
      if (h) hs.add(h);
    }
    for (const id of toolIds(l)) {
      const h = byTool.get(id);
      if (h) hs.add(h);
    }
    const free = [...hs].filter((h) => !owner.has(h));
    if (!free.length) continue;
    free.sort((a, b) => history.frames.indexOf(a) - history.frames.indexOf(b));
    covered.set(l, free);
    for (const h of free) owner.set(h, l);
  }
  const out: InteractionFrame[] = [];
  const placed = new Set<InteractionFrame>();
  for (const h of history.frames) {
    const l = owner.get(h);
    if (!l) out.push(h);
    else if (!placed.has(l)) {
      placed.add(l);
      out.push(combine(covered.get(l)!, l, idle));
    }
  }
  for (const l of live) if (!placed.has(l) && !covered.has(l)) out.push(l);
  return out.map((f, i) => ({ ...structuredClone(f), index: i + 1 }));
}
