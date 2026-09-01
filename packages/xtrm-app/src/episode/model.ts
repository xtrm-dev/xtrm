import type { AppEvent, ProviderId } from "../runtime/provider";

export interface EpisodeToolCall {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  finishedAt?: number;
  args?: unknown;
  result?: unknown;
}

export interface Episode {
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
  toolCalls: EpisodeToolCall[];
}

export class EpisodeProjector {
  private readonly episodes = new Map<string, Episode>();

  apply(event: AppEvent): Episode | undefined {
    if (event.type === "episode_started") {
      const episode: Episode = {
        id: event.episodeId,
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
      this.episodes.set(episode.id, episode);
      return episode;
    }

    const episode = this.episodes.get(event.episodeId);
    if (!episode) return undefined;

    switch (event.type) {
      case "turn_started":
        episode.turnCount = Math.max(episode.turnCount, event.turnIndex + 1);
        break;
      case "assistant_delta":
        episode.assistantText += event.text;
        break;
      case "tool_started":
        episode.toolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          startedAt: event.at,
          args: event.args,
        });
        break;
      case "tool_finished": {
        const tool = episode.toolCalls.find((t) => t.id === event.toolCallId);
        if (tool) {
          tool.status = event.isError ? "error" : "complete";
          tool.finishedAt = event.at;
          tool.result = event.result;
        }
        break;
      }
      case "retry_started":
        episode.retryCount += 1;
        break;
      case "episode_settled":
        episode.status = "settled";
        episode.settledAt = event.at;
        break;
    }

    return episode;
  }

  get(id: string): Episode | undefined {
    return this.episodes.get(id);
  }

  all(): Episode[] {
    return [...this.episodes.values()];
  }
}
