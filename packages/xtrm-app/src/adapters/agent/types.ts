// Agent half view models (PRD §36). Two adapters fill them: the typed fixture, and the live
// adapter (live.ts) that projects xtrm.agent-host-api.v1 / xtrm.agent-event.v1 (XTRM-572).
import type { DataSource } from "../types.ts";

export type SessionState = "working" | "waiting" | "settled" | "failed" | "history";
export type SessionCapability = "prompt" | "steer" | "abort" | "presence";

export interface AgentSessionSummary {
  id: string;
  name: string;
  /** First Frame title when the session has no explicit name. */
  title: string;
  provider: "pi" | "claude" | "codex";
  state: SessionState;
  role: string | null;
  /** Bound Substrate Issue ref (`--bead`). */
  workRef: string | null;
  /** `owner/name` of the repository the cwd belongs to (host `repository`); null without a remote. */
  repo: string | null;
  /** `<provider>/<model id>` from the host's session_status. */
  model: string | null;
  thinking: string | null;
  /** Estimated context tokens of the active model; null while unknown (no meter). */
  context: { used: number; window: number } | null;
  startedAt: number;
  lastActivityAt: number;
  parentId: string | null;
  childCount: number;
  frameCount: number;
  capabilities: SessionCapability[];
  origin: "gui" | "terminal";
}

export interface AgentSessionDetail extends AgentSessionSummary {
  cwd: string;
  /** Root of the main repository on the agent host; null when the host does not report it. */
  repositoryPath: string | null;
  worktree: string | null;
  branch: string | null;
  /** `session:pane` of the hosting tmux pane. */
  tmux: string | null;
  tokens: { input: number; output: number } | null;
  costUsd: number | null;
  frames: InteractionFrame[];
}

export type RefKind = "issue" | "epic" | "gh-issue" | "pr" | "commit" | "file" | "session" | "agent" | "frame";
/** Kinds the agent host resolves against the session (POST /v1/references/resolve). */
export type HostRefKind = "commit" | "file" | "session" | "agent" | "frame";
export const HOST_REF_KINDS: readonly HostRefKind[] = ["commit", "file", "session", "agent", "frame"];

/** Typed composer reference (PRD §36.6); serialized as `@kind:ref`. */
export interface AgentRef {
  kind: RefKind;
  ref: string;
  /** Revision recorded at submit (§36.6 rule 2); set on references a Frame was given. */
  revision?: string;
  /** Above its budget: the agent got an excerpt and this pointer (§36.12 item 2). */
  pointer?: string;
}

/**
 * A resolved typed reference: the app view of xtrm.agent-host-api.v1 `contextReference`.
 * Content above the kind's budget is an excerpt (`truncated`) plus a `pointer`.
 */
export interface ContextReference {
  kind: RefKind;
  /** `@kind:ref` as submitted. */
  raw: string;
  status: "resolved" | "unresolved";
  title?: string;
  revision?: string;
  content?: string;
  truncated?: boolean;
  pointer?: string;
  /** UTF-8 bytes of `content`. */
  bytes?: number;
  budgetBytes?: number;
  /** Reason code of an unresolved reference (`path_outside_cwd`, `issue_not_found`, …). */
  error?: string;
}

export interface RefCandidate extends AgentRef {
  title: string;
  detail?: string;
  /** Short bounded preview for drawer inspection (file excerpt, commit stat). */
  preview?: string;
}

export interface InteractionFrame {
  id: string;
  index: number;
  title: string;
  status: "working" | "settled" | "failed" | "aborted";
  ingress: { text: string; origin: "gui" | "terminal"; refs: AgentRef[]; at: number };
  activity: Activity[];
  response: string | null;
  startedAt: number;
  settledAt: number | null;
}

export type ToolClass = "native" | "mcp" | "extension" | "coordination";

export interface ExtensionUiRequest {
  type: "confirm" | "select" | "input";
  prompt: string;
  /** Body text of a confirm (Pi `ctx.ui.confirm(title, message)`). */
  detail?: string;
  /** Choices; for confirm the first option means yes. Empty for input. */
  options: string[];
  /** The answer given from this app, when known. */
  answer: string | null;
  /** How the request ended (extension_ui_resolved); absent while it is open. */
  resolved?: { by: "local" | "host"; outcome: "answered" | "cancelled" };
}

