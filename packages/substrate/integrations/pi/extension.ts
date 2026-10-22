// Substrate Pi extension. Consumes the typed service directly — never execs
// sb and never parses terminal text. Pi owns the provider UI/session lifecycle;
// Substrate owns durable work authority and persistence.
//
// Verified API assumptions:
// - ExtensionAPI: pi.registerTool / pi.registerCommand / pi.on
// - session_before_compact can supply a custom summary
// - session_start has no start-time injection channel, so resume delivery is
//   notify + `substrate-resume`, never a silent context edit
// - ctx.sessionManager.getSessionId() supplies the provider session binding key

import { homedir } from "node:os";
import { join } from "node:path";
import { type Usage } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  defineTool,
  isToolCallEventType,
  serializeConversation,
  type AgentToolUpdateCallback,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
  decidePiEditCall,
  SessionBindings,
  openServices,
  piToolContext,
  resumeForSession,
  runBeforeCompact,
  toolHandles,
  toPiCompaction,
} from "./handlers.ts";
import { runTool } from "../tool-core.ts";
import { piToolName, TOOL_SPECS, type ToolName } from "../tool-surface.ts";
import { PI_PARAMETERS } from "./parameters.ts";
import type { SemanticCheckpoint } from "../../src/domain/journal.ts";
import { registerAdvisor } from "./advisor.ts";
function dbPath(): string {
  return process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }>; details: { ok: boolean } } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: { ok: true } };
}

export default function (pi: ExtensionAPI): void {
  const bindings = new SessionBindings();
  // XTRM-673: same advisories as the Claude plugin (identity, claims, nudges).
  registerAdvisor(pi, { dbPath });

  const withServices = <T>(fn: (svc: ReturnType<typeof openServices>) => T | Promise<T>): Promise<T> => {
    const svc = openServices(dbPath());
    try {
      return Promise.resolve(fn(svc)).finally(() => svc.close());
    } catch (err) {
      svc.close();
      throw err;
    }
  };

  const tools = TOOL_SPECS.map((spec) =>
    defineTool({
      name: piToolName(spec.name),
      label: `Substrate ${spec.name.replace("_", " ")}`,
      description: spec.description,
      parameters: PI_PARAMETERS[spec.name],
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<{ ok: boolean }> | undefined,
        ctx: ExtensionContext,
      ) {
        const context = piToolContext(bindings, { sessionId: ctx?.sessionManager?.getSessionId?.(), cwd: ctx?.cwd });
        const result = await withServices((svc) => runTool(spec.name, params, toolHandles(svc), context));
        return textResult(result);
      },
    }),
  );
  for (const t of tools) pi.registerTool(t);

  // A session bound to an Issue may mutate only under its own live claim
  // (holder + activation). Fail-open on unreadable state so a corrupt gate
  // never bricks Pi.
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;
    try {
      const sessionId = ctx?.sessionManager?.getSessionId?.();
      const decision = await withServices((svc) => decidePiEditCall(svc, bindings, { sessionId: sessionId ?? undefined, workspace: ctx?.cwd }));
      if (!decision.allow) return { block: true, reason: decision.reason ?? "no live claim" };
    } catch {
      return;
    }
  });

  pi.registerCommand("substrate-resume", {
    description: "Print the Substrate resume capsule for the session-bound issue",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const sessionId = ctx?.sessionManager?.getSessionId?.();
      const capsule = await withServices((svc) => resumeForSession(svc, bindings, sessionId));
      ctx.ui.notify(
        capsule ?? "No Substrate issue bound to this session (claim one, or set SUBSTRATE_ISSUE_REF; SUBSTRATE_ISSUE is the legacy alias).",
        capsule ? "info" : "warning",
      );
    },
  });

  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    if (event.reason !== "resume" && event.reason !== "new" && event.reason !== "fork") return;
    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? event.previousSessionFile;
    const capsule = await withServices((svc) => resumeForSession(svc, bindings, sessionId)).catch(() => null);
    if (capsule) ctx.ui.notify(`Substrate resume available — run /substrate-resume for the full capsule.\n${capsule.split("\n").slice(0, 6).join("\n")}`, "info");
  });

  pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => {
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    const ref = bindings.boundRef(sessionId);
    if (!ref) return;
    const conversationText = serializeConversation(
      convertToLlm([...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages]),
    );
    const model = ctx.modelRegistry?.find?.("google", "gemini-2.5-flash") ?? ctx.model;
    const summarizer = model
      ? async (): Promise<SemanticCheckpoint & { usage?: Usage }> => {
          const response = await ctx.modelRegistry.complete(
            model,
            {
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: `Summarize this conversation for a Substrate work-journal checkpoint. Reply with a single JSON object and nothing else, using exactly these keys: summary (string, required), completed (string[]), current (string), next (string[]), blocked (string[]), openQuestions (string[]), keyDecisions (string[]), materialFindings (string[]).\n\n<conversation>\n${conversationText.slice(0, 12000)}\n</conversation>`,
                    },
                  ],
                  timestamp: Date.now(),
                },
              ],
            },
            { maxTokens: 2048, signal: event.signal },
          );
          const text = response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          const start = text.indexOf("{");
          const end = text.lastIndexOf("}");
          if (start < 0 || end <= start) throw new Error("secondary model returned no JSON object");
          const checkpoint = JSON.parse(text.slice(start, end + 1)) as SemanticCheckpoint;
          return response.usage ? { ...checkpoint, usage: response.usage } : checkpoint;
        }
      : undefined;
    const result = await withServices((svc) => runBeforeCompact(svc, { issueRef: ref, sessionId, summarizer })).catch(() => null);
    if (!result) return;
    return toPiCompaction(event.preparation, result);
  });
}
