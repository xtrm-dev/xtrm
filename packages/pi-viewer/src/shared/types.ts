/** Wire types shared by the Vite middleware and the browser app. */

export type AgentStatus = "working" | "waiting" | "idle" | "error" | "unknown"

export interface ViewerAgent {
  /** Stable identity: the tmux pane id. */
  id: string
  paneId: string
  panePid: number
  piPid: number | null
  tmuxSession: string
  windowIndex: number
  windowName: string
  paneIndex: number
  name: string
  /** Role assigned by the launcher (@agent_role), e.g. lead, worker, debugger. */
  role: string | null
  title: string
  cwd: string
  sessionFile: string | null
  sessionId: string | null
  sessionName: string | null
  model: string | null
  thinkingLevel: string | null
  modifiedAt: number
  eventCount: number
  status: AgentStatus
  statusNote: string | null
}

export interface ViewerSession {
  name: string
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
  /** False for events that belong to an abandoned branch of the session tree. */
  onBranch: boolean
  /** Compact, capped JSON of the original line for inspection. */
  raw?: string
}

export interface ThreadMeta {
  session: string
  version: string
  agents: ViewerAgent[]
  capturedAt: number
}

export interface ThreadPayload extends ThreadMeta {
  /** All parsed events (including off-branch ones), chronological. */
  events: ViewerEvent[]
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
