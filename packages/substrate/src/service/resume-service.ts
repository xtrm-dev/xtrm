// Resume capsules (PRD §21): bounded derived projections for continuity.
// A capsule reconstructs current contract + latest checkpoint + deltas; it
// is rendered on demand and never becomes another mutable source of truth.
// Root-epic resume (§22) summarizes child state by reference — child
// transcripts and child journal bodies are never copied in.

import type { DatabaseSync } from "../store/database.ts";
import type { IssueService } from "./issue-service.ts";
import type { JournalService } from "./journal-service.ts";
import type { JournalEntry } from "../domain/journal.ts";
import type { IssueClaim } from "../domain/claim.ts";

export interface ChildCapsuleSummary {
  issueId: string;
  humanRef: string;
  locator: string;
  title: string;
  lifecycleState: string;
  revision: number;
  checkpointRef: string | null;
  blockedBy: string[];
  // Reference + bounded outcome only: a coordinator capsule recovers that a
  // child produced a result without copying the child's Journal body (§22, §51).
  latestResult: { ref: string; outcome: string | null } | null;
}

// Own-issue bounded result projection (§29, §39). The summary is the bounded
// result summary, never a raw model dump.
export interface ResultRef {
  entryId: string;
  sequence: number;
  summary: string;
  outcome: string | null;
  artifactRefs: string[];
  receiptRefs: string[];
}

export interface DecisionRef {
  entryId: string;
  sequence: number;
  summary: string;
}

// Derived release view (ADR §51 programme/release state). Closure persistence
// is owned elsewhere; this is a bounded projection over live durable state.
export interface ReleaseState {
  lifecycleState: string;
  blockers: string[];
  childrenDone: number;
  childrenTotal: number;
  allChildrenDone: boolean | null;
}

export interface ResumeCapsule {
  issueId: string;
  humanRef: string;
  locator: string;
  title: string;
  kind: string;
  lifecycleState: string;
  revision: number;
  contractHash: string;
  contract: unknown;
  readiness: { state: string; dispatchable: boolean; reasons: string[] };
  resolvedContext: { hash: string; entryCount: number };
  latestCheckpoint: JournalEntry | null;
  delta: { afterSequence: number; entries: JournalEntry[]; nextCursor: number };
  children: ChildCapsuleSummary[];
  results: ResultRef[];
  criticalDecisions: DecisionRef[];
  release: ReleaseState;
  blockers: string[];
  claim: IssueClaim | null;
  asks: string[];
  provenance: { eventCount: number; recent: Array<{ type: string; createdAt: number }> };
  git: { baseCommit: string | null; headCommit: string | null; changedFiles: string[] } | null;
  external: Array<{ provider: string; scope: string; remoteId: string; url?: string | null }>;
  renderedAt: number;
}

interface ExternalProvider {
  listBindings(issueId: string): Array<{ provider: string; remoteScope: string; remoteId: string; url?: string | null }>;
}

// Bounded windows for the capsule: a resume reconstructs high-signal state,
// never a dump of the whole journal.
const CAPSULE_RESULT_LIMIT = 5;
const CAPSULE_DECISION_LIMIT = 5;

export class ResumeService {
  private readonly issues: IssueService;
  private readonly journal: JournalService;
  private readonly external: ExternalProvider | null;

  constructor(_db: DatabaseSync, issues: IssueService, journal: JournalService, opts?: { external?: ExternalProvider }) {
    this.issues = issues;
    this.journal = journal;
    this.external = opts?.external ?? null;
  }

