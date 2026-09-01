/**
 * Pi adapter sketch.
 *
 * Key contract:
 * - one idle user submit starts one app Episode;
 * - raw Pi turn_start/turn_end are internal activity within that Episode;
 * - agent_end does NOT close the Episode because AgentSession may auto-retry;
 * - agent_settled closes the Episode.
 *
 * Local workers must reconcile exact imports/types against the installed
 * @earendil-works/pi-coding-agent version before implementation.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentProviderAdapter,
  AppEvent,
  ConversationNode,
  SessionRef,
} from "../provider";

export class PiAdapter implements AgentProviderAdapter {
  readonly provider = "pi" as const;

  private currentSession?: any;
  private currentRuntime?: any;
  private currentEpisodeId?: string;
  private currentTurnIndex = -1;
  private listeners = new Set<(event: AppEvent) => void>();
  private unsubscribePi?: () => void;

  async listSessions(_cwd?: string): Promise<SessionRef[]> {
    throw new Error("Implement with SessionManager.list(cwd)");
  }

  async createSession(_cwd: string): Promise<SessionRef> {
    throw new Error("Implement using createAgentSessionRuntime + SessionManager.create(cwd)");
  }

  async openSession(_ref: SessionRef): Promise<void> {
    throw new Error("Implement with AgentSessionRuntime session replacement/open");
  }

  async prompt(text: string): Promise<void> {
    if (!this.currentSession) throw new Error("No active Pi session");
    if (this.currentSession.isStreaming) {
      throw new Error("Normal episode submit requires an idle session; use steer explicitly while running");
    }

    const episodeId = randomUUID();
    this.currentEpisodeId = episodeId;
    this.currentTurnIndex = -1;
    this.emit({
      type: "episode_started",
      episodeId,
      session: {
        provider: "pi",
        id: this.currentSession.sessionId,
        cwd: this.currentSession.cwd,
      },
      ingress: text,
      at: Date.now(),
    });

    await this.currentSession.prompt(text);
  }

  async steer(text: string): Promise<void> {
    if (!this.currentSession) throw new Error("No active Pi session");
    await this.currentSession.steer(text);
  }

  async abort(): Promise<void> {
    if (!this.currentSession) return;
    await this.currentSession.abort();
  }

  subscribe(listener: (event: AppEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getConversationGraph(): Promise<ConversationNode[]> {
    if (!this.currentSession) return [];
    // Pi already exposes SessionManager.getTree(). Project its id/parentId graph
    // rather than inventing a second provider transcript graph.
    const tree = this.currentSession.sessionManager.getTree();
    return projectPiTree(tree);
  }

  async fork(fromProviderRef: string): Promise<SessionRef | void> {
    if (!this.currentRuntime) throw new Error("No Pi runtime");
    // Choose intentionally between:
    // - AgentSession.navigateTree(): branch inside current session tree;
    // - AgentSessionRuntime.fork(): fork into a new session file.
    const result = await this.currentRuntime.fork(fromProviderRef);
    if (result?.cancelled) return;
    this.attachSession(this.currentRuntime.session);
    return {
      provider: "pi",
      id: this.currentRuntime.session.sessionId,
      cwd: this.currentRuntime.session.cwd,
    };
  }

  async compact(instructions?: string): Promise<void> {
    if (!this.currentSession) throw new Error("No active Pi session");
    await this.currentSession.compact(instructions);
  }

  dispose(): void {
    this.unsubscribePi?.();
    this.currentSession?.dispose?.();
  }

  private attachSession(session: any): void {
    this.unsubscribePi?.();
    this.currentSession = session;

    this.unsubscribePi = session.subscribe((event: any) => {
      const episodeId = this.currentEpisodeId;
      if (!episodeId) return;
      const at = Date.now();

      switch (event.type) {
        case "turn_start":
          this.currentTurnIndex += 1;
          this.emit({ type: "turn_started", episodeId, turnIndex: this.currentTurnIndex, at });
          break;

        case "turn_end":
          this.emit({ type: "turn_finished", episodeId, turnIndex: this.currentTurnIndex, at });
          this.emit({ type: "assistant_message_finished", episodeId, message: event.message, at });
          break;

        case "message_update":
          if (event.assistantMessageEvent?.type === "text_delta") {
            this.emit({ type: "assistant_delta", episodeId, text: event.assistantMessageEvent.delta, at });
          }
          break;

        case "tool_execution_start":
          this.emit({
            type: "tool_started",
            episodeId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            at,
          });
          break;

        case "tool_execution_update":
          this.emit({
            type: "tool_updated",
            episodeId,
            toolCallId: event.toolCallId,
            update: event.partialResult,
            at,
          });
          break;

        case "tool_execution_end":
          this.emit({
            type: "tool_finished",
            episodeId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
            isError: event.isError,
            at,
          });
          break;

        case "auto_retry_start":
          this.emit({ type: "retry_started", episodeId, attempt: event.attempt, at });
          break;

        case "auto_retry_end":
          this.emit({ type: "retry_finished", episodeId, success: event.success, at });
          break;

        case "compaction_start":
          this.emit({ type: "compaction_started", episodeId, at });
          break;

        case "compaction_end":
          this.emit({ type: "compaction_finished", episodeId, at });
          break;

        case "agent_end":
          // Deliberately no close here. event.willRetry may be true.
          break;

        case "agent_settled":
          this.emit({ type: "episode_settled", episodeId, at });
          this.currentEpisodeId = undefined;
          break;
      }
    });
  }

  private emit(event: AppEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function projectPiTree(nodes: any[]): ConversationNode[] {
  return nodes.map((node) => ({
    id: node.entry.id,
    providerRef: node.entry.id,
    parentId: node.entry.parentId ?? null,
    kind: "message",
    title: node.label,
    children: projectPiTree(node.children ?? []),
  }));
}
