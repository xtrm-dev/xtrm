// Agent host wire types, mirrored by hand from @xtrm/contracts (xtrm-dev/core
// packages/contracts/schemas, origin/main 53e9a8c6, release v0.14.0):
//   xtrm.agent-event.v1     — event frames pushed by the Pi extension / Claude hooks
//   xtrm.agent-host-api.v1  — session_list, session_detail, event (SSE data line), submit_request,
//                             submit_result, error
//   xtrm.agent-command.v1   — the command inside submit_request (prompt, steer, follow_up, abort,
//                             extension_ui_response); mirrored from core origin/main 82fd5c42, unchanged
//                             since v0.14.0 (XTRM-597)
// Only the fields this app reads are typed; the JSON Schemas stay the source of truth.
// A new major (v2) is a different contract: the live adapter rejects it, never guesses.

export const EVENT_SCHEMA = "xtrm.agent-event.v1";
export const HOST_API_SCHEMA = "xtrm.agent-host-api.v1";
export const COMMAND_SCHEMA = "xtrm.agent-command.v1";

export type HostCapability = "presence" | "stream" | "prompt" | "steer" | "follow_up" | "abort" | "extension_ui";

export interface HostWorkItem {
  ref: string;
  project?: string;
  system?: "substrate" | "beads";
}

export interface HostTmux {
  session: string;
  paneId: string;
}

/** xtrm.agent-host-api.v1 `sessionSummary`. */
export interface HostSessionSummary {
  sessionId: string;
  provider: "pi" | "claude" | "codex";
  state: "working" | "waiting_for_input" | "settled" | "failed" | "history_only";
  name?: string;
  cwd: string;
  repository?: string;
  worktree?: string;
  branch?: string;
  role?: string;
  workItem?: HostWorkItem;
  parentSessionId?: string;
  childCount?: number;
  tmux?: HostTmux;
  launch?: "gui" | "terminal";
  extensionConnected: boolean;
  capabilities: HostCapability[];
  model?: string;
  thinkingLevel?: string;
  contextUsage?: { tokens: number; contextWindow: number };
  frameCount?: number;
  startedAt?: number;
  lastActivityAt?: number;
  sessionFile?: string;
}

export interface HostSessionList {
  schema: typeof HOST_API_SCHEMA;
  kind: "session_list";
  sessions: HostSessionSummary[];
  nextCursor?: string;
}

export interface HostSessionDetail {
  schema: typeof HOST_API_SCHEMA;
  kind: "session_detail";
  session: HostSessionSummary;
  lastSeq?: number;
}

/** PRD §36.7 origin, set by the host from the tool's registration record. */
export interface HostToolOrigin {
  class: "native" | "mcp" | "extension" | "coordination";
  server?: string;
  transport?: string;
  extension?: string;
  version?: string;
}

/** Pi AgentMessage, passed through opaque; only the fields read here. */
export interface HostAgentMessage {
  role: string;
  content?: unknown;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } };
}

interface ToolEventBase {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  parentToolCallId?: string;
  /** Raw registration record; `sourceInfo.path` is `builtin:<name>` for Pi built-ins. */
  tool?: { sourceInfo?: { path?: string; source?: string }; namespace?: { name?: string } };
  origin?: HostToolOrigin;
}

export type HostEventPayload =
  | { type: "session_identity"; capabilities: HostCapability[] }
  | { type: "before_agent_start"; prompt: string; ingress: { origin: "gui" | "terminal"; commandId?: string } }
  | { type: "agent_start" }
  | { type: "message_start" | "message_update" | "message_end"; message: HostAgentMessage }
  | ({ type: "tool_execution_start" } & ToolEventBase)
  | ({ type: "tool_execution_update"; partialResult: unknown } & ToolEventBase)
  | ({ type: "tool_execution_end"; result: unknown; isError: boolean } & ToolEventBase)
  | { type: "agent_end"; messages: HostAgentMessage[] }
  | { type: "agent_settled" }
  | { type: "session_compact"; reason: string }
  | { type: "session_compact_failed"; reason: string; errorMessage?: string }
  | { type: "extension_ui_request"; id: string; method: "select" | "confirm" | "input" | "editor"; title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string; timeout?: number }
  | { type: "extension_ui_resolved"; id: string; resolvedBy: "local" | "host"; outcome: "answered" | "cancelled" }
  | { type: "notification"; kind: string; title?: string; message?: string }
  | { type: "session_shutdown"; reason: string }
  // Remaining v1 payloads (session_start, turn_*, command_result, subagent_end) carry nothing the read path projects.
  | { type: "session_start" | "turn_start" | "turn_end" | "command_result" | "subagent_end" };

/** xtrm.agent-event.v1 frame. */
export interface HostEventFrame {
  schema: typeof EVENT_SCHEMA;
  seq: number;
  sessionId: string;
  at: number;
  payload: HostEventPayload;
}

/** xtrm.agent-host-api.v1 `event`: one SSE `data:` line. */
export interface HostEventMessage {
  schema: typeof HOST_API_SCHEMA;
  kind: "event";
  cursor: string;
  frame: HostEventFrame;
}

/** xtrm.agent-command.v1 `command`. Images are part of the schema but not sent by this app yet. */
export type HostCommand =
  | { type: "prompt" | "steer" | "follow_up"; commandId: string; message: string }
  | { type: "abort"; commandId: string }
  | ({ type: "extension_ui_response"; commandId: string; id: string } & ({ value: string } | { confirmed: boolean } | { cancelled: true }));

/** xtrm.agent-host-api.v1 `submit_request`; `references` stay with the @ reference issue. */
export interface HostSubmitRequest {
  schema: typeof HOST_API_SCHEMA;
  kind: "submit_request";
  sessionId: string;
  command: HostCommand;
}

/** xtrm.agent-host-api.v1 `submit_result`. `busy`: a normal prompt while the session works (§35.8 item 5). */
export interface HostSubmitResult {
  schema: typeof HOST_API_SCHEMA;
  kind: "submit_result";
  commandId: string;
  status: "accepted" | "busy" | "rejected" | "not_found" | "unsupported" | "failed";
  reason?: string;
  message?: string;
}
