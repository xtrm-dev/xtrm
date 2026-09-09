// Resume capsules (PRD §21): bounded derived projections for continuity.
// A capsule reconstructs current contract + latest checkpoint + deltas; it
// is rendered on demand and never becomes another mutable source of truth.
// Root-epic resume (§22) summarizes child state by reference — child
// transcripts and child journal bodies are never copied in.

import type { DatabaseSync } from "node:sqlite";
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
      try {
        const latest = this.journal.latestCheckpoint(c.id);
        checkpointRef = latest ? `${latest.id}#${latest.sequence}` : null;
      } catch {
        checkpointRef = null;
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
      };
    });
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
        lines.push(`- ${ch.locator} ${ch.humanRef} ${ch.lifecycleState} rev${ch.revision} @${ch.checkpointRef ?? "no-checkpoint"}${blocked}`);
      }
    }
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
