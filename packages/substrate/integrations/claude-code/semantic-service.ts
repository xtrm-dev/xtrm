// Substrate semantic child-model service for Claude compaction (PRD §24.1).
// The summarizer runs behind the service as a bounded separate step — it is
// not the main Claude session and not a direct PreCompact agent hook (which
// Claude does not support on PreCompact). v0 is a deterministic extractive
// fallback: real model summarizers plug in via the Summarizer signature.

import { previewText, type MechanicalCheckpoint, type SemanticCheckpoint } from "../../src/domain/journal.ts";
import type { Summarizer } from "../../src/service/journal-service.ts";

const MAX_SUMMARY = 2000;
const MAX_ITEM = 500;
const MAX_ITEMS = 20;

// Host-generated text: a cut is marked with the dropped length (XTRM-678).
function trunc(s: string, max: number): string {
  return previewText(s, max, "cut by the checkpoint summarizer");
}

function items(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => trunc(v.trim(), MAX_ITEM)).filter((v) => v !== "").slice(0, MAX_ITEMS);
}

// Deterministic fallback: renders durable mechanical state as a bounded
// semantic checkpoint. Never invents contract changes.
export function summarizeMechanical(
  mechanical: MechanicalCheckpoint,
  transcriptTail?: string,
): SemanticCheckpoint {
  const bits: string[] = [`rev${mechanical.issueRevision} ${mechanical.contractHash.slice(0, 12)}`];
  if (mechanical.claimHolder) bits.push(`claim ${mechanical.claimHolder}`);
  if (mechanical.headCommit) bits.push(`head ${mechanical.headCommit.slice(0, 12)}`);
  if (mechanical.pendingBlockers?.length) bits.push(`blockers ${mechanical.pendingBlockers.join(",")}`);
  const childBits = (mechanical.childSummary ?? [])
    .map((c) => `${c.locator ?? c.issueId}:${c.lifecycleState ?? "?"}`)
    .join(",");
  const head: string[] = [`Checkpoint ${bits.join("; ")}.`];
  if (childBits) head.push(`Children ${childBits}.`);
  if (mechanical.pendingAsks?.length) head.push(`Open: ${mechanical.pendingAsks.slice(0, 5).join(" | ")}.`);
  const tail = transcriptGist(transcriptTail ?? "").slice(-20).join("\n").trim();
  const summary = trunc([...head, tail ? `Recent context:\n${tail}` : ""].filter(Boolean).join("\n"), MAX_SUMMARY);
  return {
    summary,
    current: tail ? trunc(tail.slice(-MAX_ITEM), MAX_ITEM) : undefined,
    openQuestions: items(mechanical.pendingAsks),
    blocked: items(mechanical.pendingBlockers),
  };
}

// Claude transcripts are JSONL records; pasting them raw put requestIds and
// token counters into checkpoint summaries. Keep only conversational text and
// tool names; non-JSON lines (a tail cut mid-record) and metadata are dropped.
export function transcriptGist(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    let rec: { type?: unknown; message?: { content?: unknown } };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.type !== "user" && rec?.type !== "assistant") continue;
    const content = rec.message?.content;
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks as Array<{ type?: string; text?: string; name?: string }>) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim() !== "") {
        out.push(`${rec.type}: ${trunc(b.text.trim().replace(/\s+/g, " "), 300)}`);
      } else if (b?.type === "tool_use" && typeof b.name === "string") {
        out.push(`tool: ${b.name}`);
      }
    }
  }
  return out;
}

// JournalService-compatible summarizer with a transcript-tail cap.
// SIMPLIFIED: extractive fallback, no model call. Upgrade when a bounded
// child-model runner lands (inject any Summarizer into precompact).
export function createSemanticSummarizer(opts?: { transcriptTail?: string }): Summarizer {
  return (_persisted, mechanical) => summarizeMechanical(mechanical, opts?.transcriptTail);
}

// The raw tail is mostly JSON envelope; read enough to keep ~20 gist lines.
export function readTranscriptTail(path: string | null, maxChars = 64000): string {
  if (!path) return "";
  try {
    const { readFileSync } = process.getBuiltinModule("node:fs") as typeof import("node:fs");
    const text = readFileSync(path, "utf8");
    return text.slice(-maxChars);
  } catch {
    return "";
  }
}
