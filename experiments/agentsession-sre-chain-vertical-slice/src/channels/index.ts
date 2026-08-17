/**
 * Channels simulation per spec §7.
 *
 *   routing hard       — audience.action_targets is enforced
 *   attention soft     — non-target chain-visible messages surface as attention
 *   authority hard     — system.* only from runtime; work.verdict only from reviewer
 *   read != processed  — separate cursors: last_read_id vs last_acked_id
 *   evidence separate  — messages carry evidence_refs, never full bodies
 *
 * Storage: append-only JSONL. Host assigns monotonic per-channel `id`.
 * Author identity is HOST-INJECTED, never taken from tool call body.
 */

import type {
  MessageEnvelope,
  MessageKind,
  ParticipantCursor,
  ParticipantRole,
} from "../chain/types.ts";
import type { Paths } from "../chain/store.ts";
import { appendMessage, loadCursor, readMessages, saveCursor } from "../chain/store.ts";
import { nowIso } from "../util/ids.ts";

/** Which roles may emit which message kinds. Host-enforced. */
const KIND_AUTHORITY: Record<MessageKind, Array<ParticipantRole | "runtime" | "reviewer_policy">> = {
  "work.turn":                   ["chain-coordinator", "explorer", "observability-analyst", "sre-diagnostician", "reviewer"],
  "work.finding":                ["explorer", "observability-analyst", "sre-diagnostician"],
  "work.verdict":                ["reviewer_policy", "reviewer"],
  "work.proposal":               ["chain-coordinator", "explorer", "observability-analyst", "sre-diagnostician", "reviewer"],
  "work.ack":                    ["chain-coordinator", "explorer", "observability-analyst", "sre-diagnostician", "reviewer"],
  "control.attention_requested": ["chain-coordinator", "explorer", "observability-analyst", "sre-diagnostician", "reviewer"],
  "control.escalation":          ["chain-coordinator", "explorer", "observability-analyst", "sre-diagnostician", "reviewer", "runtime"],
  "system.continue":             ["runtime"],
  "system.redirect":             ["runtime"],
  "system.done":                 ["runtime"],
  "runtime.error":               ["runtime"],
  "runtime.message_rejected":    ["runtime"],
};

export interface PostArgs {
  channel_id: string;
  authorParticipantId: string;
  authorRole: ParticipantRole | "runtime" | "reviewer_policy";
  authorExecutionId?: string;
  kind: MessageKind;
  audience: MessageEnvelope["audience"];
  work_refs?: MessageEnvelope["work_refs"];
  body: Record<string, unknown>;
  evidence_refs?: string[];
  forensic_event_ids?: string[];
}

export interface PostResult {
  ok: boolean;
  message?: MessageEnvelope;
  reason?: string;
}

/** Runtime-injected trust checker. Rejects spoofed authors + unauthorized kinds + schema violations. */
export function checkAuthority(args: PostArgs, trustedAuthorRole: ParticipantRole | "runtime" | "reviewer_policy"): string | null {
  if (args.authorRole !== trustedAuthorRole) {
    return `spoofed author role: claimed=${args.authorRole} trusted=${trustedAuthorRole}`;
  }
  const allowed = KIND_AUTHORITY[args.kind];
  if (!allowed || !allowed.includes(trustedAuthorRole)) {
    return `role ${trustedAuthorRole} may not emit kind ${args.kind}`;
  }
  if (args.audience.visibility !== "chain" && args.audience.visibility !== "private") {
    return `invalid visibility: ${args.audience.visibility}`;
  }
  // Bounded body size — pointer-first.
  const bodyStr = JSON.stringify(args.body);
  if (bodyStr.length > 8 * 1024) return `body too large (${bodyStr.length}B > 8KiB); use evidence_refs`;

  // Schema validators — evidence_refs required for finding-bearing messages.
  const isInvestigative =
    trustedAuthorRole === "explorer" ||
    trustedAuthorRole === "observability-analyst" ||
    trustedAuthorRole === "sre-diagnostician" ||
    trustedAuthorRole === "reviewer" ||
    trustedAuthorRole === "reviewer_policy" ||
    trustedAuthorRole === "chain-coordinator";
  const hasRefs = (args.evidence_refs ?? []).length > 0;

  if (args.kind === "work.finding" && !hasRefs) {
    return "work.finding requires evidence_refs (pointer-first)";
  }
  if (args.kind === "work.verdict" && !hasRefs) {
    return "work.verdict requires evidence_refs (reviewer must reference the verdict evidence body)";
  }
  if (args.kind === "work.turn" && isInvestigative && !hasRefs) {
    return `${trustedAuthorRole} work.turn requires evidence_refs — publish evidence via evidence_publish first, then reference its evidence_id`;
  }

  // action_targets must be non-empty for work.turn (routing hard).
  if (args.kind === "work.turn" && (args.audience.action_targets ?? []).length === 0) {
    return "work.turn requires at least one action_target";
  }
  return null;
}

