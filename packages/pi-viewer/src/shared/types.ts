/** Wire types shared by the Vite middleware and the browser app. */

/**
 * `attention`: the agent waits for the operator (a question, a plan, a permission prompt).
 * `quiet`: a turn is open but nothing was written for 15 minutes.
 */
export type AgentStatus = "working" | "attention" | "quiet" | "waiting" | "idle" | "error" | "unknown"

export type AgentProvider = "pi" | "claude"

export interface ViewerAgent {
  /** Stable identity: the tmux pane id. */
  id: string
  paneId: string
  panePid: number
  /** Which agent runtime owns the pane; selects the transcript parser. */
  provider: AgentProvider
  /** Pid of the agent process (pi or claude, per `provider`). */
  piPid: number | null
  tmuxSession: string
  windowIndex: number
  /** Stable tmux window id (@N); survives renumbering. */
  windowId: string
  windowName: string
  paneIndex: number
  name: string
  /** Role assigned by the launcher (@agent_role), e.g. lead, worker, debugger. */
  role: string | null
  title: string
  cwd: string
  /** The repository the agent works in (the main checkout's name, so a worktree reports its repo); the cwd basename outside git. */
  repo?: string
  sessionFile: string | null
  sessionId: string | null
  sessionName: string | null
  model: string | null
  thinkingLevel: string | null
  modifiedAt: number
  /** Write time of the newest record that moves a turn, from the record itself (0 when none). */
  lastWriteAt: number
  eventCount: number
  status: AgentStatus
  statusNote: string | null
  /** The pending request behind `attention` (question, plan or permission prompt), read-only text. */
  statusDetail?: string | null
}

export interface ViewerSession {
  name: string
  /** Tmux server identity (pid + socket); reusing a window/pane id after a restart is not the same thread. */
  serverId: string
  agents: ViewerAgent[]
  capturedAt: number
}

export type EventKind =
  | "user"
  | "assistant"
  | "tool-result"
  | "bash"
  | "notice"
  | "compaction"
  | "intercom"
  | "meta"

/** What one transcript record does to its agent's turn; see src/lib/turn-state.ts. */
export type TurnEffect = "open" | "step" | "reply" | "abort" | "fail" | "compact" | "none"

export type IntercomDirection = "sent" | "received"

export interface IntercomMeta {
  direction: IntercomDirection
  /** Display name of the sender. */
  from: string
  /** Display name of the recipient. */
  to: string
  /** Raw sender address when it differs from the display name (socket, id). */
  fromId?: string
  /** Raw recipient address when it differs from the display name (socket, id). */
  toId?: string
  messageId?: string
  /** Tool call that produced this send, used to attach its delivery result. */
  toolCallId?: string
  expectsReply?: boolean
  summary?: string
  /** The complete message body. */
  body: string
  /** True when this card's body was shortened by the parser. */
  truncated?: boolean
  /** Server-computed body identity for the All-events paired marker. */
  pairKey?: string
  runtime?: "pi" | "claude"
  delivery?: string
  /** True when the send tool reported an error. */
  failed?: boolean
  /** Short error text from the failed delivery result. */
  error?: string
  legacy?: boolean
}

export interface ViewerPart {
  type: "text" | "thinking" | "tool-call" | "image"
  text?: string
  toolCallId?: string
  toolName?: string
  /** Compact, capped JSON of the tool arguments. */
  input?: string
  summary?: string
  truncated?: boolean
}

export interface ViewerEvent {
  id: string
  agentId: string
  agentName: string
  /** Monotonic index of the line in the session file. */
  seq: number
  at: number
  kind: EventKind
  role: string | null
  summary: string
  text?: string
  parts?: ViewerPart[]
  toolName?: string
  toolCallId?: string
  isError?: boolean
  input?: string
  output?: string
  detail?: string
  truncated?: boolean
  stopReason?: string
  /** Present when this event is a peer message, not a chat turn or tool step. */
  intercom?: IntercomMeta
  /**
   * Several peer messages issued by one assistant entry. The Channel expands each into
   * its own card; `intercom` stays unset for these so a single event is never counted twice.
   */
  intercoms?: IntercomMeta[]
  /** What this record does to its agent's turn (src/lib/turn-state.ts). The server sets it on every event. */
  effect?: TurnEffect
  /** A failed assistant message whose error is a context overflow: a compaction resumes its turn. */
  overflow?: boolean
  /** False for events that belong to an abandoned branch of the session tree. */
  onBranch: boolean
  /** Compact, capped JSON of the original line for inspection. */
  raw?: string
}

export interface ThreadMeta {
  session: string
  /** Tmux server identity, used to scope browser read-state keys. */
  serverId: string
  version: string
  agents: ViewerAgent[]
  capturedAt: number
}

export interface ThreadPayload extends ThreadMeta {
  /** Parsed events in chronological order (a page, or the events since a cursor). */
  events: ViewerEvent[]
  /** Monotonic cursor of the newest cached event. */
  cursor: number
  /** Identity of the server cache generation; a change means reload, not merge. */
  revision: string
  /** True when older turns exist before the first returned turn. */
  hasEarlier: boolean
  /** Cursor of the first returned event; use as `before` to load older turns. */
  earlier: number | null
  /** Number of turns skipped before the returned window. */
  earlierTurns: number
  /** Server cache changed; the client must replace its window. */
  reset?: boolean
  /** Incremental poll with no new events. */
  unchanged?: boolean
}

export interface SessionsPayload {
  sessions: ViewerSession[]
  capturedAt: number
  error?: string
}

export interface SendPayload {
  paneId: string
  text: string
}
