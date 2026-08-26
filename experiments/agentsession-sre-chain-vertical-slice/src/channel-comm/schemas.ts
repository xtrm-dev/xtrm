/**
 * Channel message semantic contracts — `xtrm.channel-message.v1`.
 *
 * Normative source: docs/channels/channels.md (§5.3 families/kinds table,
 * §5.4 audience + visibility inclusion rule ~line 208, §10.1 authority
 * decision procedure, §11 read/ack separation).
 *
 * This layer is GENERIC: participant classes are coordinator | participant |
 * runtime | reviewer-policy. No SRE/domain roles ever appear here.
 *
 * AUTHOR AUTHORITY (loud, load-bearing):
 *   `author` is HOST-INJECTED via the ChannelCommService lane (one service
 *   instance per participant — channels.md §11 "authority lane"). It is NOT
 *   part of any call-args schema. Because every draft schema below is
 *   `.strict()`, a caller smuggling an `author` / `author_role` field into
 *   send()/request()/reply() args is structurally REJECTED with an
 *   unrecognized-key error — never ignored.
 *
 * BODY CANNOT ASSERT AUTHORITY (channels.md §10.1 step 5): bodies carrying
 * authority-bearing keys are REJECTED with `body_authority_assertion`.
 * Deviation note: channels.md canon downgrades such writes to kind=note;
 * this contract layer rejects instead because note-downgrade is a write-path
 * policy (wakeups, edges) owned by later beads — rejection here is fully
 * deterministic and the stricter of the two safe options.
 */

import { z } from "zod";

export const CHANNEL_MESSAGE_SCHEMA_VERSION = "xtrm.channel-message.v1" as const;

/** Generic participant classes (channels.md §5.3 Author column, generalized). */
export const PARTICIPANT_CLASSES = [
  "coordinator",
  "participant",
  "runtime",
  "reviewer-policy",
] as const;
export type ParticipantClass = (typeof PARTICIPANT_CLASSES)[number];

/** Viewer classes for visibility resolution; `operator` is a read-only viewer class. */
export type ViewerClass = ParticipantClass | "operator";

/** Canonical families per §5.3. */
export const FAMILIES = ["work", "control", "system", "runtime"] as const;

