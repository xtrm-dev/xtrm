// Claude Code mapping for the host-neutral advisor (XTRM-672): turns its
// {systemMessage, additionalContext, block} into hook JSON per event. The
// plugin entry scripts resolve this module by name, so it re-exports the core.

export * from "../advisor.ts";
import type { AdvisorOutput } from "../advisor.ts";

/** Merges the stop gate's continuity notice with the Stop advisor output into one hook JSON. */
export function combineStopOutputs(gate: Record<string, unknown> | null, advisor: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!gate) return advisor;
  if (!advisor) return gate;
  const messages = [gate["systemMessage"], advisor["systemMessage"]].filter((m): m is string => typeof m === "string" && m !== "");
  return { ...advisor, ...(messages.length > 0 ? { systemMessage: messages.join("\n") } : {}) };
}

/** Hook JSON for one event; Stop never gets additionalContext (it would force continuation). */
export function advisorHookOutput(event: "SessionStart" | "PostToolUse" | "Stop", out: AdvisorOutput | null): Record<string, unknown> | null {
  if (!out) return null;
  if (event === "Stop") {
    if (out.block) return { decision: "block", reason: out.block, systemMessage: out.systemMessage };
    return out.systemMessage ? { systemMessage: out.systemMessage } : null;
  }
  const json: Record<string, unknown> = {};
  if (out.additionalContext) json["hookSpecificOutput"] = { hookEventName: event, additionalContext: out.additionalContext };
  if (out.systemMessage) json["systemMessage"] = out.systemMessage;
  return Object.keys(json).length > 0 ? json : null;
}
