import { createHash } from "node:crypto";

// Shared projection primitives (PRD §§31-34). Providers are projection and
// intake surfaces, never silent last-writer-wins authorities.

export const PROVIDERS = ["github", "jira"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const BINDING_MODES = ["projection", "intake", "mirror_read"] as const;
export type BindingMode = (typeof BINDING_MODES)[number];

export const SYNC_STATES = ["in_sync", "pending", "drift", "uncertain"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export interface ExternalBinding {
  issueId: string;
  provider: Provider;
  remoteScope: string;
  remoteId: string;
  remoteKey: string | null;
  url: string | null;
  mode: BindingMode;
  lastPushedRevision: number | null;
  lastSeenRemoteVersion: string | null;
  mappedContentHash: string | null;
  syncState: SyncState;
  createdAt: number;
  updatedAt: number;
}

export interface OutboxEntry {
  id: number;
  issueId: string;
  provider: Provider;
  remoteScope: string;
  operation: string;
  payload: unknown;
  mappedContentHash: string;
  idempotencyKey: string;
  status: "pending" | "sent" | "failed" | "uncertain";
  attempts: number;
  nextRetryAt: number;
  lastError: string | null;
  createdAt: number;
}

export interface InboxEntry {
  id: number;
  provider: Provider;
  eventKind: string;
  idempotencyKey: string;
  payload: unknown;
  status: string;
  seenCount: number;
  createdAt: number;
  processedAt: number | null;
}

// Provider capability flags. Mappings must degrade explicitly when a native
// relationship is unavailable rather than silently emulating it with labels.
export interface ProviderCapabilities {
  subIssues: boolean;
  dependencies: boolean;
  issueTypes: boolean;
  fields: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

// Mapped content hash: if the mapped content did not change, no remote call
// is sent (F38). Canonicalized so key order never causes a spurious PATCH.
export function hashMappedContent(mapped: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(mapped))).digest("hex");
}

// Retry backoff (§51-local): exponential from 1s, capped at 60s. Deterministic
// in the attempt count so tests can assert it without clock injection.
export function backoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts));
}
