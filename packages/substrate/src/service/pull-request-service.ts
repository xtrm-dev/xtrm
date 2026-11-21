// Issue-to-PR links: the read model (XTRM-726) and the writers (XTRM-727).
//
// Writers never delete: a mention is a row, an unlink sets `superseded_at`,
// and every read filters superseded rows out. A T2 row is evidence that a
// commit carries the trailer (or, since XTRM-953, names the issue in its
// `(XTRM-938)` subject suffix, which is how `xt` writes one); a finding is an
// `issue_events` row of type `provenance.link_finding` and is reported, never
// thrown.

import { parseAllTrailers, subjectIssueRefs } from "../domain/provenance.ts";
import { withTransaction } from "../store/transactions.ts";
import type { DatabaseSync } from "../store/database.ts";
import {
  groupIssuePullRequests,
  type IssuePrCommitRow,
  type IssuePullRequestRow,
  type IssuePullRequestView,
  type PrLinkRelation,
  type PrLinkSource,
} from "../domain/pull-request.ts";
import type { WorkReceipt } from "../domain/provenance.ts";
import type { IssueService } from "./issue-service.ts";
import type { ProvenanceService } from "./provenance-service.ts";

interface PullRow {
  id: number;
  issue_id: string;
  repository: string;
  number: number;
  relation: string;
  source: string;
  url: string | null;
  actor: string | null;
  created_at: number;
}

interface CommitRow {
  issue_id: string;
  repository: string;
  number: number;
  sha: string;
  landed_sha: string | null;
  trailer_revision: number | null;
}

export interface CreateFromInput {
  issueId: string;
  ambientRepo: string | null;
  actor: string;
  receiptId?: string;
  holder?: string;
  now?: number;
}

export interface MentionInput {
  issueId: string;
  repository: string;
  number: number;
  url?: string | null;
  actor: string;
  source?: Exclude<PrLinkSource, "provenance">;
  now?: number;
}

export interface UnlinkInput {
  issueId: string;
  repository: string;
  number: number;
  relation?: PrLinkRelation;
  actor?: string;
  now?: number;
}

export interface CommitEvidence {
  sha: string;
  message: string;
}

export interface CommitLinkInput {
  issueId: string;
  repository: string;
  number: number;
  commits: CommitEvidence[];
  actor: string;
  now?: number;
}

export interface LinkFinding {
  id: number;
  issueId: string;
  code: string;
  repository: string | null;
  number: number | null;
  sha: string | null;
  detail: string | null;
  createdAt: number;
}

