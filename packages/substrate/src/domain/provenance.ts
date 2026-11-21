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
  externalBindings: Array<{ provider: string; scope: string; remoteId: string; remoteKey?: string | null; url?: string | null }>;
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

// Host-owned trailer block derived from an Issue without a receipt (XTRM-684).
// Idempotent: a message that already names an Issue is left untouched, so an
// amend or rebase that keeps the message never duplicates trailers.
export function formatIssueTrailers(input: { issueId: string; issueRevision: number; jiraKey?: string | null; agent?: string | null }): string {
  const lines = [`${TRAILER_ISSUE}: ${input.issueId}`, `${TRAILER_REVISION}: ${input.issueRevision}`];
  if (input.jiraKey) lines.push(`Jira: ${input.jiraKey}`);
  if (input.agent) lines.push(`Agent: ${input.agent}`);
  return lines.join("\n");
}

export function attachIssueTrailers(message: string, trailers: string): string {
  if (message.includes(`${TRAILER_ISSUE}:`)) return message;
  const trimmed = message.replace(/\s+$/, "");
  return `${trimmed}\n\n${trailers}\n`;
}

export interface ParsedTrailers {
  issueId: string | null;
  issueRevision: number | null;
  receiptId: string | null;
}

export interface TrailerIssue {
  issueId: string;
  issueRevision: number | null;
}

export interface AllTrailers {
  /** Every XTRM-Issue pair in message order, distinct by issue+revision. */
  issues: TrailerIssue[];
  /** Every XTRM-Receipt value in message order, deduped. */
  receipts: string[];
}

/**
 * Issue refs named by the conventional `(XTRM-938)` subject suffix (XTRM-953).
 * `xt` commits name their issue in the subject, not in a trailer, so the T2
 * link path has to read both: a branch written by `xt` is linkable without a
 * message rewrite, and a commit carrying the real `XTRM-Issue:` trailer stays
 * authoritative because callers try trailers first.
 *
 * Only the subject line is read. A ref in the body prose is not evidence: it
 * describes what the commit talks about, which is what `prose` links are for.
 */
export function subjectIssueRefs(message: string): string[] {
  const subject = message.split("\n", 1)[0] ?? "";
  const out: string[] = [];
  // The parenthesised group, not one ref: a lane commit names several issues
  // in one suffix, `chore: two lanes (XTRM-949, XTRM-958)`.
  for (const group of subject.matchAll(/\(([^()]*)\)/g)) {
    for (const ref of refsInGroup(group[1] ?? "")) {
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

/**
 * Refs inside one parenthesised group, scanned by index rather than by regex.
 * The regex form (`[A-Z][A-Z0-9]*-\d+(?:\.\d+)*`) is a nested quantifier over
 * commit-message text, which CodeQL reports as js/polynomial-redos (PR #482);
 * a ref is at most `PREFIX-1.2.3`, so a single left-to-right pass is both
 * linear by construction and easier to read than the pattern it replaces.
 *
 * "Linear" is a claim about this code, so it is a claim a test can hold: every
 * advance below is `i + 1` or further, never a reset to an earlier offset. A
 * rescan from `start + 1` looks linear on real commit subjects and is quadratic
 * on `("A" * 32000)`, which is exactly the shape the regex was flagged for.
 */
function refsInGroup(group: string): string[] {
  const refs: string[] = [];
  const isUpper = (c: string | undefined): boolean => c !== undefined && c >= "A" && c <= "Z";
  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
  const isBody = (c: string | undefined): boolean => isUpper(c) || isDigit(c);
  const scanDigits = (from: number): number => {
    let i = from;
    while (isDigit(group[i])) i += 1;
    return i;
  };
  let i = 0;
  while (i < group.length) {
    if (!isUpper(group[i])) {
      i += 1;
      continue;
    }
    const start = i;
    while (isBody(group[i])) i += 1;
    if (group[i] !== "-") {
      // Resume where the scan stopped, not at `start + 1`: rescanning an uppercase run
      // that carries no dash is quadratic, and the comment below already promised a
      // single left-to-right pass (XTRM-953, measured by reviewer-472 on #482).
      i += 1;
      continue;
    }
    const afterDigits = scanDigits(i + 1);
    if (afterDigits === i + 1) {
      i += 1;
      continue;
    }
    i = afterDigits;
    // Dotted children: `XTRM-811.23`, `XTRM-184.2.3`.
    while (group[i] === ".") {
      const next = scanDigits(i + 1);
      if (next === i + 1) break;
      i = next;
    }
    refs.push(group.slice(start, i));
  }
  return refs;
}

/**
 * Read every issue trailer, not only the last. T2 link writing and the
 * trailer guard need all values: a commit may name one issue and a
 * coordinator a second, or a squash commit may carry several issues.
 */
export function parseAllTrailers(message: string): AllTrailers {
  const raw: TrailerIssue[] = [];
  const receipts: string[] = [];
  let current: TrailerIssue | null = null;
  for (const line of message.split("\n")) {
    const m = /^([A-Za-z-]+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === TRAILER_ISSUE) {
      const issueId = m[2]!.trim();
      // An empty issue line is a reset: a following revision attaches to
      // nothing, never to the previous issue.
      if (issueId === "") {
        current = null;
        continue;
      }
      current = { issueId, issueRevision: null };
      raw.push(current);
    } else if (m[1] === TRAILER_REVISION) {
      // A second revision never overwrites the first; a revision that is not
      // plain decimal digits (0x10, -2) is malformed and ignored.
      if (current === null || current.issueRevision !== null) continue;
      const text = m[2]!.trim();
      if (!/^\d+$/.test(text)) continue;
      current.issueRevision = Number(text);
    } else if (m[1] === TRAILER_RECEIPT) {
      const receipt = m[2]!.trim();
      if (receipt !== "" && !receipts.includes(receipt)) receipts.push(receipt);
    }
  }
  const revised = new Set(raw.filter((t) => t.issueRevision !== null).map((t) => t.issueId));
  const seen = new Set<string>();
  const issues: TrailerIssue[] = [];
  for (const t of raw) {
    if (t.issueRevision === null && revised.has(t.issueId)) continue;
    const key = `${t.issueId}|${t.issueRevision ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(t);
  }
  return { issues, receipts };
}

// Single-value view for existing callers. It keeps the last value, which is
// why it must not be used for issue resolution: use parseAllTrailers.
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
