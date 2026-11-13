// Substrate source (XTRM-757): the project-wide journal feed (XTRM-764) and the
// issue rows, which carry the status and revision the journal does not repeat.
//
// All journal kinds are kept. A kind this file has no phrasing for renders as a
// neutral row — the closed set lives in the bridge, so an unknown kind must
// never be dropped.

import type { ActivityRef, ActivityRow } from "./types.ts";

export interface JournalFeedWireRow {
  issueRef: string;
  issueId: string;
  id: string;
  sequence: number;
  kind: string;
  issueRevision: number;
  createdAt: number;
  participantId?: string | null;
  semantic?: { summary?: string } | null;
  result?: { summary?: string } | null;
}

export interface JournalFeedWire {
  projectId: string;
  nextCursor: string | null;
  entries: JournalFeedWireRow[];
}

/** The verb and object phrasing per journal kind; the fallback stays neutral. */
const KIND_VERB: Record<string, string> = {
  note: "noted",
  finding: "raised a finding",
  decision: "decided",
  blocker: "raised a blocker",
  milestone: "reached a milestone",
  handoff: "handed off",
  result: "reported a result",
  checkpoint: "checkpointed",
  compaction: "compacted",
  cancel: "cancelled",
};

export function journalVerb(kind: string): string {
  return KIND_VERB[kind] ?? "recorded";
}

/** One journal entry as a row: the summary is the object, the refs are the issue and the entry. */
export function journalRow(entry: JournalFeedWireRow): ActivityRow {
  const summary = entry.semantic?.summary ?? entry.result?.summary ?? null;
  const refs: ActivityRef[] = [{ kind: "issue", ref: entry.issueRef }];
  return {
    id: `substrate:${entry.id}`,
    source: "substrate",
    kind: `journal.${entry.kind}`,
    actor: entry.participantId ?? null,
    verb: journalVerb(entry.kind),
    object: `${entry.issueRef}${summary === null ? "" : ` — ${firstLine(summary)}`}`,
    refs,
    at: entry.createdAt,
    meta: [
      ["journal", entry.kind],
      ["holder", entry.participantId ?? "none recorded"],
      ["entry", entry.id],
      ["rev", String(entry.issueRevision)],
      ["seq", String(entry.sequence)],
    ],
    body: summary,
  };
}

/**
 * An issue row as a status activity row. It states the state the board records
 * now, with the timestamp of the last change — not a claimed transition, which
 * Substrate exposes per Issue only (no project-wide event read yet).
 */
export function statusRow(issue: { ref: string; title: string; lifecycle: string; updatedAt: number | null }): ActivityRow {
  return {
    id: `substrate:status:${issue.ref}:${issue.lifecycle}:${issue.updatedAt}`,
    source: "substrate",
    kind: "issue.status",
    actor: null,
    verb: "is",
    object: `${issue.ref} ${issue.lifecycle} — ${issue.title}`,
    refs: [{ kind: "issue", ref: issue.ref }],
    // A row needs a time; a board row always carries one, and 0 keeps the
    // ordering honest if an older board omits it (it sorts last, never first).
    at: issue.updatedAt ?? 0,
    meta: [
      ["state", issue.lifecycle],
      ["issue", issue.ref],
    ],
    body: null,
  };
}

export function journalFeedRows(wire: JournalFeedWire): ActivityRow[] {
  return wire.entries.map(journalRow);
}

function firstLine(text: string): string {
  return text.split("\n")[0]!.trim();
}
