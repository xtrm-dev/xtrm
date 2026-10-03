// `/message @session:<x> <text>` (PRD §10, §36.6 rule 4, §36.11 criterion 11): a reference attaches
// context only; `/message` is the command that delivers text to another session. v0 transport: the
// app submits the text to the target session through the agent host, as the operator, naming the
// sending session. It grants no workflow authority (§14) and opens no Frame in the sending session.
import type { AgentRef, AgentSessionSummary } from "../adapters/index.tsx";
import { parseRefTokens } from "./workspace.tsx";

export type MessageCommand = { target: AgentRef; text: string } | { error: string };

const COMMAND = /^\/message(?:\s|$)/;
const isTarget = (r: AgentRef) => r.kind === "session" || r.kind === "agent";

/** Parses a composer body; null when the body is not a `/message` command. */
export function parseMessageCommand(body: string, attached: AgentRef[]): MessageCommand | null {
  if (!COMMAND.test(body)) return null;
  const rest = body.replace(COMMAND, "");
  const typed = parseRefTokens(rest).find(isTarget);
  const target = typed ?? attached.find(isTarget);
  if (!target) return { error: "/message needs a target: /message @session:<name> <text>" };
  const text = (typed ? rest.replace(new RegExp(`@${typed.kind}:${typed.ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[.,;:!?)\\]]*`), "") : rest).replace(/[ \t]{2,}/g, " ").trim();
  if (!text) return { error: `/message to @${target.kind}:${target.ref} has no text` };
  return { target, text };
}

/** The live session a target names: by id, else by name; a live session wins over history. */
export function findTarget(sessions: AgentSessionSummary[], target: AgentRef): AgentSessionSummary | null {
  const hits = sessions.filter((s) => s.id === target.ref || s.name === target.ref);
  return hits.find((s) => s.state !== "history") ?? hits[0] ?? null;
}

/** The text the target receives. */
export const messageText = (from: string, text: string) => `Message from ${from} (sent with /message from xtrm-app): ${text}`;
