// Frame projection of the agent host event stream (PRD §3, §22, §36.4, §36.7; XTRM-572).
//
// Rules:
// - A Frame opens on before_agent_start (Pi) or agent_start (Claude hooks send no prompt text)
//   and closes only on agent_settled; agent_end never closes it (§35.3 fidelity table).
// - Tool class and identity come from the host's `origin`, never from the tool name.
// - A call with parentToolCallId renders inside its parent (ids `<parent>/<n>`), in start order.
// - The built-in codemode tool (sourceInfo.path `builtin:codemode`) carries its script source.
// - extension_ui_request renders as a prompt activity in the open Frame; extension_ui_resolved
//   closes it, whoever answered (XTRM-597). `editor` is never proxied by the extension.
// - A user message after the Frame's first one is a delivered steer or follow-up: a steer note.
// - A provider error in an open Frame is a retry note (XTRM-601, §31 criteria 7-8); Pi's retry, when it
//   comes, continues the same Frame, and the note then says the turn was retried. The extension does not
//   carry agent_end.willRetry, so the note never predicts a retry.
// - A message sent with @ references carries their context block (references.ts): the Frame shows the
//   operator's text and keeps the references with the revisions they were given (XTRM-598).
// - session_status replaces the session's model, thinking level and context usage (XTRM-609); the
//   model and thinking level of assistant messages are a fallback for producers that send no status.
// - Each Frame records the Pi timestamps of its user messages (`keys`): the same values the session
//   journal holds, so history.ts can match live Frames to journal Frames (XTRM-604).
// The host keeps a bounded replay buffer, so the stream alone misses Frames older than the buffer;
// the live adapter merges them from the session history (history.ts). Without history, `snapshot`
// numbers the retained Frames against the host's frameCount.
import { splitMessage } from "./references.ts";
import type { HostAgentMessage, HostEventFrame, HostEventMessage, HostToolOrigin } from "./protocol.ts";

/** The latest xtrm.agent-event.v1 session_status: the complete current state; absent fields are unknown. */
export type SessionStatus = Omit<Extract<HostEventFrame["payload"], { type: "session_status" }>, "type">;
import type { InteractionFrame, NoteActivity, PromptActivity, ToolActivity } from "./types.ts";

const MAX_FRAMES = 200;
const MAX_OUTPUT = 64 * 1024;
const TITLE_MAX = 80;

type ToolEvent = Extract<HostEventFrame["payload"], { toolCallId: string }>;

interface Tracked {
  tool: ToolActivity;
  startedAt: number;
}

export interface SessionProjection {
  frames: InteractionFrame[];
  open: InteractionFrame | null;
  /** Ending status of the open Frame from the last assistant stopReason. */
  ending: "failed" | "aborted" | null;
  tools: Map<string, Tracked>;
  /** Extension UI requests not resolved yet, by request id. */
  prompts: Map<string, PromptActivity>;
  /** User messages seen in the open Frame; the first is its request. */
  userMessages: number;
  /** Pi timestamps of the user messages of each Frame, by Frame id; the first is its request. */
  keys: Map<string, number[]>;
  status: SessionStatus | null;
  model: string | null;
  thinking: string | null;
  tokens: { input: number; output: number } | null;
  costUsd: number | null;
  /** Context tokens after the last model response (its usage), as Pi estimates them; null after a compaction. */
  contextTokens: number | null;
  /** The retry note of the last provider error in the open Frame, until the next assistant message. */
  providerError?: { note: NoteActivity; message: string } | null;
}

/** Text parts of a Pi content value (string, or an array of `{type: "text", text}` parts). */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { type: "text"; text: string } => !!p && typeof p === "object" && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string")
    .map((p) => p.text)
    .join("");
}

