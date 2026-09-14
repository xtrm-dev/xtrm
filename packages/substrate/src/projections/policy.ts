// Selective outbound projection policy (ADR §60, P1).
//
// Allowlist, not blocklist: only important findings, decisions, results,
// closures and high-value notes project to external surfaces (GitHub/Jira).
// Mechanical checkpoints, compaction checkpoints and low-level runtime
// events never project. Remote comments remain coordination data and never
// become executable authority (ADR §61).
//
// Pure functions over journal kinds + closure presence; the enforcement
// point is IntegrationService.enqueueJournalProjection, which refuses
// non-projectable entries before touching the outbox.

import type { JournalKind } from "../domain/journal.ts";

export const PROJECTABLE_JOURNAL_KINDS: readonly JournalKind[] = ["finding", "decision", "result"];

// Journal kinds that are resumability mechanics, never external content.
export const MECHANICAL_JOURNAL_KINDS: readonly JournalKind[] = ["checkpoint", "compaction"];

// Low-level runtime/transport event types that must never project. Anything
// not on the projectable allowlist is excluded by default; this list names
// the explicitly-known mechanical events so a future allowlist widening
// cannot silently admit them.
export const NON_PROJECTABLE_EVENT_TYPES: readonly string[] = [
  "journal.checkpoint_degraded",
  "journal.checkpoint_enriched",
  "journal.appended",
  "projection.enqueued",
  "projection.pushed",
  "projection.drift",
  "external.uncertain",
  "external_binding.created",
  "provenance.dispatched",
  "provenance.receipt_allocated",
  "provenance.receipt_bound",
  "provenance.receipt_rewritten",
  "provenance.artifact_attached",
  "issue.lifecycle",
  "claim.acquired",
  "claim.released",
  "claim.expired",
  "activation.cancelled",
];

export interface ProjectionCandidate {
  kind: JournalKind;
  /** Evidence refs carried by the entry (empty = bare prose). */
  refCount: number;
}

/**
 * A bare `note` projects only when high-value: it carries evidence refs.
 * A note with no refs is ordinary coordination chatter and stays local.
 * Findings, decisions and results always project; mechanical kinds never do;
 * milestone/handoff/blocker stay local (selective allowlist, ADR §60).
 */
export function shouldProjectJournalEntry(candidate: ProjectionCandidate): { project: boolean; reason: string } {
  if ((MECHANICAL_JOURNAL_KINDS as readonly string[]).includes(candidate.kind)) {
    return { project: false, reason: `mechanical kind "${candidate.kind}" never projects (ADR §60)` };
  }
  if ((PROJECTABLE_JOURNAL_KINDS as readonly string[]).includes(candidate.kind)) {
    return { project: true, reason: `${candidate.kind} projects (ADR §60)` };
  }
  if (candidate.kind === "note") {
    if (candidate.refCount > 0) return { project: true, reason: "high-value note with evidence refs projects (ADR §60)" };
    return { project: false, reason: "ordinary note without evidence stays local (ADR §60)" };
  }
  return { project: false, reason: `kind "${candidate.kind}" is outside the projection allowlist (ADR §60)` };
}

/** Closures always project: the terminal outcome is the highest-value external fact. */
export function shouldProjectClosure(): { project: boolean; reason: string } {
  return { project: true, reason: "closure projects (ADR §60)" };
}

/** Runtime/transport event types never project, even when journal-adjacent. */
export function isProjectableEventType(type: string): boolean {
  if ((NON_PROJECTABLE_EVENT_TYPES as readonly string[]).includes(type)) return false;
  return type.startsWith("external.comment_received") || type === "issue.closed";
}
