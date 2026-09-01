export type ProviderId = "pi" | "claude";

export interface SessionRef {
  provider: ProviderId;
  id: string;
  cwd?: string;
  title?: string;
  parentSessionId?: string;
}

export type AppEvent =
  | { type: "episode_started"; episodeId: string; session: SessionRef; ingress: string; at: number }
  | { type: "turn_started"; episodeId: string; turnIndex: number; at: number }
  | { type: "turn_finished"; episodeId: string; turnIndex: number; at: number }
  | { type: "assistant_delta"; episodeId: string; text: string; at: number }
  | { type: "assistant_message_finished"; episodeId: string; message: unknown; at: number }
  | { type: "tool_started"; episodeId: string; toolCallId: string; toolName: string; args?: unknown; at: number }
  | { type: "tool_updated"; episodeId: string; toolCallId: string; update: unknown; at: number }
  | { type: "tool_finished"; episodeId: string; toolCallId: string; toolName: string; result?: unknown; isError: boolean; at: number }
  | { type: "retry_started"; episodeId: string; attempt: number; at: number }
  | { type: "retry_finished"; episodeId: string; success: boolean; at: number }
  | { type: "compaction_started"; episodeId: string; at: number }
  | { type: "compaction_finished"; episodeId: string; at: number }
  | { type: "episode_settled"; episodeId: string; at: number };

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
