/** Host-side provider adapter contract (PRD §22, §25). The Vite app must not import this directory. */
export type ProviderId = "pi" | "claude";

export interface SessionRef {
  provider: ProviderId;
  id: string;
  cwd?: string;
  title?: string;
  parentSessionId?: string;
}

export type AppEvent =
  | { type: "frame_started"; frameId: string; session: SessionRef; ingress: string; at: number }
  | { type: "turn_started"; frameId: string; turnIndex: number; at: number }
  | { type: "turn_finished"; frameId: string; turnIndex: number; at: number }
  | { type: "assistant_delta"; frameId: string; text: string; at: number }
  | { type: "assistant_message_finished"; frameId: string; message: unknown; at: number }
  | { type: "tool_started"; frameId: string; toolCallId: string; toolName: string; args?: unknown; at: number }
  | { type: "tool_updated"; frameId: string; toolCallId: string; update: unknown; at: number }
  | { type: "tool_finished"; frameId: string; toolCallId: string; toolName: string; result?: unknown; isError: boolean; at: number }
  | { type: "retry_started"; frameId: string; attempt: number; at: number }
  | { type: "retry_finished"; frameId: string; success: boolean; at: number }
  | { type: "compaction_started"; frameId: string; at: number }
  | { type: "compaction_finished"; frameId: string; at: number }
  | { type: "frame_settled"; frameId: string; at: number };

export interface ConversationNode {
  id: string;
  providerRef: string;
  parentId: string | null;
  kind: "message" | "branch" | "session";
  title?: string;
  children: ConversationNode[];
}

export interface AgentProviderAdapter {
  readonly provider: ProviderId;

  listSessions(cwd?: string): Promise<SessionRef[]>;
  createSession(cwd: string): Promise<SessionRef>;
  openSession(ref: SessionRef): Promise<void>;

  prompt(text: string): Promise<void>;
  steer?(text: string): Promise<void>;
  abort(): Promise<void>;

  subscribe(listener: (event: AppEvent) => void): () => void;

  getConversationGraph(): Promise<ConversationNode[]>;
  fork(fromProviderRef: string): Promise<SessionRef | void>;

  /** Provider-level semantic compaction. UI-only branch collapse does not call this. */
  compact?(instructions?: string): Promise<void>;

  dispose(): Promise<void> | void;
}
