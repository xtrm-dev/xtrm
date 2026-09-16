// Substrate Pi extension (Phase 6, bead xtrm-7wc.7). Consumes the typed
// service directly — never execs sb, never parses terminal text (§6.1).
//
// Verified against installed Pi 0.84.x at build time (PRD-54 recheck):
// - ExtensionAPI: pi.registerTool / pi.registerCommand / pi.on
//   (docs/extensions.md "Quick Start"; examples/extensions/hello.ts)
// - pi.on("session_before_compact") event {preparation, branchEntries,
//   reason, willRetry, signal}, result {cancel} | {compaction: {summary,
//   firstKeptEntryId, tokensBefore, usage?}} (docs/compaction.md
//   "session_before_compact"; dist/core/extensions/types.d.ts
//   SessionBeforeCompactEvent / SessionBeforeCompactResult)
// - pi.on("session_start") {reason, previousSessionFile?} with a void
//   result: Pi 0.84 exposes NO session-start injection channel, so resume
//   delivery is notify + `substrate-resume` command, documented as such.
// - ctx.sessionManager.getSessionId() supplies the session binding key.
// - ctx.modelRegistry.find(provider, id) resolves the secondary model for
//   the semantic checkpoint (custom-compaction.ts precedent).

import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
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
  resumeForSession,
  runBeforeCompact,
  toolIssueClaim,
  toolIssueGet,
  toolIssueResume,
  toolIssueSearch,
  toolIssueUpdate,
  toolJournalAppend,
  toolJournalCheckpoint,
  toolProvenanceTrace,
} from "./handlers.ts";
import type { SemanticCheckpoint } from "../../src/domain/journal.ts";
import {
  noopFeedback,
  successFeedback,
  warningFeedback,
  withFeedback,
  type OperationFeedback,
} from "../../src/presentation/operation-feedback.ts";

function dbPath(): string {
  return process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db");
}

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }>; details: { ok: boolean } } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: { ok: true } };
}

function feedbackResult(data: Record<string, unknown>, feedback: OperationFeedback) {
  return textResult(withFeedback(data, feedback));
}