  buildCapsule(issueId: string): ResumeCapsule {
    const issue = this.issues.getIssue(issueId);
    const revision = this.issues.getRevision(issueId, issue.currentRevision);
    const readiness = this.issues.getReadiness(issueId);
    const resolved = this.issues.getResolvedContext(issueId);
    const latestCheckpoint = this.journal.latestCheckpoint(issueId);
    const delta = this.journal.since(issueId, latestCheckpoint?.sequence ?? 0);
    const children: ChildCapsuleSummary[] = this.issues.listChildren(issueId).map((c) => {
      let checkpointRef: string | null = null;
      let latestResult: { ref: string; outcome: string | null } | null = null;
      try {
        const latest = this.journal.latestCheckpoint(c.id);
        checkpointRef = latest ? `${latest.id}#${latest.sequence}` : null;
      } catch {
        checkpointRef = null;
      }
      try {
        const result = this.journal.latest(c.id, { kind: "result" });
        latestResult = result ? { ref: `${result.id}#${result.sequence}`, outcome: result.result?.outcome ?? null } : null;
      } catch {
        latestResult = null;
      }
      return {
        issueId: c.id,
        humanRef: c.humanRef,
        locator: c.locator,
        title: c.title,
        lifecycleState: c.lifecycleState,
        revision: c.currentRevision,
        checkpointRef,
        blockedBy: this.issues.unsatisfiedBlockers(c.id),
        latestResult,
      };
    });
    const results: ResultRef[] = this.journal.timeline(issueId, { kind: "result", limit: CAPSULE_RESULT_LIMIT }).map((e) => ({
      entryId: e.id,
      sequence: e.sequence,
      summary: e.result?.summary ?? "",
      outcome: e.result?.outcome ?? null,
      artifactRefs: e.result?.artifactRefs ?? [],
      receiptRefs: e.result?.receiptRefs ?? [],
    }));
    const criticalDecisions: DecisionRef[] = this.journal
      .timeline(issueId, { kind: "decision", limit: CAPSULE_DECISION_LIMIT })
      .map((e) => ({ entryId: e.id, sequence: e.sequence, summary: e.semantic?.summary ?? "" }));
    const blockers = this.issues.unsatisfiedBlockers(issueId);
    const childrenDone = children.filter((c) => c.lifecycleState === "done").length;
    const release: ReleaseState = {
      lifecycleState: issue.lifecycleState,
      blockers,
      childrenDone,
      childrenTotal: children.length,
      allChildrenDone: children.length === 0 ? null : childrenDone === children.length,
    };
    const asks = dedupe([
      ...(latestCheckpoint?.mechanical?.pendingAsks ?? []),
      ...(latestCheckpoint?.semantic?.openQuestions ?? []),
    ]);
    const events = this.issues.listEvents(issueId);
    const m = latestCheckpoint?.mechanical;
    return {
      issueId,
      humanRef: issue.humanRef,
      locator: issue.locator,
      title: issue.title,
      kind: issue.kind,
      lifecycleState: issue.lifecycleState,
      revision: issue.currentRevision,
      contractHash: issue.currentContractHash,
      contract: revision.contract,
      readiness: { state: readiness.state, dispatchable: readiness.dispatchable, reasons: readiness.reasons },
      resolvedContext: { hash: resolved.hash, entryCount: resolved.entries.length },
      latestCheckpoint,
      delta: { afterSequence: delta.afterSequence, entries: delta.entries, nextCursor: delta.nextCursor },
      children,
      results,
      criticalDecisions,
      release,
      blockers: this.issues.unsatisfiedBlockers(issueId),
      claim: this.issues.getActiveClaim(issueId),
      asks,
      provenance: {
        eventCount: events.length,
        recent: events.slice(-10).map((e) => ({ type: e.type, createdAt: e.createdAt })),
      },
      git:
        m?.baseCommit || m?.headCommit || (m?.changedFiles?.length ?? 0) > 0
          ? { baseCommit: m?.baseCommit ?? null, headCommit: m?.headCommit ?? null, changedFiles: m?.changedFiles ?? [] }
          : null,
      external: (this.external?.listBindings(issueId) ?? []).map((b) => ({
        provider: b.provider,
        scope: b.remoteScope,
        remoteId: b.remoteId,
        url: b.url ?? null,
      })),
      renderedAt: Date.now(),
    };
  }

