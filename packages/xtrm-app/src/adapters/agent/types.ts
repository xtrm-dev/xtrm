// Agent half view models (PRD §36). Two adapters fill them: the typed fixture, and the live
// adapter (live.ts) that projects xtrm.agent-host-api.v1 / xtrm.agent-event.v1 (XTRM-572).
import type { DataSource } from "../types.ts";

export type SessionState = "working" | "waiting" | "settled" | "failed" | "history";
export type SessionCapability = "prompt" | "steer" | "presence";

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
  /** `owner/name` of the repository the cwd belongs to; null when outside every known repository. */
  repo: string | null;
  model: string | null;
  thinking: string | null;
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
  worktree: string | null;
  branch: string | null;
  /** `session:pane` of the hosting tmux pane. */
  tmux: string | null;
  tokens: { input: number; output: number } | null;
  costUsd: number | null;
  frames: InteractionFrame[];
}

export type RefKind = "issue" | "gh-issue" | "pr" | "commit" | "file" | "session";

/** Typed composer reference (PRD §36.6); serialized as `@kind:ref`. */
export interface AgentRef {
  kind: RefKind;
  ref: string;
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
  type: "confirm" | "select";
  prompt: string;
  options: string[];
  answer: string | null;
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

export type Activity = ToolActivity | CoordinationActivity | NoteActivity;

export interface SubmitInput {
  text: string;
  refs: AgentRef[];
  mode: "prompt" | "steer" | "follow-up";
}

export interface AgentAdapter {
  readonly source: DataSource;
  listSessions(): Promise<AgentSessionSummary[]>;
  getSession(id: string): Promise<AgentSessionDetail | null>;
  /** Rejects with `busy` for a normal prompt while the session is working (PRD §35.8). */
  submit(sessionId: string, input: SubmitInput): Promise<void>;
  respond(sessionId: string, activityId: string, answer: string): Promise<void>;
  /** Host-resolved kinds only: commit, file, session (PRD §36.6). */
  searchReferences(query: string, kind: "commit" | "file" | "session", repo: string): Promise<RefCandidate[]>;
  resolveReference(ref: AgentRef): Promise<RefCandidate | null>;
  /** Pushed change notifications; the argument is the changed session id. */
  subscribe(listener: (sessionId: string) => void): () => void;
}

/** Contract error: a normal prompt reached a working session (PRD §35.8 submit policy). */
export class BusyError extends Error {
  constructor() {
    super("busy");
    this.name = "BusyError";
  }
}
