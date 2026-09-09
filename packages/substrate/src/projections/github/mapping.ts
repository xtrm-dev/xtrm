import type { ResolvedIssue } from "../../domain/issue.ts";
import { hashMappedContent, type ProviderCapabilities } from "../types.ts";

// GitHub native projection (PRD §32). Preferred mapping: parent_child →
// sub-issue relationship, blocks → issue dependency, kind → issue type,
// priority → issue field, contract → issue body.

export interface GitHubMappedIssue {
  title: string;
  body: string;
  type: string | null;
  fields: Record<string, string | number>;
}

export type GitHubOp =
  | { op: "upsert-issue"; remoteScope: string; mapped: GitHubMappedIssue; contentHash: string }
  | { op: "link-sub-issue"; remoteScope: string; parentRemoteId: string; childRemoteId: string }
  | { op: "link-dependency"; remoteScope: string; blockerRemoteId: string; blockedRemoteId: string };

const KIND_TO_TYPE: Record<string, string> = {
  epic: "Epic",
  task: "Task",
  bug: "Bug",
  decision: "Decision",
  research: "Research",
  followup: "Task",
};

export function mapIssueToGitHub(
  issue: ResolvedIssue,
  contract: unknown,
  capabilities: ProviderCapabilities,
): GitHubMappedIssue {
  const c = (contract ?? {}) as Record<string, unknown>;
  const lines = [
    `> Substrate projection of \`${issue.locator} · ${issue.humanRef}\` (revision ${issue.currentRevision}).`,
    `> Local authority wins on conflict; do not edit protected sections remotely.`,
    ``,
    `## Problem`,
    `${c["problem"] ?? ""}`,
    ``,
    `## Success`,
    `${c["success"] ?? ""}`,
  ];
  return {
    title: `[${issue.humanRef}] ${issue.title}`,
    body: lines.join("\n"),
    type: capabilities.issueTypes ? (KIND_TO_TYPE[issue.kind] ?? "Task") : null,
    fields: capabilities.fields ? { priority: issue.priority } : {},
  };
}

// Diff a mapped issue against the last-pushed hash. Unchanged content yields
// zero ops, hence zero PATCH calls (F38).
export function diffGitHubIssue(
  remoteScope: string,
  mapped: GitHubMappedIssue,
  lastPushedHash: string | null,
): GitHubOp[] {
  const hash = hashMappedContent(mapped);
  if (lastPushedHash === hash) return [];
  return [{ op: "upsert-issue", remoteScope, mapped, contentHash: hash }];
}

// Parent maps to a native sub-issue link where supported (F39). When either
// side is unbound the link is omitted, never emulated with lossy labels.
export function parentLinkOp(
  remoteScope: string,
  parentRemoteId: string | null,
  childRemoteId: string | null,
  capabilities: ProviderCapabilities,
): GitHubOp[] {
  if (!capabilities.subIssues) return [];
  if (!parentRemoteId || !childRemoteId) return [];
  return [{ op: "link-sub-issue", remoteScope, parentRemoteId, childRemoteId }];
}

// Blocks maps to a native dependency where supported (F40).
export function blocksLinkOp(
  remoteScope: string,
  blockerRemoteId: string | null,
  blockedRemoteId: string | null,
  capabilities: ProviderCapabilities,
): GitHubOp[] {
  if (!capabilities.dependencies) return [];
  if (!blockerRemoteId || !blockedRemoteId) return [];
  return [{ op: "link-dependency", remoteScope, blockerRemoteId, blockedRemoteId }];
}
