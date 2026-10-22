// Pi mapping for the host-neutral advisor (XTRM-673). Same handlers as the
// Claude plugin, so the same Substrate state yields the same advisory:
//   Claude systemMessage        -> ctx.ui.notify (operator)
//   Claude additionalContext    -> text appended to the tool result, or a
//                                  hidden next-turn message at session start
//   Claude Stop decision:block  -> one follow-up message that triggers a turn
// Fail-open: every handler swallows errors; Pi must never break on Substrate.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handlePostToolAdvisor, handleSessionAdvisor, handleStopAdvisor, substrateCall } from "../advisor.ts";
import { resolveIdentity, type Identity } from "../../src/presentation/advisories.ts";
import { openHandles } from "../claude-code/runtime.ts";

const CUSTOM_TYPE = "substrate-advisor";

function sessionIdOf(ctx: ExtensionContext | undefined): string | undefined {
  return ctx?.sessionManager?.getSessionId?.() ?? undefined;
}

function notify(ctx: ExtensionContext | undefined, message: string | undefined, warning: boolean): void {
  if (message && ctx?.hasUI) ctx.ui.notify(message, warning ? "warning" : "info");
}

const WIDGET_KEY = "substrate";
const WIDGET_ROWS = 3;

/** Status lines for the live band (XTRM-675); the Claude mod draws the same rows. */
export function statusLines(identity: Identity, claims: ClaimStatus[], now: number = Date.now()): string[] {
  if (!identity.holder) return claims.length > 0 ? [] : ["substrate · no SUBSTRATE_HOLDER: writes are anonymous"];
  if (claims.length === 0) return [];
  const rows = claims.slice(0, WIDGET_ROWS).map((c) => {
    const left = Math.round((c.expiresAt - now) / 60000);
    const ttl = left < 0 ? `EXPIRED ${-left}m ago` : `expires in ${left}m`;
    const handoff = c.handoffSeq !== null ? ` · handoff seq${c.handoffSeq}` : " · no handoff";
    return `  ${c.ref} ${truncate(c.title, 48)} · ${ttl}${handoff}`;
  });
  const more = claims.length > WIDGET_ROWS ? [`  +${claims.length - WIDGET_ROWS} more`] : [];
  return [`substrate · ${identity.holder} (${identity.source})`, ...rows, ...more];
}

export interface ClaimStatus {
  ref: string;
  title: string;
  expiresAt: number;
  handoffSeq: number | null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function registerAdvisor(pi: ExtensionAPI, deps: { dbPath?: () => string } = {}): void {
  const dbPath = () => deps.dbPath?.();

  const refreshWidget = (ctx: ExtensionContext | undefined) => {
    if (!ctx?.hasUI) return;
    try {
      const identity = resolveIdentity(process.env, ctx.cwd);
      const claims: ClaimStatus[] = [];
      if (identity.holder) {
        const handles = openHandles(dbPath());
        try {
          for (const c of handles.svc.listClaimsByHolder(identity.holder, { graceMs: 2 * 3_600_000 })) {
            const issue = handles.svc.getIssue(c.issueId);
            const handoff = handles.journal.latest(c.issueId, { kind: "handoff" });
            claims.push({ ref: issue.humanRef, title: issue.title, expiresAt: c.expiresAt, handoffSeq: handoff?.sequence ?? null });
          }
        } finally {
          handles.db.close();
        }
      }
      const lines = statusLines(identity, claims);
      ctx.ui.setWidget(WIDGET_KEY, lines.length > 0 ? lines : undefined);
    } catch {
      // fail-open: keep the previous widget
    }
  };
  // Pi's equivalent of Claude's stop_hook_active: the follow-up this
  // advisor sent is the turn now ending, so it must not send another.
  let continuing = false;

  pi.on("session_start", (event, ctx) => {
    try {
      // The extension runs in-process: exporting here reaches every bash
      // child, as CLAUDE_ENV_FILE does for Claude.
      const identity = resolveIdentity(process.env, ctx.cwd);
      if (identity.source === "worktree" && identity.holder) process.env["SUBSTRATE_HOLDER"] = identity.holder;
      const out = handleSessionAdvisor({ source: event.reason, session_id: sessionIdOf(ctx), cwd: ctx.cwd }, { dbPath: dbPath() });
      if (out.additionalContext) {
        pi.sendMessage({ customType: CUSTOM_TYPE, content: out.additionalContext, display: false }, { deliverAs: "nextTurn" });
      }
      notify(ctx, out.systemMessage, true);
    } catch {
      // fail-open
    }
    refreshWidget(ctx);
  });

  pi.on("tool_result", (event, ctx) => {
    try {
      const out = handlePostToolAdvisor(
        { tool_name: event.toolName, tool_input: event.input, session_id: sessionIdOf(ctx), cwd: ctx.cwd },
        { dbPath: dbPath() },
      );
      if (substrateCall(event.toolName, event.input)) refreshWidget(ctx);
      if (!out) return;
      notify(ctx, out.systemMessage, /no author|without/.test(out.systemMessage ?? ""));
      if (!out.additionalContext) return;
      return { content: [...event.content, { type: "text" as const, text: out.additionalContext }] };
    } catch {
      return;
    }
  });

  pi.on("agent_end", (event, ctx) => {
    if ((event as { willRetry?: boolean }).willRetry === true) return;
    refreshWidget(ctx);
    try {
      const out = handleStopAdvisor({ session_id: sessionIdOf(ctx), cwd: ctx.cwd, stop_hook_active: continuing }, { dbPath: dbPath() });
      continuing = false;
      if (!out) return;
      notify(ctx, out.systemMessage, false);
      if (out.block) {
        continuing = true;
        pi.sendMessage({ customType: CUSTOM_TYPE, content: out.block, display: true }, { deliverAs: "followUp", triggerTurn: true });
      }
    } catch {
      continuing = false;
    }
  });
}
