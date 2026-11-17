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
  /** ADR-009 read marker; null/absent on a clean row. */
  unreadable?: string | null;
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
  // ADR-009: a per-row read failure is a marker row, not a source error and
  // not a summary. The rest of the page renders normally around it.
  if (entry.unreadable) {
    return {
      id: `substrate:${entry.id}`,
      source: "substrate",
      kind: `journal.${entry.kind}`,
      actor: entry.participantId ?? null,
      verb: "could not be read",
      object: `${entry.issueRef} — ${entry.unreadable}`,
      refs,
      at: entry.createdAt,
      meta: [
        ["journal", entry.kind],
        ["entry", entry.id],
        ["rev", String(entry.issueRevision)],
        ["seq", String(entry.sequence)],
        ["unreadable", "true"],
      ],
      body: entry.unreadable,
    };
  }
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

export function journalFeedRows(wire: JournalFeedWire): ActivityRow[] {
  return wire.entries.map(journalRow);
}

function firstLine(text: string): string {
  return text.split("\n")[0]!.trim();
}