/** A tool result as text: its content parts, else compact JSON; undefined when nothing was reported. */
export function resultText(result: unknown): string | undefined {
  if (result === null || result === undefined) return undefined;
  const content = (result as { content?: unknown }).content;
  const text = content !== undefined ? contentText(content) : typeof result === "string" ? result : JSON.stringify(result);
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… truncated` : text;
}

/** Primary subject of a call: path, command, pattern, query, message; the script's first line for codemode. */
export function toolSubject(args: unknown, script?: string): string {
  if (script !== undefined) return script.split("\n").find((l) => l.trim() && !l.startsWith("// @options"))?.trim() ?? "";
  if (typeof args === "string") return args.slice(0, 200);
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "command", "pattern", "query", "message", "url"]) {
    if (typeof a[key] === "string") return (a[key] as string).slice(0, 200);
  }
  const first = Object.values(a).find((v) => typeof v === "string");
  return typeof first === "string" ? first.slice(0, 200) : "";
}

export function frameTitle(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return "Prompt text not reported";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

function origin(o: HostToolOrigin | undefined): ToolActivity["origin"] {
  if (!o) return {};
  const out: ToolActivity["origin"] = {};
  if (o.server) out.server = o.server;
  if (o.transport) out.transport = o.transport;
  if (o.extension) out.extension = o.extension;
  if (o.version) out.version = o.version;
  return out;
}

export function emptyProjection(): SessionProjection {
  return { frames: [], open: null, ending: null, tools: new Map(), prompts: new Map(), userMessages: 0, keys: new Map(), status: null, model: null, thinking: null, tokens: null, costUsd: null, contextTokens: null };
}

export class AgentProjector {
  readonly sessions = new Map<string, SessionProjection>();

  /** Retained Frames per session; history projection keeps every Frame (Infinity). */
  constructor(private readonly maxFrames = MAX_FRAMES) {}

  /** Apply one host event message; returns the session id it changed. */
  apply(message: HostEventMessage): string {
    const { frame, cursor } = message;
    const id = frame.sessionId;
    let s = this.sessions.get(id);
    if (!s) this.sessions.set(id, (s = emptyProjection()));
    const p = frame.payload;
    switch (p.type) {
      case "before_agent_start": {
        const f = s.open ?? this.openFrame(s, id, cursor, frame.at, p.ingress.origin);
        if (!f.ingress.text) {
          const { text, refs } = splitMessage(p.prompt);
          f.ingress = { ...f.ingress, text, refs, origin: p.ingress.origin };
          f.title = frameTitle(text);
        }
        break;
      }
      case "session_status": {
        const { type: _type, ...status } = p;
        s.status = status;
        break;
      }
      case "agent_start":
        if (!s.open) this.openFrame(s, id, cursor, frame.at, "terminal");
        break;
      case "message_update":
      case "message_end":
        if (p.type === "message_end" && p.message.role === "user") this.user(s, id, cursor, p.message);
        else this.assistant(s, p.message, p.type === "message_end");
        break;
      case "extension_ui_request": {
        if (p.method === "editor") break;
        const f = s.open ?? s.frames[s.frames.length - 1];
        if (!f) break;
        const prompt: PromptActivity = {
          kind: "prompt",
          id: p.id,
          ui: {
            type: p.method,
            prompt: p.title,
            ...(p.message ? { detail: p.message } : {}),
            options: p.method === "confirm" ? ["Yes", "No"] : p.method === "select" ? (p.options ?? []) : [],
            answer: null,
          },
        };
        f.activity.push(prompt);
        s.prompts.set(p.id, prompt);
        break;
      }
      case "extension_ui_resolved": {
        const prompt = s.prompts.get(p.id);
        if (prompt) prompt.ui.resolved = { by: p.resolvedBy, outcome: p.outcome };
        s.prompts.delete(p.id);
        break;
      }
      case "tool_execution_start":
        this.toolStart(s, id, cursor, frame.at, p);
        break;
      case "tool_execution_update": {
        const t = s.tools.get(p.toolCallId)?.tool;
        const text = t && !t.children ? resultText(p.partialResult) : undefined;
        if (t && text) t.output = text;
        break;
      }
      case "tool_execution_end": {
        const tracked = s.tools.get(p.toolCallId) ?? this.toolStart(s, id, cursor, frame.at, p);
        tracked.tool.status = p.isError ? "error" : "done";
        tracked.tool.durationMs = Math.max(0, frame.at - tracked.startedAt);
        const text = resultText(p.result);
        if (text !== undefined) tracked.tool.output = text;
        break;
      }
      case "agent_settled":
        if (s.open) this.close(s, s.ending ?? "settled", frame.at);
        break;
      case "session_compact":
      case "session_compact_failed": {
        // Pi cannot estimate the context after a compaction until the next model response.
        if (p.type === "session_compact") s.contextTokens = null;
        const f = s.open ?? s.frames[s.frames.length - 1];
        const text = p.type === "session_compact" ? `Context compacted (${p.reason})` : `Compaction failed (${p.reason})${p.errorMessage ? `: ${p.errorMessage}` : ""}`;
        f?.activity.push({ kind: "compaction", id: `${id}:${cursor}`, text });
        break;
      }
      case "session_shutdown":
        if (s.open) this.close(s, "aborted", frame.at);
        break;
      default:
        break;
    }
    return id;
  }

  /** Retained Frames numbered against the host's Frame count, deep-copied for the UI. */
  snapshot(sessionId: string, hostFrameCount = 0): InteractionFrame[] {
    const frames = this.sessions.get(sessionId)?.frames ?? [];
    const offset = Math.max(0, hostFrameCount - frames.length);
    return frames.map((f, i) => ({ ...structuredClone(f), index: offset + i + 1 }));
  }

  private openFrame(s: SessionProjection, sessionId: string, cursor: string, at: number, ingress: "gui" | "terminal"): InteractionFrame {
    const f: InteractionFrame = {
      id: `${sessionId}:${cursor}`,
      index: s.frames.length + 1,
      title: frameTitle(""),
      status: "working",
      ingress: { text: "", origin: ingress, refs: [], at },
      activity: [],
      response: null,
      startedAt: at,
      settledAt: null,
    };
    s.frames.push(f);
    if (s.frames.length > this.maxFrames) s.keys.delete(s.frames.shift()!.id);
    s.open = f;
    s.ending = null;
    s.userMessages = 0;
    return f;
  }

  private close(s: SessionProjection, status: InteractionFrame["status"], at: number) {
    const f = s.open!;
    f.status = status;
    f.settledAt = at;
    // Calls the producer never ended are not running any more once the Frame is closed.
    for (const { tool } of s.tools.values()) if (tool.status === "running") tool.status = status === "settled" ? "done" : "error";
    s.open = null;
    s.ending = null;
    s.providerError = null;
    s.tools.clear();
  }

  private user(s: SessionProjection, sessionId: string, cursor: string, m: HostAgentMessage) {
    if (!s.open) return;
    s.userMessages += 1;
    if (typeof m.timestamp === "number") {
      const keys = s.keys.get(s.open.id);
      if (keys) keys.push(m.timestamp);
      else s.keys.set(s.open.id, [m.timestamp]);
    }
    const text = splitMessage(contentText(m.content)).text.trim();
    if (s.userMessages > 1 && text) s.open.activity.push({ kind: "steer", id: `${sessionId}:${cursor}`, text: `Delivered while working: ${text}` });
  }

  private assistant(s: SessionProjection, m: HostAgentMessage, final: boolean) {
    if (m.role !== "assistant") return;
    if (s.providerError && m.stopReason !== "error") {
      s.providerError.note.text = `Retried after a provider error: ${s.providerError.message}`;
      s.providerError = null;
    }
    const text = contentText(m.content).trim();
    if (s.open && text) s.open.response = text;
    if (!final) return;
    if (m.model) s.model = m.model;
    if (m.thinkingLevel) s.thinking = m.thinkingLevel;
    // An abort during a tool call ends the next model request with the AbortError message, not "aborted".
    if (m.stopReason === "aborted" || (m.stopReason === "error" && /operation was aborted/i.test(m.errorMessage ?? ""))) s.ending = "aborted";
    else if (m.stopReason === "error") {
      s.ending = "failed";
      if (s.open) {
        const message = (m.errorMessage ?? "unknown error").slice(0, 300);
        const note: NoteActivity = { kind: "retry", id: `${s.open.id}:error:${s.open.activity.length}`, text: `Provider error: ${message}` };
        s.open.activity.push(note);
        s.providerError = { note, message };
      }
    }
    else s.ending = null;
    const u = m.usage;
    if (u) {
      const prev = s.tokens ?? { input: 0, output: 0 };
      s.tokens = { input: prev.input + (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), output: prev.output + (u.output ?? 0) };
      if (typeof u.cost?.total === "number") s.costUsd = (s.costUsd ?? 0) + u.cost.total;
      const context = u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      if (context > 0) s.contextTokens = context;
    }
  }

  private toolStart(s: SessionProjection, sessionId: string, cursor: string, at: number, p: ToolEvent): Tracked {
    const known = s.tools.get(p.toolCallId);
    if (known) return known;
    const codemode = p.tool?.sourceInfo?.path === "builtin:codemode";
    const code = codemode && p.args && typeof (p.args as { code?: unknown }).code === "string" ? ((p.args as { code: string }).code) : undefined;
    const tool: ToolActivity = {
      kind: "tool",
      id: p.toolCallId,
      // No origin means the host could not classify the call (§36.7 rule 6): shown as an extension call.
      class: p.origin?.class ?? "extension",
      name: p.toolName,
      subject: toolSubject(p.args, code),
      status: "running",
      durationMs: null,
      origin: origin(p.origin),
    };
    if (p.args && typeof p.args === "object" && !Array.isArray(p.args) && !codemode) tool.args = p.args as Record<string, unknown>;
    if (codemode) {
      tool.script = code ?? "";
      tool.children = [];
    }
    const tracked = { tool, startedAt: at };
    s.tools.set(p.toolCallId, tracked);
    const parent = p.parentToolCallId ? s.tools.get(p.parentToolCallId)?.tool : undefined;
    if (parent) (parent.children ??= []).push(tool);
    else (s.open ?? this.openFrame(s, sessionId, cursor, at, "terminal")).activity.push(tool);
    return tracked;
  }
}
