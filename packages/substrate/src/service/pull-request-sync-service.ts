// One-shot reconciler for issue-to-PR links (design note 11-11, XTRM-728).
//
// Trailer-first: commits go through XTRM-727's `linkCommits` (T1/T2 evidence,
// its findings, its receipt guards). Title, branch and body are weak evidence
// and become `mentioned` rows with their source. Pull-request state is stored
// separately in `pull_requests`; the link rows are never rewritten.

import { execFileSync } from "node:child_process";
import type { DatabaseSync } from "../store/database.ts";
import { withTransaction } from "../store/transactions.ts";
import { commitIssueRefs } from "../domain/provenance.ts";
import {
  issueRefsIn,
  parseGhInclude,
  type PullRequestCommit,
  type PullRequestObservation,
  type PullRequestSource,
  type PullRequestState,
} from "../domain/pull-request-state.ts";
import type { PrLinkSource } from "../domain/pull-request.ts";
import type { IssueService } from "./issue-service.ts";
import type { PullRequestService } from "./pull-request-service.ts";

export interface SyncInput {
  projectId: string;
  repositories: string[];
  limit?: number;
  since?: string | null;
  dryRun?: boolean;
  actor: string;
  now?: number;
  onlyPr?: { repository: string; number: number } | null;
}

export interface SyncReport {
  dryRun: boolean;
  repositories: number;
  scanned: number;
  created: number;
  mentioned: number;
  findings: SyncFinding[];
  findingCount: number;
  failures: number;
  skipped: number;
  truncated: number;
}

export interface SyncFinding {
  repository: string;
  number: number;
  code: string;
  detail: string;
}

interface PullRow {
  etag: string | null;
  last_modified: string | null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : time;
}

/** One-line run summary; the findings number is `findingCount`, so a
 * PR-level finding on an unlinked PR is visible in text, not only JSON. */
export function syncReportText(report: SyncReport): { summary: string; detail: string } {
  return {
    summary: `LINKS SYNC — ${report.repositories} repo(s) · ${report.scanned} PR(s) · ${report.dryRun ? "dry run" : "written"}`,
    detail: `created_from ${report.created} · mentioned ${report.mentioned} · findings ${report.findingCount} · skipped ${report.skipped} · failures ${report.failures} · truncated ${report.truncated}`,
  };
}

export class PullRequestSyncService {
  private readonly db: DatabaseSync;
  private readonly issues: IssueService;
  private readonly links: PullRequestService;
  private readonly source: PullRequestSource;

  constructor(db: DatabaseSync, issues: IssueService, links: PullRequestService, source: PullRequestSource) {
    this.db = db;
    this.issues = issues;
    this.links = links;
    this.source = source;
  }

  sync(input: SyncInput): SyncReport {
    const now = input.now ?? Date.now();
    const limit = input.limit ?? 30;
    const since = input.since ? Date.parse(input.since) : null;
    const report: SyncReport = {
      dryRun: input.dryRun === true,
      repositories: 0,
      scanned: 0,
      created: 0,
      mentioned: 0,
      findings: [],
      findingCount: 0,
      failures: 0,
      skipped: 0,
      truncated: 0,
    };
    for (const repository of input.repositories) {
      report.repositories += 1;
      let listed: Array<{ number: number; updatedAt: string | null }>;
      try {
        listed = input.onlyPr
          ? [{ number: input.onlyPr.number, updatedAt: null }]
          : this.source.list(repository, { limit });
      } catch (error) {
        report.failures += 1;
        this.recordPrFinding(report, repository, input.onlyPr?.number ?? 0, "pr_unavailable", messageOf(error), now, input.dryRun !== true);
        continue;
      }
      for (const item of listed) {
        if (since !== null && item.updatedAt !== null && Date.parse(item.updatedAt) < since) continue;
        this.syncOne(repository, item.number, input, report, now);
      }
    }
    return report;
  }

