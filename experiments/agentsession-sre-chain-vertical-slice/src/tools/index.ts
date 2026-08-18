/**
 * Host-owned Pi custom tools per spec §8 + §12.
 *
 * Agents MUST NOT directly write the channel store or evidence store; every
 * mutation goes through these tools. Author identity is injected by the host
 * (via ParticipantIdentity captured in a closure) so model prose cannot spoof it.
 *
 * Tool inventory:
 *   chain_progress        — read compact projection of run state
 *   channel_actionable    — pure read of unread action-targeted messages
 *   channel_attention     — bounded pointer view of non-actionable chain signals
 *   channel_post          — validated append (kind + audience + authority enforced)
 *   channel_ack           — advance participant processing cursor
 *   evidence_get          — dereference an evidence body
 *   evidence_publish      — persist semantic payload → returns evidence_id
 *   sre_exec              — bounded read-only diagnostic command against the target repo
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ParticipantIdentity } from "../chain/types.ts";
import type { Paths } from "../chain/store.ts";
import { actionableFor, ackUpTo, attentionFor, markRead, postMessage } from "../channels/index.ts";
import { projectEvidence, publishEvidence, readEvidenceBody } from "../evidence/index.ts";
import { loadRunState } from "../chain/store.ts";

const pexec = promisify(execFile);

export interface ToolHostContext {
  paths: Paths;
  channelId: string;
  identity: ParticipantIdentity;
  targetRepo: string;
  execAllowlist: RegExp[];
  execDenylist: RegExp[];
  onFact?: (fact: import("../chain/types.ts").RuntimeFact) => void;
}

/** Wrap a text payload into the pi tool result shape. */
function textResult(text: string, details: unknown = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function buildTools(host: ToolHostContext): ToolDefinition[] {
  const chainProgress = defineTool({
    name: "chain_progress",
    label: "Chain progress",
    description:
      "Return a compact projection of the current chain run: participant statuses, latest verdict, pending intents, reviewer loops. Read-only.",
    promptSnippet: "chain_progress: read current chain state (participants, verdict, remediation loops)",
    parameters: Type.Object({}),
    async execute() {
      const run = await loadRunState(host.paths);
      if (!run) return textResult("no run state yet");
      const rows = Object.values(run.steps)
        .map(
          (s) =>
            `${s.step_id.padEnd(22)} ${s.status.padEnd(18)} attempts=${s.attempts} loops=${s.remediation_loops}`,
        )
        .join("\n");
      const summary =
        `chain_run_id: ${run.chain_run_id}\nstatus: ${run.status}\nverdict: ${run.reviewer_verdict ?? "(none)"}\n\n${rows}`;
      return textResult(summary, { run });
    },
  });

  const channelActionable = defineTool({
    name: "channel_actionable",
    label: "Actionable messages",
    description:
      "List messages targeted at YOU (action_targets includes your participant_id) that you have NOT yet acked. Reading here does not ack.",
    promptSnippet: "channel_actionable: list unread messages targeted at you (read does not ack)",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max messages to return (default 20)" })),
    }),
    async execute(_id, params) {
      const msgs = await actionableFor(host.paths, host.channelId, host.identity.participant_id);
      const capped = msgs.slice(0, params.limit ?? 20);
      const rendered = capped
        .map(
          (m) =>
            `#${m.id} ${m.kind} from ${m.author.participant_role} (${m.author.participant_id})\n  summary: ${
              (m.body.summary as string) ?? "(no summary)"
            }\n  evidence_refs: ${(m.evidence_refs ?? []).join(", ") || "(none)"}`,
        )
        .join("\n\n");
      // mark as read (not acked)
      if (capped.length > 0) {
        await markRead(host.paths, host.identity.participant_id, capped[capped.length - 1]!.id);
      }
      return textResult(rendered || "(no actionable messages)", { count: capped.length });
    },
  });

  const channelAttention = defineTool({
    name: "channel_attention",
    label: "Attention signals",
    description:
      "Bounded pointer view of chain-visible messages NOT targeted at you but potentially relevant. Attention does NOT grant authority to act as if targeted.",
    promptSnippet: "channel_attention: see chain-visible signals not targeted at you (attention != authority)",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max messages (default 10)" })),
    }),
    async execute(_id, params) {
      const msgs = await attentionFor(
        host.paths,
        host.channelId,
        host.identity.participant_id,
        params.limit ?? 10,
      );
      const rendered = msgs
        .map(
          (m) =>
            `#${m.id} ${m.kind} by ${m.author.participant_role} → targets=[${m.audience.action_targets.join(", ")}]\n  ${
              (m.body.summary as string) ?? ""
            }`,
        )
        .join("\n");
      return textResult(rendered || "(no attention signals)", { count: msgs.length });
    },
  });

  const channelPost = defineTool({
    name: "channel_post",
    label: "Post channel message",
    description:
      "Append a typed message to the chain channel. Author identity is host-injected; do NOT include it. Body must be SHORT (≤8KiB) and pointer-first — attach big payloads via evidence_publish and reference their evidence_ids in evidence_refs.",
    promptSnippet: "channel_post: post a typed message (work.turn|work.finding|work.proposal|work.ack|control.*)",
    parameters: Type.Object({
      kind: Type.String({
        description:
          "One of: work.turn | work.finding | work.proposal | work.ack | control.attention_requested | control.escalation. (system.* is runtime-only; work.verdict is reviewer-only.)",
      }),
      visibility: Type.Optional(Type.String({ description: "chain (default) or private" })),
      action_targets: Type.Optional(Type.Array(Type.String())),
      suggested_watchers: Type.Optional(Type.Array(Type.String())),
      urgency: Type.Optional(Type.String({ description: "low | normal | high" })),
      body: Type.Any({ description: "Structured body — should include a `summary` string." }),
      evidence_refs: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params) {
      const authorRole =
        host.identity.role === "reviewer" && params.kind === "work.verdict"
          ? "reviewer_policy"
          : host.identity.role;
      const res = await postMessage(
        host.paths,
        {
          channel_id: host.channelId,
          authorParticipantId: host.identity.participant_id,
          authorRole,
          authorExecutionId: host.identity.execution_id,
          kind: params.kind as any,
          audience: {
            visibility: (params.visibility as any) ?? "chain",
            action_targets: params.action_targets ?? [],
            suggested_watchers: params.suggested_watchers,
            urgency: params.urgency as any,
          },
          body: params.body ?? {},
          evidence_refs: params.evidence_refs,
        },
        authorRole,
      );
      if (!res.ok) {
        host.onFact?.({
          ts: new Date().toISOString(),
          chain_id: host.identity.chain_id,
          role: host.identity.role,
          step_id: host.identity.step_id,
          kind: "message.rejected",
          detail: res.reason ?? "rejected",
        });
        return textResult(`REJECTED: ${res.reason}`, { rejected: true });
      }
      return textResult(`posted #${res.message!.id} ${res.message!.kind}`, { message: res.message });
    },
  });

  const channelAck = defineTool({
    name: "channel_ack",
    label: "Ack messages",
    description:
      "Advance your PROCESSING cursor up to the given message id — call ONLY after actually handling the message. Reading via channel_actionable does not ack.",
    promptSnippet: "channel_ack: advance processing cursor after handling messages",
    parameters: Type.Object({
      up_to_id: Type.Number({ description: "Highest message id you have processed." }),
    }),
    async execute(_id, params) {
      const cur = await ackUpTo(host.paths, host.identity.participant_id, params.up_to_id);
      return textResult(`acked up to #${cur.last_acked_id}`, { cursor: cur });
    },
  });

  const evidencePublish = defineTool({
    name: "evidence_publish",
    label: "Publish evidence",
    description:
      "Persist a semantic payload as evidence and receive an evidence_id (pointer). Downstream participants dereference via evidence_get. Use kind = topology.map | observability.snapshot | diagnostician.report | reviewer.verdict | coordinator.decision.",
    promptSnippet: "evidence_publish: persist a semantic payload → returns evidence_id",
    parameters: Type.Object({
      kind: Type.String(),
      summary: Type.String({ description: "One-line summary (≤300 chars)" }),
      body: Type.Any({ description: "Full structured payload (may be large)" }),
      scope_refs: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params) {
      const ev = await publishEvidence({
        paths: host.paths,
        chainId: host.identity.chain_id,
        stepId: host.identity.step_id,
        producerParticipantId: host.identity.participant_id,
        producerRole: host.identity.role,
        executionId: host.identity.execution_id,
        kind: params.kind as any,
        summary: params.summary,
        body: params.body,
        scope_refs: params.scope_refs,
      });
      return textResult(`published ${ev.evidence_id} (${ev.kind}): ${ev.summary}`, { evidence: ev });
    },
  });

  const evidenceGet = defineTool({
    name: "evidence_get",
    label: "Get evidence",
    description:
      "Dereference an evidence_id to its full body. Default is pointer-first — only call this when you actually need the payload.",
    promptSnippet: "evidence_get: dereference an evidence_id to its full body (pointer-first)",
    parameters: Type.Object({
      evidence_id: Type.String(),
    }),
    async execute(_id, params) {
      const projection = await projectEvidence(host.paths);
      const all = Object.values(projection.by_step).flat();
      const env = all.find((e) => e.evidence_id === params.evidence_id);
      if (!env) return textResult(`not found: ${params.evidence_id}`, { not_found: true });
      const body = await readEvidenceBody(host.paths, env.body_ref);
      return textResult(
        `${env.evidence_id} (${env.kind}) from ${env.producer_role} @ ${env.step_id}\n\n${JSON.stringify(body, null, 2)}`,
        { envelope: env, body },
      );
    },
  });

  const sreExec = defineTool({
    name: "sre_exec",
    label: "SRE exec (read-only)",
    description:
      "Run a bounded READ-ONLY diagnostic shell command against the target repository. Mutation/destructive operations are refused. Use for git log, cat, grep, ls, find, docker inspect, prometheus query via mcpq, etc.",
    promptSnippet: "sre_exec: run a bounded READ-ONLY shell command against the target repo (allowlisted)",
    parameters: Type.Object({
      cmd: Type.String({ description: "The command to run — must match allowlist" }),
      timeout_ms: Type.Optional(Type.Number({ description: "Default 30000, cap 120000" })),
    }),
    async execute(_id, params, signal) {
      const cmd = params.cmd.trim();
      if (!cmd) return textResult("empty command", { rejected: true });
      // Denylist first (defense-in-depth)
      for (const rx of host.execDenylist) {
        if (rx.test(cmd)) {
          return textResult(`REJECTED: matches denylist ${rx}`, { rejected: true });
        }
      }
      // Allowlist match
      const allowed = host.execAllowlist.some((rx) => rx.test(cmd));
      if (!allowed) {
        return textResult(`REJECTED: not in read-only allowlist. Allowed prefixes: ${host.execAllowlist.map(String).join(", ")}`, { rejected: true });
      }
      const timeoutMs = Math.min(Math.max(params.timeout_ms ?? 30_000, 1000), 120_000);
      const started = Date.now();
      try {
        const { stdout, stderr } = await pexec("bash", ["-lc", cmd], {
          cwd: host.targetRepo,
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          signal,
        });
        const duration = Date.now() - started;
        const combined = stdout + (stderr ? `\n---STDERR---\n${stderr}` : "");
        const capped = combined.length > 16 * 1024 ? combined.slice(0, 16 * 1024) + "\n[…truncated]" : combined;
        return textResult(`exit=0 duration=${duration}ms\n\n${capped}`, {
          cmd,
          exit_code: 0,
          duration_ms: duration,
        });
      } catch (e: any) {
        const duration = Date.now() - started;
        const combined = (e.stdout ?? "") + (e.stderr ? `\n---STDERR---\n${e.stderr}` : "");
        const capped =
          combined.length > 16 * 1024 ? combined.slice(0, 16 * 1024) + "\n[…truncated]" : combined;
        return textResult(
          `exit=${e.code ?? "?"} duration=${duration}ms signal=${e.signal ?? "-"}\n\n${capped}`,
          { cmd, exit_code: e.code, duration_ms: duration, signal: e.signal },
        );
      }
    },
  });

  return [
    chainProgress,
    channelActionable,
    channelAttention,
    channelPost,
    channelAck,
    evidencePublish,
    evidenceGet,
    sreExec,
  ];
}

/**
 * Default read-only exec policy for SRE triage. Adjust per experiment run.
 * These are POSIX-shell-line matchers, not sandboxes — the defense in depth is:
 *   1. AgentSession's built-in bash tool is NOT active (we set tools: []).
 *   2. sre_exec runs via child_process with no shell mutation possible outside cwd.
 *   3. The target repo is treated as read-only by convention (§12).
 */
export { DEFAULT_SRE_ALLOWLIST, DEFAULT_SRE_DENYLIST } from "./policy.ts";