export interface ToolActivity {
  kind: "tool";
  id: string;
  class: ToolClass;
  /** Tool name as registered (`read`, `search_code`, `guardrails_check`). */
  name: string;
  /** Primary subject: path, command, query. */
  subject: string;
  status: "running" | "done" | "error";
  durationMs: number | null;
  origin: { server?: string; transport?: string; extension?: string; version?: string };
  args?: Record<string, unknown>;
  output?: string;
  /** Extension UI request awaiting (or answered by) the operator (PRD §20, §36.7). */
  ui?: ExtensionUiRequest;
  /** Calls this tool made through `ctx.executeTool()` (`parentToolCallId`), in start order (PRD §36.7). */
  children?: ToolActivity[];
  /** The built-in codemode tool: rendered as a script block with this source (PRD §36.7). */
  script?: string;
}

export interface CoordinationActivity {
  kind: "coordination";
  id: string;
  action: "message" | "reply" | "dispatch" | "review";
  /** Peer session id. */
  peer: string;
  summary: string;
  workRef?: string;
  status: "running" | "done" | "waiting";
  progress?: { done: number; total: number };
  /** Transport provenance shown on expand (PRD §14). */
  transport: string;
}

export interface NoteActivity {
  kind: "retry" | "compaction" | "steer";
  id: string;
  text: string;
}

/** An extension UI request that is not attached to a tool call (live host: `extension_ui_request`). */
export interface PromptActivity {
  kind: "prompt";
  /** The request id; `respond` answers it. */
  id: string;
  ui: ExtensionUiRequest;
}

export type Activity = ToolActivity | CoordinationActivity | NoteActivity | PromptActivity;

export interface SubmitInput {
  text: string;
  refs: AgentRef[];
  /** `refs` resolved at submit, every one `resolved` and within the total budget. */
  references: ContextReference[];
  mode: "prompt" | "steer" | "follow-up";
}

/** New session (PRD §35.4, §36.3 footer): a working directory on the agent host and a launch profile. */
export interface LaunchInput {
  cwd: string;
  command: "pi" | "xt pi";
  name?: string;
  model?: string;
  /** `xt pi` only. */
  role?: string;
  /** `xt pi` only: the bound work item. */
  bead?: string;
}

/** The tmux session the host started; the agent session joins the registry once its extension connects. */
export interface LaunchResult {
  tmuxSession: string;
}

/**
 * The live event stream (XTRM-613): `connecting` until the first connect, `connected` while events
 * flow, `disconnected` while it is down and being re-established. Frames and session states are
 * unknown while disconnected; a reconnect resynchronizes them from the host.
 */
export type StreamState = "connecting" | "connected" | "disconnected";

export interface AgentAdapter {
  readonly source: DataSource;
  listSessions(): Promise<AgentSessionSummary[]>;
  getSession(id: string): Promise<AgentSessionDetail | null>;
  /** Rejects with `busy` for a normal prompt while the session is working (PRD §35.8). */
  submit(sessionId: string, input: SubmitInput): Promise<void>;
  /** Stops the running Frame (PRD §35.3 abort). */
  abort(sessionId: string): Promise<void>;
  /** Starts an agent in tmux on the host; rejects with the host's summary when it does not start. */
  launch(input: LaunchInput): Promise<LaunchResult>;
  /** Answers an extension UI request; `null` cancels it. */
  respond(sessionId: string, activityId: string, answer: string | null): Promise<void>;
  /** Picker candidates for host-resolved kinds (PRD §36.6); `sessionId` is the composer's session. */
  searchReferences(query: string, kind: "commit" | "file" | "session", repo: string, sessionId?: string): Promise<RefCandidate[]>;
  /** Bounded preview of one host-resolved reference for the drawer; null when it does not resolve. */
  resolveReference(ref: AgentRef, sessionId?: string): Promise<RefCandidate | null>;
  /** Resolves host kinds against the session, with revision and budget, in request order (PRD §36.6). */
  resolveReferences(sessionId: string, refs: AgentRef[]): Promise<ContextReference[]>;
  /** Pushed change notifications; the argument is the changed session id. */
  subscribe(listener: (sessionId: string) => void): () => void;
  /** Current live stream state; a fixture is always connected. */
  streamState(): StreamState;
  /** Called on every stream state change. */
  subscribeStream(listener: () => void): () => void;
}

/** Contract error: a normal prompt reached a working session (PRD §35.8 submit policy). */
export class BusyError extends Error {
  constructor() {
    super("busy");
    this.name = "BusyError";
  }
}
