/** Host-side Frame projection: provider AppEvents -> InteractionFrame. Runs in the agent host, never in the WebView bundle (PRD §35.5, §36.8). */
import type { AppEvent, ProviderId } from "./provider.ts";

export interface FrameToolCall {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  finishedAt?: number;
  args?: unknown;
  result?: unknown;
}

export interface InteractionFrame {
  id: string;
  provider: ProviderId;
  sessionId: string;
  ingress: string;
  startedAt: number;
  settledAt?: number;
  status: "running" | "settled" | "aborted" | "error";
  turnCount: number;
  retryCount: number;
  assistantText: string;
  toolCalls: FrameToolCall[];
}

export class FrameProjector {
  private readonly frames = new Map<string, InteractionFrame>();

  apply(event: AppEvent): InteractionFrame | undefined {
    if (event.type === "frame_started") {
      const frame: InteractionFrame = {
        id: event.frameId,
        provider: event.session.provider,
        sessionId: event.session.id,
        ingress: event.ingress,
        startedAt: event.at,
        status: "running",
        turnCount: 0,
        retryCount: 0,
        assistantText: "",
        toolCalls: [],
      };
      this.frames.set(frame.id, frame);
      return frame;
    }

    const frame = this.frames.get(event.frameId);
    if (!frame) return undefined;

    switch (event.type) {
      case "turn_started":
        frame.turnCount = Math.max(frame.turnCount, event.turnIndex + 1);
        break;
      case "assistant_delta":
        frame.assistantText += event.text;
        break;
      case "tool_started":
        frame.toolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          startedAt: event.at,
          args: event.args,
        });
        break;
      case "tool_finished": {
        const tool = frame.toolCalls.find((t) => t.id === event.toolCallId);
        if (tool) {
          tool.status = event.isError ? "error" : "complete";
          tool.finishedAt = event.at;
          tool.result = event.result;
        }
        break;
      }
      case "retry_started":
        frame.retryCount += 1;
        break;
      case "frame_settled":
        frame.status = "settled";
        frame.settledAt = event.at;
        break;
    }

    return frame;
  }

  get(id: string): InteractionFrame | undefined {
    return this.frames.get(id);
  }

  all(): InteractionFrame[] {
    return [...this.frames.values()];
  }
}
