import type { ResolvedIssue } from "../../domain/issue.ts";
import { hashMappedContent } from "../types.ts";

// Jira programme projection (PRD §33). Selective by policy; journal entries
// are never mirrored by default.

export type JiraSelectionMode = "roots-only" | "tagged" | "all";

export interface JiraSelectionPolicy {
  mode: JiraSelectionMode;
  tag?: string;
}

export interface JiraMappedIssue {
  summary: string;
  description: string;
  issueType: string;
  labels: string[];
}

export type JiraOp =
  | { op: "upsert-issue"; remoteScope: string; remoteKey: string | null; mapped: JiraMappedIssue; contentHash: string };

// Default policy avoids mirroring every implementation leaf unless the
// project explicitly requests it.
export function selectForJira(
  issue: ResolvedIssue,
  isRoot: boolean,
  policy: JiraSelectionPolicy,
): boolean {
  switch (policy.mode) {
    case "all":
      return true;
    case "roots-only":
      return isRoot;
    case "tagged":
      return policy.tag !== undefined && issue.title.includes(policy.tag);
  }
}

const KIND_TO_JIRA_TYPE: Record<string, string> = {
  epic: "Epic",
  task: "Task",
  bug: "Bug",
  decision: "Task",
  research: "Spike",
  followup: "Sub-task",
};

export function mapIssueToJira(issue: ResolvedIssue, contract: unknown): JiraMappedIssue {
  const c = (contract ?? {}) as Record<string, unknown>;
  return {
    summary: `[${issue.humanRef}] ${issue.title}`,
    description: `Substrate ${issue.locator} @ revision ${issue.currentRevision}.\n\nProblem: ${c["problem"] ?? ""}\nSuccess: ${c["success"] ?? ""}`,
    issueType: KIND_TO_JIRA_TYPE[issue.kind] ?? "Task",
    labels: [`substrate:${issue.humanRef}`],
  };
}

export function diffJiraIssue(
  remoteScope: string,
  remoteKey: string | null,
  mapped: JiraMappedIssue,
  lastPushedHash: string | null,
): JiraOp[] {
  const hash = hashMappedContent(mapped);
  if (lastPushedHash === hash) return [];
  return [{ op: "upsert-issue", remoteScope, remoteKey, mapped, contentHash: hash }];
}
