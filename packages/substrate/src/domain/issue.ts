import { v7 as uuidv7 } from "uuid";

// Three-form identity (PRD §8): machine ID, durable human reference, derived locator.

export const ISSUE_KINDS = ["epic", "task", "bug", "decision", "research", "followup"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export const LIFECYCLE_STATES = ["open", "deferred", "done", "cancelled", "archived"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const TERMINAL_STATES: readonly LifecycleState[] = ["done", "cancelled", "archived"];

export interface Project {
  id: string;
  prefix: string;
  name: string;
  createdAt: number;
}

export interface Issue {
  id: string;
  projectId: string;
  humanNumber: number;
  kind: IssueKind;
  title: string;
  lifecycleState: LifecycleState;
  priority: number;
  scrutiny: string;
  currentRevision: number;
  currentContractHash: string;
  deferUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

// Current projection plus derived navigation forms. The locator is derived,
// never stored as identity (PRD §8.3).
export interface ResolvedIssue extends Issue {
  humanRef: string;
  locator: string;
}

export interface IssueRevision {
  issueId: string;
  revision: number;
  contractHash: string;
  contract: unknown;
  contextRefs: unknown[];
  ownership: unknown | null;
  authoredBy: string;
  source: unknown | null;
  createdAt: number;
}

export interface IssueEvent {
  id: number;
  issueId: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

export function newIssueId(): string {
  return `iss_${uuidv7()}`;
}

export function formatHumanRef(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

export function parseHumanRef(ref: string): { prefix: string; number: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(ref.trim());
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: Number(m[2]) };
}