  // Text shape follows the §21 conceptual result. Child state renders as
  // one line per child (reference + projection); bodies stay out (§22).
  renderCapsule(c: ResumeCapsule): string {
    const contract = c.contract as { problem?: unknown; success?: unknown };
    const lines = [
      `ISSUE ${c.humanRef} (${c.locator}) @ revision ${c.revision} [${c.lifecycleState}]`,
      "",
      "CURRENT CONTRACT",
      String(contract.problem ?? "(no problem)"),
      String(contract.success ?? "(no success)"),
      "",
      "LATEST CHECKPOINT",
      c.latestCheckpoint ? `${c.latestCheckpoint.id} seq${c.latestCheckpoint.sequence} ${c.latestCheckpoint.kind}` : "(none yet)",
    ];
    const s = c.latestCheckpoint?.semantic;
    if (s?.summary) lines.push("", "SUMMARY", s.summary);
    if (s) {
      if (s.completed?.length) lines.push("", "DONE", ...s.completed.map((e) => `- ${e}`));
      if (s.current) lines.push("", "CURRENT", s.current);
      if (s.next?.length) lines.push("", "NEXT", ...s.next.map((e) => `- ${e}`));
    }
    lines.push("", "BLOCKERS / OPEN QUESTIONS");
    const blocks = [...c.blockers.map((b) => `blocked by ${b}`), ...c.asks.map((a) => `ask: ${a}`)];
    lines.push(...(blocks.length > 0 ? blocks.map((b) => `- ${b}`) : ["(none)"]));
    if (c.children.length > 0) {
      lines.push("", "CHILDREN");
      for (const ch of c.children) {
        const blocked = ch.blockedBy.length > 0 ? ` blocked by ${ch.blockedBy.join(",")}` : "";
        const result = ch.latestResult ? ` result@${ch.latestResult.ref}${ch.latestResult.outcome ? ` (${ch.latestResult.outcome})` : ""}` : "";
        lines.push(`- ${ch.locator} ${ch.humanRef} ${ch.lifecycleState} rev${ch.revision} @${ch.checkpointRef ?? "no-checkpoint"}${result}${blocked}`);
      }
    }
    lines.push("", "RESULTS");
    lines.push(
      ...(c.results.length > 0
        ? c.results.map((r) => `- seq${r.sequence}${r.outcome ? ` ${r.outcome}` : ""}: ${truncate(r.summary, 500)}`)
        : ["(none)"]),
    );
    lines.push("", "CRITICAL DECISIONS");
    lines.push(
      ...(c.criticalDecisions.length > 0
        ? c.criticalDecisions.map((d) => `- seq${d.sequence}: ${truncate(d.summary, 500)}`)
        : ["(none)"]),
    );
    lines.push("", "RELEASE");
    lines.push(
      `state ${c.release.lifecycleState}; children done ${c.release.childrenDone}/${c.release.childrenTotal}; ${c.release.blockers.length > 0 ? `blockers ${c.release.blockers.join(",")}` : "no blockers"}`,
    );
    lines.push(
      "",
      "CHANGES SINCE CHECKPOINT",
      `${c.delta.entries.length} journal entries, ${c.provenance.eventCount} events total`,
      ...(c.claim ? [`claim held by ${c.claim.holder}`] : ["no active claim"]),
    );
    lines.push("", "EXTERNAL");
    lines.push(
      ...(c.external.length > 0
        ? c.external.map((e) => `- ${e.provider} ${e.scope}/${e.remoteId}${e.url ? ` ${e.url}` : ""}`)
        : ["(none)"]),
    );
    if (c.git?.headCommit) lines.push(`git head ${c.git.headCommit}`);
    return lines.join("\n");
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v !== ""))];
}

// Capsule text stays bounded even when a result summary is long (§39).
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