function all<T>(db: DatabaseSync, sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export class PullRequestService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService | null;
  private readonly provenance: ProvenanceService | null;

  constructor(db: DatabaseSync, issues?: IssueService, provenance?: ProvenanceService) {
    this.db = db;
    this.issues = issues ?? null;
    this.provenance = provenance ?? null;
  }

  /** Every PR linked to the issue: `created_from` first, then `created_at`,
   * with `rowid` as the tie-break the design requires. Superseded rows are
   * invisible. */
  listForIssue(issueId: string): IssuePullRequestView[] {
    const rows = all<PullRow>(
      this.db,
      `SELECT rowid AS id, issue_id, repository, number, relation, source, url, actor, created_at
         FROM issue_pull_requests WHERE issue_id = ? AND superseded_at IS NULL ORDER BY created_at, rowid`,
      issueId,
    ).map(
      (r): IssuePullRequestRow => ({
        id: r.id,
        issueId: r.issue_id,
        repository: r.repository,
        number: r.number,
        relation: r.relation as PrLinkRelation,
        source: r.source as PrLinkSource,
        url: r.url,
        actor: r.actor,
        createdAt: r.created_at,
      }),
    );
    const commits = all<CommitRow>(
      this.db,
      `SELECT issue_id, repository, number, sha, landed_sha, trailer_revision
         FROM issue_pr_commits WHERE issue_id = ? ORDER BY sha`,
      issueId,
    ).map(
      (r): IssuePrCommitRow => ({
        issueId: r.issue_id,
        repository: r.repository,
        number: r.number,
        sha: r.sha,
        landedSha: r.landed_sha,
        trailerRevision: r.trailer_revision,
      }),
    );
    const views = groupIssuePullRequests(rows, commits);
    for (const view of views) {
      const stateRow = this.db
        .prepare("SELECT state, state_source, title, merged_at FROM pull_requests WHERE repository = ? AND number = ?")
        .get(view.repository, view.number) as
        | { state: string; state_source: string | null; title: string | null; merged_at: number | null }
        | undefined;
      if (stateRow) {
        view.state = stateRow.state;
        view.stateSource = stateRow.state_source;
        view.title = stateRow.title;
        view.mergedAt = stateRow.merged_at;
      }
    }
    return views;
  }

  // -- writers (XTRM-727) ----------------------------------------------------

  /** T1: the PR is the outcome of this issue's work. Requires a receipt. */
  attachCreatedFrom(input: CreateFromInput, canonical: { repository: string; number: number; canonical: string; url: string }): IssuePullRequestView {
    const { issues, provenance } = this.requireWriters();
    const now = input.now ?? Date.now();
    const receipt = this.resolveReceipt(input.issueId, input.receiptId, input.holder, now);
    return withTransaction(this.db, () => {
      // attachArtifact owns a nested savepoint; the link row shares the outcome.
      provenance.attachArtifact(receipt.id, "pr", canonical.canonical, { provider: "github", now });
      if (this.insertLink(input.issueId, canonical.repository, canonical.number, "created_from", "provenance", canonical.url, input.actor, now)) {
        issues.appendEvent(input.issueId, "provenance.link_created", {
          repository: canonical.repository,
          number: canonical.number,
          receipt: receipt.id,
          relation: "created_from",
          actor: input.actor,
        }, now);
      }
      // PR-open state row (XTRM-754): a minimal pull_requests row so the PR is not
      // "state unknown" until the reconciler (728) refreshes full state. The row
      // records state_source='assumed': the opener cannot know more than "open".
      //
      // 'open' is what the opener knows: the shim calls this immediately after a
      // successful `gh pr create`, so the PR is open by construction. A LATE attach
      // (a merged PR linked after the fact, with no prior reconciler row) inherits
      // that assumption and reads "open" with no title until the next `sb links
      // sync` corrects it through the upsert. The alternative — a GitHub read
      // inside this transaction — would put the network in the write path and fail
      // closed on an outage, so the wrong-positive is preferred, bounded, and
      // healed by the same sync that backfills every other row.
      this.db.prepare(
        `INSERT OR IGNORE INTO pull_requests
           (repository, number, state, state_source, draft, head_sha, merge_commit_sha, title, url,
            base_ref, merged_at, closed_at, etag, last_modified, last_synced_at)
         VALUES (?, ?, 'open', 'assumed', 0, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
      ).run(canonical.repository, canonical.number, canonical.url, now);
      // Reading inside the transaction makes a failure roll the attach back.
      return this.requireView(input.issueId, canonical.repository, canonical.number);
    });
  }

  /** A persisted mention (source explicit in this slice). Idempotent. */
  linkMention(input: MentionInput): IssuePullRequestView {
    const { issues } = this.requireWriters();
    const now = input.now ?? Date.now();
    const source = input.source ?? "explicit";
    withTransaction(this.db, () => {
      if (this.insertLink(input.issueId, input.repository, input.number, "mentioned", source, input.url ?? null, input.actor, now)) {
        issues.appendEvent(input.issueId, "provenance.link_mentioned", {
          repository: input.repository,
          number: input.number,
          source,
          actor: input.actor,
        }, now);
      }
    });
    return this.requireView(input.issueId, input.repository, input.number);
  }

  /** Unlink supersedes; it never deletes. Returns the number of live rows closed. */
  unlink(input: UnlinkInput): number {
    const { issues } = this.requireWriters();
    const now = input.now ?? Date.now();
    const conditions = ["issue_id = ?", "repository = ?", "number = ?", "superseded_at IS NULL"];
    const params: Array<string | number> = [input.issueId, input.repository, input.number];
    if (input.relation) {
      conditions.push("relation = ?");
      params.push(input.relation);
    }
    return withTransaction(this.db, () => {
      const info = this.db
        .prepare(`UPDATE issue_pull_requests SET superseded_at = ? WHERE ${conditions.join(" AND ")}`)
        .run(now, ...params);
      const changed = Number(info.changes ?? 0);
      if (changed > 0) {
        issues.appendEvent(input.issueId, "provenance.link_unlinked", {
          repository: input.repository,
          number: input.number,
          relation: input.relation ?? null,
          rows: changed,
          actor: input.actor,
        }, now);
      }
      return changed;
    });
  }

  /** T2: every commit that names this issue in a trailer or a subject suffix. */
  linkCommits(input: CommitLinkInput): { created: number; mentioned: number; findings: number } {
    const { issues } = this.requireWriters();
    const now = input.now ?? Date.now();
    let created = 0;
    let mentioned = 0;
    let findings = 0;
    const finding = (code: string, sha: string, detail: string): void => {
      const duplicate = this.db
        .prepare(
          `SELECT 1 FROM issue_events
            WHERE issue_id = ? AND type = 'provenance.link_finding'
              AND json_extract(payload_json, '$.code') = ?
              AND json_extract(payload_json, '$.sha') = ?
              AND json_extract(payload_json, '$.repository') = ?
              AND json_extract(payload_json, '$.number') = ?
            LIMIT 1`,
        )
        .get(input.issueId, code, sha, input.repository, input.number);
      if (duplicate) return;
      findings += 1;
      issues.appendEvent(input.issueId, "provenance.link_finding", {
        code,
        repository: input.repository,
        number: input.number,
        sha,
        detail,
      }, now);
    };
    withTransaction(this.db, () => {
      for (const commit of input.commits) {
        const trailers = parseAllTrailers(commit.message);
        const named = [...new Set(trailers.issues.map((i) => i.issueId))];
        if (named.length === 0) {
          // No trailer: `xt` names its issue in the subject suffix (XTRM-953).
          // Resolve the suffix through the same path so one branch is linkable
          // without a message rewrite; a commit that carries an `XTRM-Issue:`
          // trailer never reaches here, because the trailer is authoritative.
          const suffixed = subjectIssueRefs(commit.message);
          if (suffixed.length === 0) continue;
          // `(XTRM-811.23)` and `(XTRM-949, XTRM-958)` are both real subjects, and the second
          // is the form `links check` enumerates happily while a single-ref rule drops the
          // commit: a reader disagreement, not an edge. Resolve every ref once, then decide on
          // the one that names THIS issue; only a commit that names several and none of them
          // this one is a multi-issue commit.
          const resolved: Array<{ id: string; ref: string }> = [];
          for (const ref of suffixed) {
            try {
              resolved.push({ id: issues.resolveRef(ref).id, ref });
            } catch {
              // Silent, per ref: an unresolvable ref in a subject is a typo, and a typo in a
              // commit that will not be edited is not evidence about this issue.
            }
          }
          const mine = resolved.filter((r) => r.id === input.issueId);
          if (mine.length === 0) {
            // One finding, not two: a commit naming several others is reported as a multi-issue
            // commit, and only a commit naming exactly one sibling is reported as claimed
            // elsewhere. Reporting both for one commit spends the reader's attention twice on
            // the same fact.
            if (resolved.length > 1) {
              finding("commit_multi_issue", commit.sha, `subject names ${resolved.map((r) => r.ref).join(", ")}, none of them this issue`);
              continue;
            }
            const other = resolved[0];
            if (other && issues.getIssue(other.id).projectId === issues.getIssue(input.issueId).projectId) {
              finding("commit_claimed_elsewhere", commit.sha, `subject names ${other.ref}, not this issue`);
            }
            continue;
          }
          if (resolved.length > 1 && mine.length === 1) {
            finding("commit_multi_issue_named", commit.sha, `subject names ${resolved.map((r) => r.ref).join(", ")}; this issue is named too`);
          }
          // A subject ref carries no receipt, so it can name the issue but not
          // attest a delivery: the link is a mention, as a receipt-less trailer
          // already is. No commit row is written, and that is not an omission:
          // `LinkGateService.evaluate` filters `created_from` links and asks for
          // `sources.includes("trailer") && commits > 0`, so a `mentioned` row
          // never reaches the filter with any commit count. Measured, not
          // reasoned - a subject-only link reports `gate_mentioned_only` with
          // and without the row (XTRM-953).
          if (this.mentionFromTrailer(input, now, commit.sha)) mentioned += 1;
          // A finding is an event, and `links check` re-derives it from the
          // `issue_events` row, so a re-run reports nothing new without the
          // finding becoming false. The counter stays idempotent because it
          // counts what this run did (XTRM-953).
          finding("subject_receipt_missing", commit.sha, "names the issue by subject suffix, carries no XTRM-Receipt trailer");
          continue;
        }
        // Two distinct trailer names are a multi-issue commit even when one
        // of them does not resolve in this Project.
        if (named.length > 1) {
          finding("commit_multi_issue", commit.sha, `commit names ${named.join(", ")}`);
          continue;
        }
        let resolvedId: string;
        try {
          resolvedId = issues.resolveRef(named[0]!).id;
        } catch {
          finding("trailer_issue_unknown", commit.sha, `no issue matches ${named[0]}`);
          continue;
        }
        if (resolvedId !== input.issueId) {
          // A trailer naming another issue in this Project is worth one finding, exactly as a
          // subject suffix naming a sibling is: it is evidence this issue's reader cannot see.
          if (issues.getIssue(resolvedId).projectId === issues.getIssue(input.issueId).projectId) {
            finding("commit_claimed_elsewhere", commit.sha, `trailer names ${named[0]}, not this issue`);
          }
          continue;
        }
        const revision = trailers.issues[0]?.issueRevision ?? null;
        const receiptId = trailers.receipts[0] ?? null;
        if (trailers.receipts.length === 0) {
          if (this.mentionFromTrailer(input, now, commit.sha)) mentioned += 1;
          finding("trailer_receipt_missing", commit.sha, "no XTRM-Receipt trailer");
          continue;
        }
        if (trailers.receipts.length > 1) {
          if (this.mentionFromTrailer(input, now, commit.sha)) mentioned += 1;
          finding("trailer_receipt_ambiguous", commit.sha, `receipts: ${trailers.receipts.join(", ")}`);
          continue;
        }
        const verdict = this.classifyReceipt(receiptId!, input.issueId);
        if (!verdict.ok) {
          if (this.mentionFromTrailer(input, now, commit.sha)) mentioned += 1;
          // Trailer path keeps its own code namespace; stale stays shared.
          const code = verdict.code === "receipt_unknown"
            ? "trailer_receipt_unknown"
            : verdict.code === "receipt_foreign_issue"
              ? "trailer_receipt_foreign_issue"
              : verdict.code === "receipt_superseded"
                ? "trailer_receipt_superseded"
                : verdict.code;
          finding(code, commit.sha, verdict.detail);
          continue;
        }
        const existing = this.db
          .prepare("SELECT issue_id FROM issue_pr_commits WHERE repository = ? AND number = ? AND sha = ?")
          .get(input.repository, input.number, commit.sha) as { issue_id: string } | undefined;
        if (existing && existing.issue_id !== input.issueId) {
          finding("commit_claimed_twice", commit.sha, `already claimed by ${existing.issue_id}`);
          continue;
        }
        if (this.insertCommit(input.issueId, input.repository, input.number, commit.sha, revision)) {
          if (this.insertLink(input.issueId, input.repository, input.number, "created_from", "trailer", null, input.actor, now)) {
            created += 1;
            issues.appendEvent(input.issueId, "provenance.link_created", {
              repository: input.repository,
              number: input.number,
              receipt: receiptId,
              relation: "created_from",
              sha: commit.sha,
              actor: input.actor,
            }, now);
          }
        }
      }
    });
    return { created, mentioned, findings };
  }

  /** Findings are events, not a table; they are reported, never thrown. */
  listFindings(projectId: string, limit = 20): LinkFinding[] {
    return all<{ id: number; issue_id: string; payload_json: string; created_at: number }>(
      this.db,
      `SELECT e.id, e.issue_id, e.payload_json, e.created_at
         FROM issue_events e JOIN issues i ON i.id = e.issue_id
        WHERE i.project_id = ? AND e.type = 'provenance.link_finding'
        ORDER BY e.id DESC LIMIT ?`,
      projectId,
      limit,
    ).map((r) => {
      const payload = JSON.parse(r.payload_json) as Record<string, unknown>;
      return {
        id: r.id,
        issueId: r.issue_id,
        code: String(payload["code"] ?? "unknown"),
        repository: (payload["repository"] as string | null) ?? null,
        number: typeof payload["number"] === "number" ? payload["number"] : null,
        sha: (payload["sha"] as string | null) ?? null,
        detail: (payload["detail"] as string | null) ?? null,
        createdAt: r.created_at,
      };
    });
  }

  // -- internals -------------------------------------------------------------

  private requireWriters(): { issues: IssueService; provenance: ProvenanceService } {
    if (this.issues === null || this.provenance === null) {
      throw new Error("PR link writers need IssueService and ProvenanceService");
    }
    return { issues: this.issues, provenance: this.provenance };
  }

  private insertLink(
    issueId: string,
    repository: string,
    number: number,
    relation: PrLinkRelation,
    source: PrLinkSource,
    url: string | null,
    actor: string | null,
    now: number,
  ): boolean {
    const live = this.db
      .prepare(
        `SELECT 1 FROM issue_pull_requests
          WHERE issue_id = ? AND repository = ? AND number = ? AND relation = ? AND source = ?
            AND superseded_at IS NULL`,
      )
      .get(issueId, repository, number, relation, source);
    if (live) return false;
    // A superseded row is restored, never duplicated: the PK is fixed, so
    // insert-or-ignore would silently do nothing and the caller would fail.
    const info = this.db
      .prepare(
        `INSERT INTO issue_pull_requests
           (issue_id, repository, number, relation, source, url, actor, created_at, superseded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (issue_id, repository, number, relation, source)
         DO UPDATE SET superseded_at = NULL`,
      )
      .run(issueId, repository, number, relation, source, url, actor, now);
    return Number(info.changes ?? 0) > 0;
  }

  private insertCommit(issueId: string, repository: string, number: number, sha: string, revision: number | null): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO issue_pr_commits
           (issue_id, repository, number, sha, landed_sha, trailer_revision)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(issueId, repository, number, sha, revision);
    return Number(info.changes ?? 0) > 0;
  }

  /**
   * A mention link, and whether this call is the one that created it. The boolean is load-bearing:
   * the `gh` shim re-runs the same observation, and a counter that adds for an already-present row
   * reports a delta that did not happen.
   */
  private mentionFromTrailer(input: CommitLinkInput, now: number, sha: string): boolean {
    const created = this.insertLink(input.issueId, input.repository, input.number, "mentioned", "trailer", null, input.actor, now);
    if (created) {
      this.issues!.appendEvent(input.issueId, "provenance.link_mentioned", {
        repository: input.repository,
        number: input.number,
        source: "trailer",
        sha,
        actor: input.actor,
      }, now);
    }
    return created;
  }

  private classifyReceipt(receiptId: string, issueId: string): { ok: true; receipt: WorkReceipt } | { ok: false; code: string; detail: string } {
    const { provenance } = this.requireWriters();
    let receipt: WorkReceipt;
    try {
      receipt = provenance.getReceipt(receiptId);
    } catch {
      return { ok: false, code: "receipt_unknown", detail: `unknown receipt ${receiptId}` };
    }
    if (receipt.issueId !== issueId) {
      return { ok: false, code: "receipt_foreign_issue", detail: `receipt belongs to ${receipt.issueId}` };
    }
    if (this.receiptSuperseded(receipt)) {
      return { ok: false, code: "receipt_superseded", detail: `a newer receipt exists on ${receipt.executionBindingId}` };
    }
    const binding = provenance.getBinding(receipt.executionBindingId);
    const currentRevision = this.issues!.getIssue(issueId).currentRevision;
    if (binding.issueRevision !== currentRevision) {
      return {
        ok: false,
        code: "receipt_stale_revision",
        detail: `receipt is bound to revision ${binding.issueRevision}, issue is at ${currentRevision}`,
      };
    }
    return { ok: true, receipt };
  }

  private receiptSuperseded(receipt: WorkReceipt): boolean {
    const { provenance } = this.requireWriters();
    const same = provenance
      .listReceipts(receipt.issueId)
      .filter((r) => r.executionBindingId === receipt.executionBindingId);
    const latest = same[same.length - 1];
    return latest !== undefined && latest.id !== receipt.id;
  }

  /** b1 explicit -> b2 live claim binding -> b3 latest live binding. */
  private resolveReceipt(issueId: string, explicit: string | undefined, holder: string | undefined, now: number): WorkReceipt {
    const { issues, provenance } = this.requireWriters();
    if (explicit !== undefined) {
      const verdict = this.classifyReceipt(explicit, issueId);
      if (!verdict.ok) throw new Error(`${verdict.code}: ${verdict.detail}`);
      return verdict.receipt;
    }
    let chosen: WorkReceipt | undefined;
    if (holder !== undefined) {
      const claim = issues.getActiveClaim(issueId, { now });
      if (claim && claim.holder === holder) {
        const binding = provenance.listBindings(issueId).filter((b) => b.claimId === claim.id).at(-1);
        if (binding) {
          chosen = provenance
            .listReceipts(issueId)
            .filter((r) => r.executionBindingId === binding.id)
            .at(-1);
        }
      }
    }
    if (chosen === undefined) chosen = provenance.listReceipts(issueId).at(-1);
    if (chosen === undefined) {
      const hasBinding = provenance.listBindings(issueId).length > 0;
      throw new Error(
        hasBinding
          ? "no_receipt: no receipt for this issue; run `sb provenance allocate <ref>` first"
          : "no_receipt: no receipt for this issue; run `sb provenance dispatch <ref>` first",
      );
    }
    const verdict = this.classifyReceipt(chosen.id, issueId);
    if (!verdict.ok) throw new Error(`${verdict.code}: ${verdict.detail}`);
    return verdict.receipt;
  }

  private requireView(issueId: string, repository: string, number: number): IssuePullRequestView {
    const view = this.listForIssue(issueId).find((v) => v.repository === repository && v.number === number);
    if (!view) throw new Error(`link not found: ${repository}#${number}`);
    return view;
  }
}