/** Canonical kinds per the §5.3 family table (family-prefixed names only). */
export const MESSAGE_KINDS = [
  "work.turn",
  "work.finding",
  "work.verdict",
  "work.proposal",
  "work.ack",
  "control.steer",
  "control.attention_requested",
  "control.escalation",
  "system.continue",
  "system.done",
  "system.redirect",
  "system.swap",
  "system.idle",
  "system.budget",
  "system.epoch_bump",
  "runtime.error",
  "runtime.message_rejected",
  "runtime.member_joined",
  "runtime.member_left",
  "runtime.delivery_failed",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export function familyOf(kind: MessageKind): (typeof FAMILIES)[number] {
  return kind.split(".")[0] as (typeof FAMILIES)[number];
}

/** Canonical visibility values per §5.4. */
export const VISIBILITIES = ["private", "targets", "chain", "node", "operator", "public_audit"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Authority table: which participant class may emit which kind.
 * Host-enforced from DB/lane state, never from the body (§10.1).
 * system.* → runtime only (task contract; judge-specific grants are a later,
 * policy-level refinement). runtime.* → runtime only.
 */
export const KIND_AUTHORITY: Record<MessageKind, readonly ParticipantClass[]> = {
  "work.turn": ["participant", "coordinator", "reviewer-policy"],
  "work.finding": ["participant", "coordinator", "reviewer-policy"],
  "work.verdict": ["reviewer-policy", "coordinator"],
  "work.proposal": ["participant", "coordinator", "reviewer-policy"],
  "work.ack": ["participant", "coordinator", "reviewer-policy"],
  "control.steer": ["coordinator", "runtime"],
  "control.attention_requested": ["participant", "coordinator", "reviewer-policy"],
  "control.escalation": ["coordinator", "participant", "runtime", "reviewer-policy"],
  "system.continue": ["runtime"],
  "system.done": ["runtime"],
  "system.redirect": ["runtime"],
  "system.swap": ["runtime"],
  "system.idle": ["runtime"],
  "system.budget": ["runtime"],
  "system.epoch_bump": ["runtime"],
  "runtime.error": ["runtime"],
  "runtime.message_rejected": ["runtime"],
  "runtime.member_joined": ["runtime"],
  "runtime.member_left": ["runtime"],
  "runtime.delivery_failed": ["runtime"],
};

/** Body keys that assert authority or identity — always rejected in bodies (§10.1). */
export const FORBIDDEN_BODY_KEYS = [
  "author",
  "author_id",
  "author_key",
  "author_role",
  "role",
  "participant_id",
  "participant_role",
  "job_id",
  "authority",
  "capability",
  "permissions",
] as const;

const OpaqueRef = z.string().min(1);

/** Per-kind minimal required body fields, exactly per the §5.3 table. */
export const BODY_SCHEMAS: Record<MessageKind, z.ZodTypeAny> = {
  "work.turn": z.object({ summary: z.string().min(1).max(500), refs: z.record(z.unknown()).optional() }).strict(),
  "work.finding": z
    .object({
      severity: z.enum(["info", "minor", "major", "blocking"]),
      file: z.string().optional(),
      line: z.number().int().nonnegative().optional(),
      rule: z.string().optional(),
      summary: z.string().min(1),
    })
    .strict(),
  "work.verdict": z
    .object({ verdict: z.enum(["PASS", "PARTIAL", "FAIL"]), summary: z.string().min(1), findings: z.array(z.unknown()).default([]) })
    .strict(),
  "work.proposal": z
    .object({
      proposal_class: z.enum([
        "self_activation",
        "terminate",
        "redirect",
        "skill_patch",
        "template_set_patch",
        "evaluation_request",
      ]),
      summary: z.string().min(1),
    })
    .strict(),
  "work.ack": z.object({ refs: z.array(OpaqueRef).min(1), decision: z.string().min(1) }).strict(),
  "control.steer": z.object({ instruction: z.string().min(1) }).strict(),
  "control.attention_requested": z
    .object({ reason: z.string().min(1), scope_refs: z.array(OpaqueRef).default([]), refs: z.array(OpaqueRef).default([]) })
    .strict(),
  "control.escalation": z.object({ reason: z.string().min(1) }).strict(),
  "system.continue": z.object({ reason: z.string().min(1) }).strict(),
  "system.done": z.object({ reason: z.string().min(1), outcome: z.string().min(1) }).strict(),
  "system.redirect": z.object({ instruction: z.string().min(1) }).strict(),
  "system.swap": z.object({ out: z.string().min(1), in: z.string().min(1), reason: z.string().min(1) }).strict(),
  "system.idle": z.object({ turns: z.number().int().nonnegative() }).strict(),
  "system.budget": z.object({ tokens: z.number().int().nonnegative(), threshold: z.number().int().nonnegative() }).strict(),
  "system.epoch_bump": z.object({ reason: z.string().min(1) }).strict(),
  "runtime.error": z
    .object({ error_code: z.string().min(1), likely_cause: z.string().min(1), rejected_body_hash: z.string().optional() })
    .strict(),
  "runtime.message_rejected": z.object({ error_code: z.string().min(1), detail: z.string().optional() }).strict(),
  "runtime.member_joined": z.object({ participant_ref: z.string().min(1), reason: z.string().min(1) }).strict(),
  "runtime.member_left": z.object({ participant_ref: z.string().min(1), reason: z.string().min(1) }).strict(),
  "runtime.delivery_failed": z.object({ target_ref: z.string().min(1), reason: z.string().min(1) }).strict(),
};

const AudienceSchema = z
  .object({
    action_targets: z.array(z.string().min(1)).max(64),
    visibility: z.enum(VISIBILITIES),
  })
  .strict();

/**
 * Full envelope. `schema_version` pins `xtrm.channel-message.v1`; `author`
 * and `seq`/message identity are host-assigned AFTER validation of the
 * caller's draft (drafts are validated against EnvelopeDraftSchema below).
 */
export const StoredEnvelopeSchema = z
  .object({
    schema_version: z.literal(CHANNEL_MESSAGE_SCHEMA_VERSION),
    channel_id: z.string().min(1),
    message_id: z.string().min(1),
    seq: z.number().int().positive(),
    author: z.object({ participant_id: z.string().min(1), participant_class: z.enum(PARTICIPANT_CLASSES) }).strict(),
    kind: z.enum(MESSAGE_KINDS),
    body: z.record(z.unknown()),
    audience: AudienceSchema,
    refs: z.record(z.unknown()).optional(),
    evidence_refs: z.array(OpaqueRef).optional(),
    correlation_id: z.string().min(1).optional(),
    idempotency_key: z.string().min(1),
    created_at_ms: z.number().int().nonnegative(),
  })
  .strict();
export type StoredEnvelope = z.infer<typeof StoredEnvelopeSchema>;

/** What a caller may hand to send(): NO author, NO server-assigned fields. */
export const EnvelopeDraftSchema = z
  .object({
    channel_id: z.string().min(1),
    kind: z.enum(MESSAGE_KINDS),
    body: z.record(z.unknown()),
    audience: AudienceSchema,
    refs: z.record(z.unknown()).optional(),
    evidence_refs: z.array(OpaqueRef).optional(),
    correlation_id: z.string().min(1).optional(),
    idempotency_key: z.string().min(1),
  })
  .strict();
export type EnvelopeDraft = z.infer<typeof EnvelopeDraftSchema>;

export interface ValidationProblem {
  /** Stable machine code, e.g. `unknown_kind`, `body_schema`, `authority_denied`. */
  code: string;
  path: string;
  message: string;
}

function problemsFromZod(error: z.ZodError, base: string): ValidationProblem[] {
  return error.issues.map((i) => ({
    code: i.code === "unrecognized_keys" ? "unknown_field" : i.code,
    path: base ? `${base}.${i.path.join(".")}` : i.path.join("."),
    message: i.message,
  }));
}

/**
 * Pure normalization/validation of a draft. Returns an ordered, deterministic
 * problem list (NormalizationError-style) instead of throwing; ops throw
 * ChannelValidationError built from these problems.
 */
export function normalizeDraft(draft: unknown): { ok: true; value: EnvelopeDraft } | { ok: false; problems: ValidationProblem[] } {
  const problems: ValidationProblem[] = [];
  const parsedDraft = EnvelopeDraftSchema.safeParse(draft);
  if (!parsedDraft.success) {
    problems.push(...problemsFromZod(parsedDraft.error, "draft"));
    // Draft-shape failure is terminal: everything else depends on it.
    return { ok: false, problems };
  }
  const value = parsedDraft.data;

  const bodyParsed = BODY_SCHEMAS[value.kind].safeParse(value.body);
  if (!bodyParsed.success) {
    problems.push(...problemsFromZod(bodyParsed.error, "body"));
  }

  for (const key of Object.keys(value.body)) {
    if ((FORBIDDEN_BODY_KEYS as readonly string[]).includes(key)) {
      problems.push({
        code: "body_authority_assertion",
        path: `body.${key}`,
        message: `body asserts authority-bearing field "${key}" (channels.md §10.1 step 5); rejected`,
      });
    }
  }

  // Routing hard: work.verdict is single-target (§5.3 verdict resolution).
  if (value.kind === "work.verdict" && value.audience.action_targets.length !== 1) {
    problems.push({
      code: "invalid_audience",
      path: "audience.action_targets",
      message: "work.verdict requires exactly one action_target (single-target verdicts, §5.3)",
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value };
}