export default function (pi: ExtensionAPI): void {
  const bindings = new SessionBindings();

  const withServices = <T>(fn: (svc: ReturnType<typeof openServices>) => T | Promise<T>): Promise<T> => {
    const svc = openServices(dbPath());
    try {
      return Promise.resolve(fn(svc)).finally(() => svc.close());
    } catch (err) {
      svc.close();
      throw err;
    }
  };

  const tools = [
    defineTool({
      name: "substrate_issue_get",
      label: "Substrate issue get",
      description: "Get a Substrate issue with contract, readiness, claim, and attestation. Ref accepts machine ID, durable reference, locator, historical locator, or alias.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        return textResult(await withServices((svc) => toolIssueGet(svc, { ref: params.ref as string })));
      },
    }),
    defineTool({
      name: "substrate_issue_search",
      label: "Substrate issue search",
      description: "Search Substrate issues within a project by title/reference substring, optionally filtered by kind.",
      parameters: Type.Object({ project: Type.String({ description: "Project id" }), query: Type.Optional(Type.String({ description: "Substring match" })), kind: Type.Optional(Type.String({ description: "Issue kind" })) }),
      async execute(_id: string, params: Record<string, unknown>) {
        return textResult(
          await withServices((svc) =>
            toolIssueSearch(svc, { project: params.project as string, query: params.query as string | undefined, kind: params.kind as string | undefined }),
          ),
        );
      },
    }),
    defineTool({
      name: "substrate_issue_claim",
      label: "Substrate issue claim",
      description: "Claim a dispatchable Substrate issue for a holder. Binds the Pi session to the issue for checkpoints and resume. Successful mutation results include a structured feedback confirmation.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }), holder: Type.String({ description: "Claim holder" }), activationId: Type.Optional(Type.String({ description: "Activation id" })), sessionId: Type.Optional(Type.String({ description: "Pi session id" })) }),
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<{ ok: boolean }> | undefined,
        ctx: ExtensionContext,
      ) {
        const sessionId = (params.sessionId as string | undefined) ?? ctx?.sessionManager?.getSessionId?.();
        const result = await withServices((svc) => toolIssueClaim(svc, bindings, { ref: params.ref as string, holder: params.holder as string, activationId: params.activationId as string | undefined, sessionId }));
        return feedbackResult(result, successFeedback("issue_claimed", `Claimed ${params.ref as string}`, `holder ${params.holder as string}`));
      },
    }),
    defineTool({
      name: "substrate_issue_update",
      label: "Substrate issue update",
      description: "Revise a Substrate issue contract (revision-on-change; identical contracts are a no-op). Results include structured success/no-op feedback so agents can distinguish a persisted revision from an idempotent repeat.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }), contract: Type.Unknown({ description: "Seven-field work contract" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await withServices((svc) => toolIssueUpdate(svc, { ref: params.ref as string, contract: params.contract }));
        return feedbackResult(
          result,
          result.revisionCreated
            ? successFeedback("issue_updated", `Updated ${params.ref as string}`, "new revision created; readiness must be revalidated")
            : noopFeedback("issue_unchanged", `${params.ref as string} already has this contract`, "no new revision created"),
        );
      },
    }),
    defineTool({
      name: "substrate_journal_append",
      label: "Substrate journal append",
      description: "Append a journal entry (note, finding, decision, blocker, milestone, handoff, result, checkpoint, compaction) to an issue. Results include a structured persistence confirmation.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }), kind: Type.String({ description: "Entry kind" }), sessionId: Type.Optional(Type.String({ description: "Pi session id" })) }),
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<{ ok: boolean }> | undefined,
        ctx: ExtensionContext,
      ) {
        const sessionId = (params.sessionId as string | undefined) ?? ctx?.sessionManager?.getSessionId?.();
        const result = await withServices((svc) => toolJournalAppend(svc, { ref: params.ref as string, kind: params.kind as string, sessionId }));
        return feedbackResult(result, successFeedback("journal_written", `Added ${params.kind as string} to ${params.ref as string}`, `journal seq ${String(result.sequence)}`));
      },
    }),
    defineTool({
      name: "substrate_journal_checkpoint",
      label: "Substrate journal checkpoint",
      description: "Write a mechanical-first journal checkpoint for an issue. Results distinguish complete from degraded semantic enrichment while confirming the durable mechanical checkpoint.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }), sessionId: Type.Optional(Type.String({ description: "Pi session id" })), headCommit: Type.Optional(Type.String({ description: "Head commit SHA" })) }),
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<{ ok: boolean }> | undefined,
        ctx: ExtensionContext,
      ) {
        const sessionId = (params.sessionId as string | undefined) ?? ctx?.sessionManager?.getSessionId?.();
        const result = await withServices((svc) => toolJournalCheckpoint(svc, { ref: params.ref as string, sessionId, headCommit: params.headCommit as string | undefined }));
        return feedbackResult(
          result,
          result.degraded
            ? warningFeedback("journal_degraded", `Checkpoint persisted for ${params.ref as string}`, "mechanical state is durable; semantic enrichment degraded")
            : successFeedback("journal_written", `Checkpoint persisted for ${params.ref as string}`, `journal seq ${String(result.sequence)}`),
        );
      },
    }),
    defineTool({
      name: "substrate_issue_resume",
      label: "Substrate issue resume",
      description: "Build the bounded resume capsule for an issue: contract, checkpoint, deltas, blockers, claim, provenance.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        const capsule = await withServices((svc) => toolIssueResume(svc, { ref: params.ref as string }));
        return { content: [{ type: "text" as const, text: capsule }], details: { ok: true } };
      },
    }),
    defineTool({
      name: "substrate_provenance_trace",
      label: "Substrate provenance trace",
      description: "Trace issue lineage: revision, attestation, claim, checkpoints, event spine. Receipt-backed trace lands in Phase 8.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        return textResult(await withServices((svc) => toolProvenanceTrace(svc, { ref: params.ref as string })));
      },
    }),
  ];
  for (const t of tools) pi.registerTool(t);

  // Edit/write authority (§§38-39, bead xtrm-6qu.6): the blocking tool_call
  // gate. Unbound sessions edit freely; a session bound to an Issue may
  // mutate only under its own live claim (holder + activation). Fail-open
  // on unreadable state so a corrupt gate never bricks Pi.
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
      ctx.ui.notify(capsule ?? "No Substrate issue bound to this session (substrate_issue_claim or SUBSTRATE_ISSUE).", capsule ? "info" : "warning");
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
    // Secondary-model semantic checkpoint (custom-compaction.ts precedent):
    // serialize the compacting conversation, ask a cheap model for the
    // bounded semantic shape, let the service validate it. Any failure
    // degrades to the durable mechanical checkpoint (D23/D26).
    const conversationText = serializeConversation(
      convertToLlm([...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages]),
    );
    const model = ctx.modelRegistry?.find?.("google", "gemini-2.5-flash") ?? ctx.model;
    const summarizer = model
      ? async (): Promise<SemanticCheckpoint> => {
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
          return JSON.parse(text.slice(start, end + 1)) as SemanticCheckpoint;
        }
      : undefined;
    const result = await withServices((svc) => runBeforeCompact(svc, { issueRef: ref, sessionId, summarizer })).catch(() => null);
    if (!result || result.fallbackToDefault || !result.summary) return;
    return {
      compaction: {
        summary: result.summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });
}
