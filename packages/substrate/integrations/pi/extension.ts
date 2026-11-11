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
import { Type, type Usage } from "@earendil-works/pi-ai";
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
  toPiCompaction,
} from "./handlers.ts";
import type { SemanticCheckpoint } from "../../src/domain/journal.ts";
import { JOURNAL_SUMMARY_MAX } from "../../src/domain/journal.ts";
import { SessionBacking, openBacking, type Backing, type StoreCall } from "./backing.ts";
import { isTransportFailure, transportCode } from "../../src/service/operations.ts";
import {
  noopFeedback,
  successFeedback,
  warningFeedback,
  withFeedback,
  type OperationFeedback,
} from "../../src/presentation/operation-feedback.ts";

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }>; details: { ok: boolean } } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: { ok: true } };
}

function feedbackResult(data: Record<string, unknown>, feedback: OperationFeedback) {
  return textResult(withFeedback(data, feedback));
}

export default function registerSubstrate(pi: ExtensionAPI, options: { openBacking?: () => Backing } = {}): void {
  const bindings = new SessionBindings();

  // One call surface, local or remote, for the life of the session (XTRM-711).
  // Opening per call paid an ssh handshake on every tool call and every edit.
  const open = options.openBacking ?? (() => openBacking());
  const session = new SessionBacking(open);
  const withBacking = async <T>(fn: (backing: StoreCall) => Promise<T>): Promise<T> => fn(session);
  // Closing it is the session's job, not each call's: a leaked connection keeps
  // ssh alive on the store-owning machine.
  pi.on("session_shutdown", async () => {
    await session.close();
  });

  const tools = [
    defineTool({
      name: "substrate_issue_get",
      label: "Substrate issue get",
      description: "Get a Substrate issue with contract, readiness, claim, and attestation. Ref accepts machine ID, durable reference, locator, historical locator, or alias.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        return textResult(await withBacking((backing) => toolIssueGet(backing, { ref: params.ref as string })));
      },
    }),
    defineTool({
      name: "substrate_issue_search",
      label: "Substrate issue search",
      description: "Search Substrate issues within a project by title/reference substring, optionally filtered by kind.",
      parameters: Type.Object({ project: Type.String({ description: "Project id" }), query: Type.Optional(Type.String({ description: "Substring match" })), kind: Type.Optional(Type.String({ description: "Issue kind" })) }),
      async execute(_id: string, params: Record<string, unknown>) {
        return textResult(
          await withBacking((backing) =>
            toolIssueSearch(backing, { project: params.project as string, query: params.query as string | undefined, kind: params.kind as string | undefined }),
          ),
        );
      },
    }),
    defineTool({
      name: "substrate_issue_claim",
      label: "Substrate issue claim",
      description: "Claim a dispatchable Substrate issue for a holder. Binds the Pi session to the issue for checkpoints and resume. holder defaults to SUBSTRATE_HOLDER, so a launched session claims as itself. Successful mutations include structured feedback.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }), holder: Type.Optional(Type.String({ description: "Claim holder (defaults to SUBSTRATE_HOLDER)" })), activationId: Type.Optional(Type.String({ description: "Activation id" })), sessionId: Type.Optional(Type.String({ description: "Pi session id" })) }),
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<{ ok: boolean }> | undefined,
        ctx: ExtensionContext,
      ) {
        const sessionId = (params.sessionId as string | undefined) ?? ctx?.sessionManager?.getSessionId?.();
        const result = await withBacking((backing) => toolIssueClaim(backing, bindings, { ref: params.ref as string, holder: params.holder as string | undefined, activationId: params.activationId as string | undefined, sessionId }));
        const holder = String((result as { holder?: unknown }).holder ?? "session");
        const source = (result as { holderSource?: unknown }).holderSource === "env" ? "from SUBSTRATE_HOLDER" : "explicit";
        return feedbackResult(result, successFeedback("issue_claimed", `Claimed ${params.ref as string}`, `holder ${holder} (${source})`));
      },
    }),
    defineTool({
      name: "substrate_issue_update",
      label: "Substrate issue update",
      description: "Revise a Substrate issue contract (revision-on-change; identical contracts are a no-op). Results include structured success/no-op feedback so agents can distinguish a persisted revision from an idempotent repeat.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }), contract: Type.Unknown({ description: "Seven-field work contract" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        const result = await withBacking((backing) => toolIssueUpdate(backing, { ref: params.ref as string, contract: params.contract }));
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
      description: "Append a journal entry (note, finding, decision, blocker, milestone, handoff, result, checkpoint, compaction) to an issue. Pass summary to persist the entry text; omitting it writes an explicitly text-less entry. Results include a structured persistence confirmation.",
      parameters: Type.Object({
        ref: Type.String({ description: "Issue ref" }),
        kind: Type.String({ description: "Entry kind" }),
        summary: Type.Optional(Type.String({ description: `Entry text, persisted as the semantic summary (non-result kinds) or the result summary (kind result). Max ${JOURNAL_SUMMARY_MAX} characters; a longer or blank value fails the call.` })),
        sessionId: Type.Optional(Type.String({ description: "Pi session id" })),
      }),
      async execute(
        _id: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<{ ok: boolean }> | undefined,
        ctx: ExtensionContext,
      ) {
        const sessionId = (params.sessionId as string | undefined) ?? ctx?.sessionManager?.getSessionId?.();
        const result = await withBacking((backing) => toolJournalAppend(backing, { ref: params.ref as string, kind: params.kind as string, summary: params.summary as string | undefined, sessionId }));
        const persisted = result.summary as string | null;
        return feedbackResult(
          result,
          successFeedback(
            "journal_written",
            `Added ${params.kind as string} to ${params.ref as string}`,
            persisted === null
              ? `journal seq ${String(result.sequence)} · no entry text (kind-only append)`
              : `journal seq ${String(result.sequence)} · summary persisted (${persisted.length} chars)`,
          ),
        );
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
        const result = await withBacking((backing) => toolJournalCheckpoint(backing, { ref: params.ref as string, sessionId, headCommit: params.headCommit as string | undefined }));
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
      description: "Build the bounded resume capsule for an issue: current contract, latest checkpoint, Journal delta, blockers, claim, and provenance.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        const capsule = await withBacking((backing) => toolIssueResume(backing, { ref: params.ref as string }));
        return { content: [{ type: "text" as const, text: capsule }], details: { ok: true } };
      },
    }),
    defineTool({
      name: "substrate_provenance_trace",
      label: "Substrate provenance trace",
      description: "Trace the full durable evidence spine for an issue: revision/hash, attestation, claims, execution bindings, WorkReceipts with artifacts, checkpoints, commits/PRs, external bindings, and closure revision.",
      parameters: Type.Object({ ref: Type.String({ description: "Issue ref" }) }),
      async execute(_id: string, params: Record<string, unknown>) {
        return textResult(await withBacking((backing) => toolProvenanceTrace(backing, { ref: params.ref as string })));
      },
    }),
  ];
  for (const t of tools) pi.registerTool(t);

  // A session bound to an Issue may mutate only under its own live claim
  // (holder + activation).
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;
    try {
      const sessionId = ctx?.sessionManager?.getSessionId?.();
      const decision = await withBacking((backing) => decidePiEditCall(backing, bindings, { sessionId: sessionId ?? undefined, workspace: ctx?.cwd }));
      if (!decision.allow) return { block: true, reason: decision.reason ?? "no live claim" };
    } catch (error) {
      // A local failure keeps today's fail-open: a corrupt gate must not brick Pi.
      // A configured remote that cannot be reached is a different situation —
      // enforcement lives on the other machine, so allowing the edit would mean
      // no claim check at all, while the tools in the same session already fail
      // closed. Block, and name the transport code so an operator can act (XTRM-712).
      if (!isTransportFailure(error)) return;
      const code = transportCode(error) ?? "connection_lost";
      const detail = error instanceof Error ? error.message : String(error);
      // A timeout is not the same news as a dead connection: the check may still
      // be running on the other machine, so the reason must not claim it did not.
      const outcome =
        code === "timeout"
          ? "The edit was not applied, and no claim was confirmed: the check may still be running on the store-owning machine."
          : "The edit was not applied and no claim was checked.";
      return {
        block: true,
        reason: `Substrate is remote and the store did not answer reliably (${code}): ${detail}. ${outcome} Restore the connection, or run \`sb remote status\` on the store-owning machine.`,
      };
    }
  });

  pi.registerCommand("substrate-resume", {
    description: "Print the Substrate resume capsule for the session-bound issue",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const sessionId = ctx?.sessionManager?.getSessionId?.();
      const capsule = await withBacking((backing) => resumeForSession(backing, bindings, sessionId));
      ctx.ui.notify(
        capsule ?? "No Substrate issue bound to this session (claim one, or set SUBSTRATE_ISSUE_REF; SUBSTRATE_ISSUE is the legacy alias).",
        capsule ? "info" : "warning",
      );
    },
  });

  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    if (event.reason !== "resume" && event.reason !== "new" && event.reason !== "fork") return;
    const sessionId = ctx?.sessionManager?.getSessionId?.() ?? event.previousSessionFile;
    const capsule = await withBacking((backing) => resumeForSession(backing, bindings, sessionId)).catch(() => null);
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
    const result = await withBacking((backing) => runBeforeCompact(backing, { issueRef: ref, sessionId, summarizer })).catch(() => null);
    if (!result) return;
    return toPiCompaction(event.preparation, result);
  });
}
