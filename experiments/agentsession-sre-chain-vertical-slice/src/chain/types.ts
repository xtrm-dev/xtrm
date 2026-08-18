/**
 * Core type definitions for the vertical-slice.
 * Every persisted-state shape lives here so the reducer stays pure.
 */

/** Stable role identity — used in system prompts, tool authority, kind allowlists. */
export type ParticipantRole =
  | "chain-coordinator"
  | "explorer"
  | "observability-analyst"
  | "sre-diagnostician"
  | "reviewer";

/** Runtime class — determines gate/advisor/step/coordinator semantics. */
export type ParticipantClass = "coordinator" | "advisor" | "step" | "gate";

/** Chain participant node (topology, frozen once resolved). */
export interface ChainStep {
  step_id: string;
  role: ParticipantRole;
  class: ParticipantClass;
  needs: string[]; // step_ids that must produce evidence first
  model: string; // provider/model-id
  fallback_model?: string;
}

/** ResolvedChain — immutable topology approved before run. */
export interface ResolvedChain {
  chain_id: string;
  root_bead_id: string;
  topology: ChainStep[];
  entry_step_id: string;
  close_step_id: string;
  reviewer_step_id: string;
  diagnostician_step_id: string;
  created_at: string; // ISO
  fingerprint: {
    pi_package: { name: string; version: string };
    beads_version: string;
    experiment_source_dir: string;
    experiment_source_dirty: boolean;
    experiment_commit?: string;
    baseline_specialists: Array<{ path: string; sha256: string }>;
  };
}

/** Beads mapping — chain_id + step_id → bd issue id.
 *
 * `chain_epic_id` is the ChainRun Epic materialized in the experiment's
 * sandbox beads DB. Every step bead is a NATIVE child of this Epic
 * (`bd q --parent`). Step-to-step readiness is expressed as real
 * `blocked-by` dep edges between step beads only — NOT between step and
 * Epic (that fake edge was what forced `bd close --force`).
 *
 * `external_root_bead_ref` is an opaque reference to the originating bead
 * in the real project's beads DB. Provenance only — never queried
 * cross-DB and never used as a blocking parent.
 *
 * `root_bead_id` is a legacy alias kept for reading older beads-map.json
 * files produced before the reconciliation pass. New code writes
 * `chain_epic_id`; readers may fall back to `root_bead_id`.
 */
export interface BeadsMap {
  chain_epic_id: string;
  step_bead_ids: Record<string, string>;
  external_root_bead_ref?: string;
  root_bead_id?: string;
}

/** Per-step execution attempt bookkeeping. */
export interface StepExecutionState {
  step_id: string;
  participant_id: string;
  attempts: number;
  status:
    | "waiting"
    | "ready"
    | "dispatched"
    | "running"
    | "produced_result"
    | "satisfied"
    | "failed"
    | "escalated";
  last_execution_id?: string;
  last_pi_session_id?: string;
  last_error?: string;
  last_agent_end_at?: string; // ISO
  last_satisfied_at?: string;
  remediation_loops: number; // for reviewer PARTIAL → diagnostician
}

/** Chain-level status. */
export type ChainStatus =
  | "initialized"
  | "running"
  | "blocked"
  | "escalated"
  | "closed_pass"
  | "closed_fail"
  | "closed_inconclusive";

/** Durable run state (persisted; input to reducer). */
export interface RunState {
  chain_run_id: string;
  chain_id: string;
  status: ChainStatus;
  steps: Record<string, StepExecutionState>;
  last_reduce_at: string; // ISO
  processed_intent_keys: string[]; // idempotency cache
  reviewer_verdict?: "PASS" | "PARTIAL" | "FAIL";
  close_reason?: string;
}

/** Evidence descriptor (pointer-first). */
export interface EvidenceEnvelope {
  evidence_id: string;
  chain_id: string;
  producer_participant_id: string;
  producer_role: ParticipantRole;
  step_id: string;
  execution_id: string;
  kind:
    | "topology.map"
    | "observability.snapshot"
    | "diagnostician.report"
    | "reviewer.verdict"
    | "coordinator.decision"
    | "sre_exec.result";
  summary: string; // one-line ≤300 chars
  schema_version: 1;
  body_ref: string; // relative path under evidence/
  created_at: string; // ISO
  scope_refs: string[];
}