let _idCounter: Map<string, number> = new Map();
async function nextIdForChannel(p: Paths, channelId: string): Promise<number> {
  let cur = _idCounter.get(channelId);
  if (cur === undefined) {
    // recover from disk
    const existing = await readMessages(p);
    cur = existing.filter((m) => m.channel_id === channelId).reduce((mx, m) => (m.id > mx ? m.id : mx), 0);
    _idCounter.set(channelId, cur);
  }
  const nx = cur + 1;
  _idCounter.set(channelId, nx);
  return nx;
}

export async function postMessage(
  p: Paths,
  args: PostArgs,
  trustedAuthorRole: ParticipantRole | "runtime" | "reviewer_policy",
): Promise<PostResult> {
  const reason = checkAuthority(args, trustedAuthorRole);
  if (reason) {
    const rejected: MessageEnvelope = {
      channel_id: args.channel_id,
      id: await nextIdForChannel(p, args.channel_id),
      author: { participant_id: "runtime", participant_role: "runtime" },
      kind: "runtime.message_rejected",
      audience: { visibility: "chain", action_targets: [] },
      body: { reason, offending_kind: args.kind, offending_author: args.authorParticipantId },
      created_at: nowIso(),
    };
    await appendMessage(p, rejected);
    return { ok: false, reason };
  }
  const msg: MessageEnvelope = {
    channel_id: args.channel_id,
    id: await nextIdForChannel(p, args.channel_id),
    author: {
      participant_id: args.authorParticipantId,
      participant_role: trustedAuthorRole,
      execution_id: args.authorExecutionId,
    },
    kind: args.kind,
    audience: args.audience,
    work_refs: args.work_refs,
    body: args.body,
    evidence_refs: args.evidence_refs,
    forensic_event_ids: args.forensic_event_ids,
    created_at: nowIso(),
  };
  await appendMessage(p, msg);
  return { ok: true, message: msg };
}

/** Actionable messages: action-targeted AND not yet acked. Does NOT advance cursor. */
export async function actionableFor(
  p: Paths,
  channelId: string,
  participantId: string,
): Promise<MessageEnvelope[]> {
  const [msgs, cursor] = await Promise.all([readMessages(p), loadCursor(p, participantId)]);
  return msgs.filter(
    (m) =>
      m.channel_id === channelId &&
      m.id > cursor.last_acked_id &&
      m.audience.action_targets.includes(participantId),
  );
}

/** Attention: chain-visible messages not action-targeted at this participant. Bounded. */
export async function attentionFor(
  p: Paths,
  channelId: string,
  participantId: string,
  limit = 20,
): Promise<MessageEnvelope[]> {
  const msgs = await readMessages(p);
  return msgs
    .filter(
      (m) =>
        m.channel_id === channelId &&
        m.audience.visibility === "chain" &&
        !m.audience.action_targets.includes(participantId) &&
        m.author.participant_id !== participantId,
    )
    .slice(-limit);
}

export async function markRead(
  p: Paths,
  participantId: string,
  upToId: number,
): Promise<ParticipantCursor> {
  const cur = await loadCursor(p, participantId);
  const next: ParticipantCursor = {
    ...cur,
    last_read_id: Math.max(cur.last_read_id, upToId),
  };
  await saveCursor(p, next);
  return next;
}

export async function ackUpTo(
  p: Paths,
  participantId: string,
  upToId: number,
): Promise<ParticipantCursor> {
  const cur = await loadCursor(p, participantId);
  const next: ParticipantCursor = {
    ...cur,
    last_acked_id: Math.max(cur.last_acked_id, upToId),
    last_read_id: Math.max(cur.last_read_id, upToId),
  };
  await saveCursor(p, next);
  return next;
}

/** Runtime-issued convenience wrappers. */
export async function runtimePost(
  p: Paths,
  channelId: string,
  kind: MessageKind,
  body: Record<string, unknown>,
  actionTargets: string[] = [],
): Promise<PostResult> {
  return postMessage(
    p,
    {
      channel_id: channelId,
      authorParticipantId: "runtime",
      authorRole: "runtime",
      kind,
      audience: { visibility: "chain", action_targets: actionTargets },
      body,
    },
    "runtime",
  );
}