  private syncOne(repository: string, number: number, input: SyncInput, report: SyncReport, now: number): void {
    const cache = this.db
      .prepare("SELECT etag, last_modified FROM pull_requests WHERE repository = ? AND number = ?")
      .get(repository, number) as PullRow | undefined;
    let observation: PullRequestObservation | "not-modified";
    try {
      observation = this.source.get(repository, number, {
        etag: cache?.etag ?? null,
        lastModified: cache?.last_modified ?? null,
      });
    } catch (error) {
      report.failures += 1;
      this.recordPrFinding(report, repository, number, "pr_unavailable", messageOf(error), now, input.dryRun !== true);
      return;
    }
    if (observation === "not-modified") {
      report.skipped += 1;
      return;
    }
    report.scanned += 1;
    let commits: PullRequestCommit[] = [];
    let commitsOk = true;
    try {
      commits = this.source.commits(repository, number);
    } catch (error) {
      commitsOk = false;
      report.failures += 1;
      this.recordPrFinding(report, repository, number, "pr_unavailable", messageOf(error), now, input.dryRun !== true);
    }
    if (commits.length >= 250) {
      report.truncated += 1;
      this.recordPrFinding(report, repository, number, "pr_commits_truncated", "PR exceeds 250 commits", now, input.dryRun !== true);
    }
    if (input.dryRun === true) {
      report.created += this.plannedTrailers(commits, input.projectId);
      report.mentioned += this.plannedMentions(observation, input.projectId);
      return;
    }
    // A commit read failure leaves no etag behind: the next run must retry
    // instead of being told 304 and skipping the links forever.
    if (!commitsOk) return;
    let created = 0;
    let mentioned = 0;
    let trailerFindings = 0;
    try {
      withTransaction(this.db, () => {
        // Trailer path: group the PR's commits by the issue each one names and
        // let 727 decide created_from versus mention+findings. A commit that
        // names its issue only in the `(XTRM-938)` subject suffix names it just
        // as well: reading trailers alone left `links check` listing commits
        // that `links sync` never fed to the writer (XTRM-953).
        const byIssue = new Map<string, PullRequestCommit[]>();
        for (const commit of commits) {
          for (const ref of new Set(commitIssueRefs(commit.message))) {
            let issueId: string;
            try {
              issueId = this.issues.resolveRefInProject(ref, input.projectId).id;
            } catch {
              continue;
            }
            const group = byIssue.get(issueId) ?? [];
            group.push(commit);
            byIssue.set(issueId, group);
          }
        }
        for (const [issueId, group] of byIssue) {
          const result = this.links.linkCommits({ issueId, repository, number, commits: group, actor: input.actor, now });
          created += result.created;
          mentioned += result.mentioned;
          trailerFindings += result.findings;
        }
        // Weak paths: title, branch, body. A backfill scan records source=backfill.
        const weak = input.since ? "backfill" : null;
        for (const [text, source] of [
          [observation.title, "title"],
          [observation.headRef, "branch"],
          [observation.body, "prose"],
        ] as Array<[string | null, Extract<PrLinkSource, "title" | "branch" | "prose">]>) {
          for (const ref of issueRefsIn(text)) {
            let issueId: string;
            try {
              issueId = this.issues.resolveRefInProject(ref, input.projectId).id;
            } catch {
              continue;
            }
            const mentionSource = (weak ?? source) as Exclude<PrLinkSource, "provenance">;
            if (this.hasLiveMention(issueId, repository, number, mentionSource)) continue;
            this.links.linkMention({
              issueId,
              repository,
              number,
              url: observation.url,
              actor: input.actor,
              source: mentionSource,
              now,
            });
            mentioned += 1;
          }
        }
        if (observation.state === "merged" && observation.mergeCommitSha !== null) {
          this.db
            .prepare("UPDATE issue_pr_commits SET landed_sha = ? WHERE repository = ? AND number = ? AND (landed_sha IS NULL OR landed_sha <> ?)")
            .run(observation.mergeCommitSha, repository, number, observation.mergeCommitSha);
        }
        // Last: the state row carries the etag, so a 304 can only happen after
        // the links for this observation were committed.
        this.upsert(observation, now);
      });
    } catch (error) {
      report.failures += 1;
      this.recordPrFinding(report, repository, number, "pr_link_write_failed", messageOf(error), now);
      return;
    }
    report.created += created;
    report.mentioned += mentioned;
    report.findingCount += trailerFindings;
  }

