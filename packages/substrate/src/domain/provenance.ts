// WorkReceipts, artifact bindings, trailers, bundles (PRD §§27-29).
// Pure types + pure helpers only; the service owns DB rows and host
// authority. Trailers are parsed read-only: trailer-like text in a commit
// message never creates authority without a host-allocated receipt.

import { v7 as uuidv7 } from "uuid";

export const TRAILER_ISSUE = "XTRM-Issue";
export const TRAILER_REVISION = "XTRM-Issue-Revision";
export const TRAILER_RECEIPT = "XTRM-Receipt";

export type ArtifactKind = "commit" | "pr" | "validation" | "review" | "artifact" | "bundle";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["commit", "pr", "validation", "review", "artifact", "bundle"];

export interface ArtifactRef {
  kind: ArtifactKind;
  value: string;
  provider?: string | null;
}

export interface WorkReceipt {
  id: string;
  executionBindingId: string;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  journalCheckpointId: string | null;
  validationRefs: ArtifactRef[];
  commitSha: string | null;
  createdAt: number;
  finalizedAt: number | null;
}

export interface ArtifactBinding {
  id: number;
  receiptId: string;
  kind: ArtifactKind;
  value: string;
  provider: string | null;
  createdAt: number;
  supersededAt: number | null;
}

// Checkpoint summaries only, never full journal/transcript (§29).
export interface CheckpointSummary {
  entryId: string;
  sequence: number;
  kind: string;
  issueRevision: number;
  summary: string | null;
}

export interface ProvenanceBundle {
  bundleId: string;
  issueId: string;
  issueRevision: number;
  contractHash: string;
  contract: unknown;
  executionBindingIds: string[];
  checkpointSummaries: CheckpointSummary[];
  commitShas: string[];
  validationRefs: ArtifactRef[];
  reviewRefs: ArtifactRef[];
  externalBindings: Array<{ provider: string; scope: string; remoteId: string; url?: string | null }>;
  createdAt: number;
}

export function newWorkReceiptId(): string {
  return `rcp_${uuidv7()}`;
}

export function newBundleId(): string {
  return `bnd_${uuidv7()}`;
}

export function isValidSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

export function isValidReceiptId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("rcp_") && value.length > 8;
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

// Host-owned trailer block appended by prepare-commit-msg. The executor
// never writes these; the hook derives every field from Substrate state.
export function formatTrailers(input: { issueId: string; issueRevision: number; receiptId: string }): string {
  return `${TRAILER_ISSUE}: ${input.issueId}\n${TRAILER_REVISION}: ${input.issueRevision}\n${TRAILER_RECEIPT}: ${input.receiptId}`;
}

// Idempotent attach: an existing trailer block is left untouched so a
// re-run (or an amend that keeps the message) never duplicates trailers.
export function attachTrailers(message: string, trailers: string): string {
  if (message.includes(`${TRAILER_RECEIPT}:`)) return message;
  const trimmed = message.replace(/\s+$/, "");
  return `${trimmed}\n\n${trailers}\n`;
}

export interface ParsedTrailers {
  issueId: string | null;
  issueRevision: number | null;
  receiptId: string | null;
}

export function parseTrailers(message: string): ParsedTrailers {
  const out: ParsedTrailers = { issueId: null, issueRevision: null, receiptId: null };
  for (const line of message.split("\n")) {
    const m = /^([A-Za-z-]+):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === TRAILER_ISSUE) out.issueId = m[2]!;
    else if (m[1] === TRAILER_REVISION) {
      const n = Number(m[2]);
      out.issueRevision = Number.isInteger(n) ? n : null;
    } else if (m[1] === TRAILER_RECEIPT) out.receiptId = m[2]!;
  }
  return out;
}