/** Channel message envelope (spec §7). */
export type MessageKind =
  | "work.turn"
  | "work.finding"
  | "work.verdict"
  | "work.proposal"
  | "work.ack"
  | "control.attention_requested"
  | "control.escalation"
  | "system.continue"
  | "system.redirect"
  | "system.done"
  | "runtime.error"
  | "runtime.message_rejected";

export interface MessageAudience {
  visibility: "chain" | "private";
  action_targets: string[]; // participant_ids
  suggested_watchers?: string[];
  scope_refs?: string[];
  urgency?: "low" | "normal" | "high";
}

export interface MessageAuthor {
  participant_id: string;
  participant_role: ParticipantRole | "runtime" | "reviewer_policy";
  execution_id?: string;
}

export interface WorkRefs {
  author_issue_id?: string;
  target_issue_ids?: string[];
  relation_hints?: string[];
}

export interface MessageEnvelope {
  channel_id: string;
  id: number; // host-assigned, monotonic per channel
  author: MessageAuthor;
  kind: MessageKind;
  audience: MessageAudience;
  work_refs?: WorkRefs;
  body: Record<string, unknown>;
  evidence_refs?: string[];
  forensic_event_ids?: string[];
  created_at: string; // ISO
}

/** Per-participant cursor state (spec §7 read ≠ ack). */
export interface ParticipantCursor {
  participant_id: string;
  last_read_id: number;
  last_acked_id: number;
}

/** Scheduler intent (idempotent). */
export type SchedulerIntentKind =
  | "dispatch"
  | "resume"
  | "wait"
  | "escalate"
  | "terminalize";

export interface SchedulerIntent {
  kind: SchedulerIntentKind;
  participant_id: string;
  step_id: string;
  attempt: number;
  idempotency_key: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

/** Snapshot the reducer consumes (built by projection, never persisted directly). */
export interface EvidenceProjection {
  by_step: Record<string, EvidenceEnvelope[]>;
  by_kind: Record<string, EvidenceEnvelope[]>;
}

export interface ChannelProjection {
  last_message_id: number;
  outstanding_verdict?: EvidenceEnvelope; // last reviewer verdict evidence
  escalation_pending: boolean;
  system_done_seen: boolean;
}

export interface AuthoritativeInputs {
  chain: ResolvedChain;
  runState: RunState;
  evidence: EvidenceProjection;
  channel: ChannelProjection;
  now: string;
}

export interface ReduceOutput {
  newRunState: RunState;
  intents: SchedulerIntent[];
  logs: RuntimeFact[];
}

/** Structured runtime fact (§13 stdout is a rendering of these). */
export interface RuntimeFact {
  ts: string;
  chain_id: string;
  participant_id?: string;
  role?: ParticipantRole | "runtime";
  step_id?: string;
  kind:
    | "chain.ready"
    | "step.ready"
    | "step.start"
    | "step.done"
    | "step.failed"
    | "step.satisfied"
    | "reviewer.verdict"
    | "coordinator.action"
    | "escalation"
    | "message.rejected"
    | "chain.close";
  detail: string;
  meta?: Record<string, unknown>;
}

/** Participant identity assembled by host (spec §5). */
export interface ParticipantIdentity {
  chain_id: string;
  step_id: string;
  step_bead_id: string;
  role: ParticipantRole;
  class: ParticipantClass;
  participant_id: string;
  execution_id: string;
  attempt: number;
  parent_execution_id?: string;
}

/** Design-inputs fingerprint (spec §18). */
export interface DesignInputsFingerprint {
  produced_at: string;
  target_repo_path: string;
  target_repo_commit?: string;
  target_repo_dirty?: boolean;
  root_bead_id: string;
  pi_package: { name: string; version: string; resolved_from: string };
  beads: { version: string };
  experiment: {
    source_dir: string;
    commit?: string;
    dirty?: boolean;
  };
  baseline_specialists: Array<{ path: string; sha256: string; size: number }>;
}
