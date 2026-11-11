// One-shot reconciler for issue-to-PR links (design note 11-11, XTRM-728).
//
// Trailer-first: commits go through XTRM-727's `linkCommits` (T1/T2 evidence,
// its findings, its receipt guards). Title, branch and body are weak evidence
// and become `mentioned` rows with their source. Pull-request state is stored
// separately in `pull_requests`; the link rows are never rewritten.

import { execFileSync } from "node:child_process";
import type { DatabaseSync } from "../store/database.ts";
import { parseAllTrailers } from "../domain/provenance.ts";
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
  findings: number;
  failures: number;
  skipped: number;
  truncated: number;
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
      findings: 0,
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
        this.recordPrFinding(repository, input.onlyPr?.number ?? 0, "pr_unavailable", messageOf(error), now);
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
      this.recordPrFinding(repository, number, "pr_unavailable", messageOf(error), now);
      return;
    }
    if (observation === "not-modified") {
      report.skipped += 1;
      return;
    }
    report.scanned += 1;
    let commits: PullRequestCommit[] = [];
    try {
      commits = this.source.commits(repository, number);
    } catch (error) {
      report.failures += 1;
      this.recordPrFinding(repository, number, "pr_unavailable", messageOf(error), now);
    }
    if (commits.length >= 250) {
      report.truncated += 1;
      this.recordPrFinding(repository, number, "pr_commits_truncated", "PR exceeds 250 commits", now);
    }
    if (input.dryRun === true) {
      report.created += this.plannedTrailers(commits, input.projectId);
      report.mentioned += this.plannedMentions(observation, input.projectId);
      return;
    }
    this.upsert(observation, now);
    // Trailer path: group the PR's commits by the issue each one names and
    // let 727 decide created_from versus mention+findings.
    const byIssue = new Map<string, PullRequestCommit[]>();
    for (const commit of commits) {
      for (const ref of new Set(parseAllTrailers(commit.message).issues.map((i) => i.issueId))) {
        let issueId: string;
        try {
          issueId = this.issues.resolveRef(ref).id;
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
      report.created += result.created;
      report.mentioned += result.mentioned;
      report.findings += result.findings;
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
          issueId = this.issues.resolveRef(ref).id;
        } catch {
          continue;
        }
        this.links.linkMention({
          issueId,
          repository,
          number,
          url: observation.url,
          actor: input.actor,
          source: (weak ?? source) as Exclude<PrLinkSource, "provenance">,
          now,
        });
        report.mentioned += 1;
      }
    }
    if (observation.state === "merged" && observation.mergeCommitSha !== null) {
      this.db
        .prepare("UPDATE issue_pr_commits SET landed_sha = ? WHERE repository = ? AND number = ? AND (landed_sha IS NULL OR landed_sha <> ?)")
        .run(observation.mergeCommitSha, repository, number, observation.mergeCommitSha);
    }
  }

  private upsert(observation: PullRequestObservation, now: number): void {
    this.db
      .prepare(
        `INSERT INTO pull_requests
           (repository, number, state, draft, head_sha, merge_commit_sha, title, url, base_ref,
            merged_at, closed_at, etag, last_modified, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repository, number) DO UPDATE SET
           state = excluded.state,
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
      for (const ref of new Set(parseAllTrailers(commit.message).issues.map((i) => i.issueId))) {
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
  private recordPrFinding(repository: string, number: number, code: string, detail: string, now: number): void {
    const linked = this.db
      .prepare(
        `SELECT DISTINCT issue_id FROM issue_pull_requests
          WHERE repository = ? AND number = ? AND superseded_at IS NULL`,
      )
      .all(repository, number) as Array<{ issue_id: string }>;
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
  list(repository: string, opts: { limit: number }): Array<{ number: number; updatedAt: string | null }> {
    const raw = this.run([
      "api",
      `repos/${repository}/pulls?state=all&sort=updated&direction=desc&per_page=${opts.limit}`,
    ]);
    const parsed = JSON.parse(raw) as Array<{ number: number; updated_at?: string }>;
    return parsed.map((pr) => ({ number: pr.number, updatedAt: pr.updated_at ?? null }));
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
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