  private hasLiveMention(issueId: string, repository: string, number: number, source: PrLinkSource): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM issue_pull_requests
          WHERE issue_id = ? AND repository = ? AND number = ? AND relation = 'mentioned'
            AND source = ? AND superseded_at IS NULL LIMIT 1`,
      )
      .get(issueId, repository, number, source);
    return row !== undefined;
  }

  private upsert(observation: PullRequestObservation, now: number): void {
    this.db
      .prepare(
        `INSERT INTO pull_requests
           (repository, number, state, state_source, draft, head_sha, merge_commit_sha, title, url,
            base_ref, merged_at, closed_at, etag, last_modified, last_synced_at)
         VALUES (?, ?, ?, 'observed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repository, number) DO UPDATE SET
           state = excluded.state,
           state_source = excluded.state_source,
           draft = excluded.draft,
           head_sha = excluded.head_sha,
           merge_commit_sha = excluded.merge_commit_sha,
           title = excluded.title,
           url = excluded.url,
           base_ref = excluded.base_ref,
           merged_at = excluded.merged_at,
           closed_at = excluded.closed_at,
           etag = excluded.etag,
           last_modified = excluded.last_modified,
           last_synced_at = excluded.last_synced_at`,
      )
      .run(
        observation.repository,
        observation.number,
        observation.state,
        observation.draft ? 1 : 0,
        observation.headSha,
        observation.mergeCommitSha,
        observation.title,
        observation.url,
        observation.baseRef,
        observation.mergedAt,
        observation.closedAt,
        observation.etag,
        observation.lastModified,
        now,
      );
  }

  private plannedTrailers(commits: PullRequestCommit[], projectId: string): number {
    let count = 0;
    for (const commit of commits) {
      // Same refs as the write path, or the dry run disagrees with the run it
      // is supposed to predict (XTRM-953).
      for (const ref of new Set(commitIssueRefs(commit.message))) {
        try {
          this.issues.resolveRefInProject(ref, projectId);
          count += 1;
        } catch {
          // Unknown refs are not planned writes.
        }
      }
    }
    return count;
  }

  private plannedMentions(observation: PullRequestObservation, projectId: string): number {
    let count = 0;
    for (const text of [observation.title, observation.headRef, observation.body]) {
      for (const ref of issueRefsIn(text)) {
        try {
          this.issues.resolveRefInProject(ref, projectId);
          count += 1;
        } catch {
          // Unknown refs are not planned writes.
        }
      }
    }
    return count;
  }

  /** PR-level findings live on every issue already linked to the PR. */
  private recordPrFinding(report: SyncReport, repository: string, number: number, code: string, detail: string, now: number, write = true): void {
    const linked = this.db
      .prepare(
        `SELECT DISTINCT issue_id FROM issue_pull_requests
          WHERE repository = ? AND number = ? AND superseded_at IS NULL`,
      )
      .all(repository, number) as Array<{ issue_id: string }>;
    report.findings.push({ repository, number, code, detail });
    if (!write) return;
    // A PR-level finding with no linked issue still counts: it is a real
    // finding, it only has no event row to hang on yet.
    if (linked.length === 0) report.findingCount += 1;
    for (const row of linked) {
      const duplicate = this.db
        .prepare(
          `SELECT 1 FROM issue_events
            WHERE issue_id = ? AND type = 'provenance.link_finding'
              AND json_extract(payload_json, '$.code') = ?
              AND json_extract(payload_json, '$.repository') = ?
              AND json_extract(payload_json, '$.number') = ?
              AND json_extract(payload_json, '$.sha') IS NULL
            LIMIT 1`,
        )
        .get(row.issue_id, code, repository, number);
      if (duplicate) continue;
      report.findingCount += 1;
      this.issues.appendEvent(row.issue_id, "provenance.link_finding", {
        code,
        repository,
        number,
        sha: null,
        detail,
      }, now);
    }
  }
}

export class GhCliPullRequestSource implements PullRequestSource {
  private readonly runGh: (args: string[]) => string;
  constructor(runGh?: (args: string[]) => string) {
    this.runGh = runGh ?? ((args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  }
  list(repository: string, opts: { limit: number }): Array<{ number: number; updatedAt: string | null }> {
    const out: Array<{ number: number; updatedAt: string | null }> = [];
    // A constant page size across pages; a shrinking per_page on the last
    // page would overlap the previous page and silently skip the tail.
    const perPage = Math.max(1, Math.min(100, opts.limit));
    for (let page = 1; out.length < opts.limit; page += 1) {
      const raw = this.run([
        "api",
        `repos/${repository}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
      ]);
      const parsed = JSON.parse(raw) as Array<{ number: number; updated_at?: string }>;
      for (const pr of parsed) out.push({ number: pr.number, updatedAt: pr.updated_at ?? null });
      if (parsed.length < perPage) break;
    }
    return out.slice(0, opts.limit);
  }

  get(repository: string, number: number, cache: { etag: string | null; lastModified: string | null }): PullRequestObservation | "not-modified" {
    const headers: string[] = [];
    if (cache.etag !== null) headers.push("-H", `If-None-Match: ${cache.etag}`);
    if (cache.lastModified !== null) headers.push("-H", `If-Modified-Since: ${cache.lastModified}`);
    let stdout: string;
    try {
      stdout = this.run(["api", `repos/${repository}/pulls/${number}`, "--include", ...headers]);
    } catch (error) {
      const text = messageOf(error);
      if (text.includes("HTTP 304")) return "not-modified";
      throw error;
    }
    const response = parseGhInclude(stdout);
    if (response.status === 304) return "not-modified";
    const body = JSON.parse(response.body) as {
      number: number;
      state: string;
      draft?: boolean;
      title?: string;
      html_url?: string;
      body?: string | null;
      merged_at?: string | null;
      closed_at?: string | null;
      updated_at?: string | null;
      merge_commit_sha?: string | null;
      head?: { sha?: string; ref?: string };
      base?: { ref?: string };
    };
    return {
      repository,
      number: body.number,
      state: normalizeState(body.state, body.merged_at ?? null),
      draft: body.draft === true,
      headSha: body.head?.sha ?? null,
      headRef: body.head?.ref ?? null,
      baseRef: body.base?.ref ?? null,
      mergeCommitSha: body.merge_commit_sha ?? null,
      title: body.title ?? null,
      url: body.html_url ?? null,
      body: body.body ?? null,
      mergedAt: numberOrNull(body.merged_at),
      closedAt: numberOrNull(body.closed_at),
      etag: response.headers["etag"] ?? null,
      lastModified: response.headers["last-modified"] ?? null,
      updatedAt: body.updated_at ?? null,
    };
  }

  commits(repository: string, number: number): PullRequestCommit[] {
    const out: PullRequestCommit[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const raw = this.run([
        "api",
        `repos/${repository}/pulls/${number}/commits?per_page=100&page=${page}`,
      ]);
      const parsed = JSON.parse(raw) as Array<{ sha: string; commit?: { message?: string } }>;
      for (const commit of parsed) out.push({ sha: commit.sha, message: commit.commit?.message ?? "" });
      if (parsed.length < 100) break;
    }
    return out;
  }

  private run(args: string[]): string {
    return this.runGh(args);
  }
}

function normalizeState(state: string, mergedAt: string | null): PullRequestState {
  if (mergedAt !== null || state === "merged") return "merged";
  if (state === "closed") return "closed";
  return "open";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
