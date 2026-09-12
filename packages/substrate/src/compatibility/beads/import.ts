// Beads import compatibility (Phase 11, bead xtrm-7wc.12; PRD §42.1).
// One-shot migration intake, not a runtime backend: reads the passive Beads
// JSONL export (issues carry inline `dependencies[]`, `notes`, `comments[]`,
// `close_reason` — verified live, A9 receipt v3), creates Substrate issues
// with Beads IDs as durable aliases, and never upgrades thin work.
// Idempotent (G44): re-running skips aliases already present AND re-applies
// edges/hierarchy under per-edge idempotency keys, so resume is just re-run
// with zero row growth. No writes ever go back to Beads: no dual-write (§42).

import { IssueService } from "../../service/issue-service.ts";
import type { JournalService } from "../../service/journal-service.ts";
import type { IssueKind } from "../../domain/issue.ts";
import { ISSUE_KINDS } from "../../domain/issue.ts";

export interface BeadsIssueRecord {
  id: string;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  issue_type?: unknown;
  created_by?: unknown;
  owner?: unknown;
  // Live export shape (A9 receipt v3): inline dependency batch, historical
  // notes, comment threads, and close reasons travel on the record itself.
  dependencies?: unknown;
  notes?: unknown;
  comments?: unknown;
  close_reason?: unknown;
}

export interface BeadsEdgeRecord {
  issue_id: string;
  depends_on_id: string;
  type: string;
}

export interface ImportResult {
  created: string[];
  skippedPresent: string[];
  edgesApplied: Array<{ from: string; to: string; kind: string }>;
  edgeErrors: string[];
  unready: string[];
  // A9 receipt v3 additions (all additive; existing consumers unaffected).
  // Inline-vs-file provenance per applied edge source.
  edgesFromInline: number;
  edgesFromFile: number;
  // Hierarchy split out of edgesApplied: parent-child resolves via setParent.
  hierarchyApplied: Array<{ parent: string; child: string }>;
  hierarchyErrors: string[];
  // Inline entries that failed to apply (redefined check 0b: every inline
  // entry is attempted; failures land here and fail the verdict).
  depFailures: string[];
  // Historical intake: notes/comments -> journal kind "note" with beads
  // provenance refs (never contract text). close_reason travels on the
  // beads.imported event payload + done-transition sampling.
  notesApplied: string[];
  notesSkipped: string[];
  commentsApplied: string[];
  commentsSkipped: string[];
  closeReasonCarried: string[];
  closeReasonMissing: string[];
}

const TBD = "TBD — imported from Beads; pending XTRM planning";

// Marker the verifier samples for (thin-source filler). Exported so the CLI
// receipt check and Core-local gates test the identical string.
export const BEADS_TBD_MARKER = TBD;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

// Conservative section extraction: labeled `KEY:` headers only. Anything
// unrecognized stays inside problem text; nothing is invented.
function extractSections(description: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const raw of description.split("\n")) {
    const line = raw.trim();
    const m = /^(PROBLEM|SUCCESS|SCOPE|NON_GOALS|CONSTRAINTS|VALIDATION|OUTPUT)\s*:\s*(.*)$/.exec(line);
    if (m) {
      current = m[1] as string;
      sections[current] = [];
      if (m[2]) sections[current]!.push(m[2]);
      continue;
    }
    if (current && (line.startsWith("- ") || line.startsWith("* "))) sections[current]!.push(line.slice(2).trim());
  }
  return sections;
}

// Expected problem text for the notesPreserved sample check: the PROBLEM
// section when the export description carries labeled sections, else the
// description head, else the thin-source filler. Exported so the CLI receipt
// check and Core-local gates test the identical rule.
export function expectedProblemHead(description: unknown): string {
  const text = typeof description === "string" ? description : "";
  const sections = extractSections(text);
  const problem = sections["PROBLEM"]?.join("\n");
  if (problem && problem.trim()) return problem;
  if (text.trim()) return text.slice(0, 80);
  return BEADS_TBD_MARKER;
}

function mapKind(issueType: unknown): IssueKind {
  const k = typeof issueType === "string" ? issueType.toLowerCase() : "";
  if ((ISSUE_KINDS as readonly string[]).includes(k)) return k as IssueKind;
  return "task";
}

function mapStatus(status: unknown): "open" | "done" | "deferred" {
  if (status === "closed") return "done";
  if (status === "deferred") return "deferred";
  return "open";
}

interface NormalizedEdge extends BeadsEdgeRecord {
  source: "inline" | "edges-file";
}

// Inline dependencies[] are authoritative (verified live: 376 inline entries
// match the legacy bd-dep-list harvest type-for-type). --edges-file is an
// optional supplement; union dedupes by (from,to,type), inline wins.
export function unionEdges(records: BeadsIssueRecord[], fileEdges: BeadsEdgeRecord[]): NormalizedEdge[] {
  const seen = new Set<string>();
  const out: NormalizedEdge[] = [];
  const push = (issueId: string, dependsOnId: string, type: string, source: "inline" | "edges-file"): void => {
    if (!issueId || !dependsOnId || !type) return;
    const key = `${issueId}|${dependsOnId}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ issue_id: issueId, depends_on_id: dependsOnId, type, source });
  };
  for (const r of records) {
    if (!r || typeof r.id !== "string") continue;
    const deps = (r as { dependencies?: unknown }).dependencies;
    if (!Array.isArray(deps)) continue;
    for (const d of deps) {
      if (!d || typeof d !== "object") continue;
      const rec = d as Record<string, unknown>;
      const depId = typeof rec["depends_on_id"] === "string" ? (rec["depends_on_id"] as string) : null;
      // Some exporters emit {id, ...} for the dependency target instead.
      const altId = typeof rec["id"] === "string" ? (rec["id"] as string) : null;
      const type = typeof rec["type"] === "string" ? (rec["type"] as string) : null;
      if ((depId ?? altId) && type) push(r.id, (depId ?? altId) as string, type, "inline");
    }
  }
  for (const e of fileEdges) {
    if (!e || typeof e.issue_id !== "string" || typeof e.depends_on_id !== "string" || typeof e.type !== "string") continue;
    push(e.issue_id, e.depends_on_id, e.type, "edges-file");
  }
  return out;
}

export function importBeads(
  svc: IssueService,
  projectId: string,
  records: BeadsIssueRecord[],
  edges: BeadsEdgeRecord[],
  opts?: {
    authoredBy?: string;
    createProject?: { prefix: string; name: string };
    // Historical intake writer. Absent -> notes/comments are counted as
    // skipped (receipt lists them) rather than silently dropped.
    journal?: JournalService;
  },
): ImportResult {
  try {
    svc.getProject(projectId);
  } catch {
    if (!opts?.createProject) throw new Error(`unknown project: ${projectId} (pass createProject to create it on intake)`);
    svc.createProject({ id: projectId, prefix: opts.createProject.prefix, name: opts.createProject.name });
  }
  const result: ImportResult = {
    created: [],
    skippedPresent: [],
    edgesApplied: [],
    edgeErrors: [],
    unready: [],
    edgesFromInline: 0,
    edgesFromFile: 0,
    hierarchyApplied: [],
    hierarchyErrors: [],
    depFailures: [],
    notesApplied: [],
    notesSkipped: [],
    commentsApplied: [],
    commentsSkipped: [],
    closeReasonCarried: [],
    closeReasonMissing: [],
  };
  const beadToIssue = new Map<string, string>();
  const union = unionEdges(records, edges);

  for (const r of records) {
    if (!r || typeof r.id !== "string" || !r.id.trim()) continue;
    const beadsId = r.id;
    // G44: alias presence means already imported — skip without mutating.
    try {
      beadToIssue.set(beadsId, svc.resolveRef(beadsId).id);
      result.skippedPresent.push(beadsId);
      continue;
    } catch {
      /* not yet imported */
    }
    const title = str(r.title) ?? "(untitled beads import)";
    const description = str(r.description) ?? "";
    const sections = extractSections(description);
    const list = (k: string): string[] => sections[k] ?? [];
    const contract = {
      problem: str(sections["PROBLEM"]?.join("\n")) ?? (description || `${title}\n\n${TBD}`),
      success: str(sections["SUCCESS"]?.join("\n")) ?? TBD,
      scope: list("SCOPE"),
      nonGoals: list("NON_GOALS"),
      constraints: list("CONSTRAINTS"),
      validation: list("VALIDATION").map((check) => ({ check })),
      output: list("OUTPUT").map((artifact) => ({ artifact })),
    };
    if (contract.validation.length === 0) contract.validation = [{ check: TBD }];
    if (contract.output.length === 0) contract.output = [{ artifact: TBD }];
    const authoredBy = str(r.created_by) ?? opts?.authoredBy ?? "beads-import";
    const closeReason = str(r.close_reason);
    const created = svc.createIssue(
      {
        projectId,
        title,
        kind: mapKind(r.issue_type),
        contract,
        priority: typeof r.priority === "number" ? r.priority : 0,
        scrutiny: "LOW",
        authoredBy,
        aliases: [{ alias: beadsId, kind: "beads" }],
      },
      { idempotencyKey: `beads-import:${beadsId}` },
    );
    beadToIssue.set(beadsId, created.id);
    result.created.push(beadsId);
    // Import provenance (G42.1): what came from where, owned by whom.
    // close_reason travels here (absent-in-source is record-only per live
    // precedent; null/empty on closed is a data-loss signal, not silent).
    svc.appendEvent(created.id, "beads.imported", {
      beadsId,
      beadsStatus: str(r.status) ?? "open",
      beadsOwner: str(r.owner),
      beadsCloseReason: closeReason,
      authoredBy,
    });
    if (closeReason) result.closeReasonCarried.push(beadsId);
    else if (mapStatus(r.status) !== "open") result.closeReasonMissing.push(beadsId);
    // G46: no imported row may be dispatchable — no attestation exists, so
    // derived state can only be draft/blocked/claimed-free; verify the claim.
    const readiness = svc.getReadiness(created.id);
    if (!readiness.dispatchable) result.unready.push(beadsId);
    else throw new Error(`import refused: ${beadsId} would land dispatchable (fail-closed, G46)`);

    // Historical intake: notes + comments -> journal kind "note" with beads
    // provenance refs. Contract text is never polluted. Dedup by existence
    // check on the beads marker so partial-failure resume never doubles
    // entries (reruns skip created issues entirely).
    const journal = opts?.journal;
    const noteTexts: Array<{ key: string; text: string; author: string | null; createdAt: string | null }> = [];
    // notes is a string in real `bd export` output; array-form (or any other
    // present-but-unhandled shape) must never vanish silently — ingest what
    // has text, count the rest as skipped so the receipt stays loud.
    const notesRaw = (r as { notes?: unknown }).notes;
    if (typeof notesRaw === "string" && notesRaw.trim()) {
      noteTexts.push({ key: `beads-note:${beadsId}`, text: notesRaw, author: str(r.created_by), createdAt: null });
    } else if (Array.isArray(notesRaw)) {
      let idx = 0;
      for (const n of notesRaw) {
        if (!n || typeof n !== "object") continue;
        const rec = n as Record<string, unknown>;
        const text = str(rec["text"]);
        if (!text) continue;
        noteTexts.push({
          key: `beads-note:${beadsId}:${str(rec["id"]) ?? `index:${idx}`}`,
          text,
          author: str(rec["author"]) ?? str(r.created_by),
          createdAt: str(rec["created_at"]) ?? str(rec["created"]),
        });
        idx += 1;
      }
      if (idx === 0) result.notesSkipped.push(beadsId);
    } else if (notesRaw !== undefined && notesRaw !== null) {
      result.notesSkipped.push(beadsId);
    }
    const comments = (r as { comments?: unknown }).comments;
    if (Array.isArray(comments)) {
      for (const c of comments) {
        if (!c || typeof c !== "object") continue;
        const rec = c as Record<string, unknown>;
        const text = str(rec["text"]);
        const cid = str(rec["id"]) ?? `index:${comments.indexOf(c)}`;
        if (!text) continue;
        noteTexts.push({
          key: `beads-comment:${cid}`,
          text,
          author: str(rec["author"]),
          createdAt: str(rec["created_at"]),
        });
      }
    }
    if (noteTexts.length === 0) continue;
    if (!journal) {
      for (const n of noteTexts) {
        if (n.key.startsWith("beads-note:")) result.notesSkipped.push(beadsId);
        else result.commentsSkipped.push(n.key);
      }
      continue;
    }
    const existing = new Set<string>();
    for (const e of journal.listEntries(created.id, { kind: "note", limit: 10000 })) {
      for (const ref of e.refs ?? []) {
        if (ref.kind === "beads-history") existing.add(ref.key);
      }
    }
    for (const n of noteTexts) {
      if (existing.has(n.key)) {
        if (n.key.startsWith("beads-note:")) result.notesSkipped.push(beadsId);
        else result.commentsSkipped.push(n.key);
        continue;
      }
      journal.appendEntry(created.id, {
        kind: "note",
        participantId: "beads-import",
        semantic: { summary: n.text },
        refs: [
          {
            kind: "beads-history",
            key: n.key,
            value: { beadsIssue: beadsId, author: n.author, createdAt: n.createdAt },
          },
        ],
      });
      existing.add(n.key);
      // notesApplied counts issues with notes ingested (once per issue);
      // commentsApplied counts ingested comment keys.
      if (n.key.startsWith("beads-note:")) {
        if (!result.notesApplied.includes(beadsId)) result.notesApplied.push(beadsId);
      } else result.commentsApplied.push(n.key);
    }
  }

  // Lifecycle after creation: closed beads rest as done, the rest stay open.
  // G44: rows skipped as already-present are never re-touched — setLifecycle
  // unconditionally UPDATEs + appends an event, so re-setting a skipped row
  // would clobber triage timestamps on every rerun. Skipped rows are applied
  // only when their live state actually differs (crash-resume safety).
  const createdThisRun = new Set(result.created);
  for (const r of records) {
    if (!r || typeof r.id !== "string") continue;
    const issueId = beadToIssue.get(r.id);
    if (!issueId) continue;
    const target = mapStatus(r.status);
    if (target === "open") continue;
    if (!createdThisRun.has(r.id)) {
      if (svc.getIssue(issueId).lifecycleState === target) continue;
    }
    svc.setLifecycleState(issueId, target);
  }

  // Edges second pass (both endpoints must exist). Verified live semantics:
  // parent-child {A depends-on B} ⇒ A child of B; blocks {A depends-on B}
  // ⇒ B blocks A (B is the prerequisite).
  // G44 for edges: per-edge idempotency keys make re-application a no-op,
  // so resume/re-run never grows the edge table (A9 check 7).
  for (const e of union) {
    const a = beadToIssue.get(e.issue_id);
    const b = beadToIssue.get(e.depends_on_id);
    if (!a || !b) {
      const msg = `${e.issue_id} -> ${e.depends_on_id} [${e.type}]: endpoint not imported`;
      result.edgeErrors.push(msg);
      if (e.source === "inline") result.depFailures.push(msg);
      continue;
    }
    // Beads edge vocabulary observed live: parent-child, blocks, validates,
    // discovered-from, relates-to, supersedes. Non-blocking kinds map to
    // their Substrate counterpart; unknown kinds degrade to relates_to.
    const kindMap: Record<string, "parent_child" | "blocks" | "relates_to" | "discovered_from" | "supersedes"> = {
      "parent-child": "parent_child",
      blocks: "blocks",
      "discovered-from": "discovered_from",
      supersedes: "supersedes",
      "relates-to": "relates_to",
      validates: "relates_to",
    };
    try {
      const kind = kindMap[e.type] ?? "relates_to";
      if (kind === "parent_child") {
        // setParent short-circuits on identical reparent; the key makes
        // resume-before-commit safe as well.
        svc.setParent(a, b, { idempotencyKey: `beads-parent:${e.issue_id}` });
        result.hierarchyApplied.push({ parent: e.depends_on_id, child: e.issue_id });
      } else {
        const key = `beads-edge:${e.issue_id}:${e.depends_on_id}:${kind}`;
        if (kind === "blocks") {
          const edge = svc.addEdge(b, a, kind, { idempotencyKey: key });
          result.edgesApplied.push({ from: e.depends_on_id, to: e.issue_id, kind: edge.kind });
        } else {
          const edge = svc.addEdge(a, b, kind, { idempotencyKey: key });
          result.edgesApplied.push({ from: e.issue_id, to: e.depends_on_id, kind: edge.kind });
        }
      }
      if (e.source === "inline") result.edgesFromInline += 1;
      else result.edgesFromFile += 1;
    } catch (err) {
      const msg = `${e.issue_id} -> ${e.depends_on_id} [${e.type}]: ${err instanceof Error ? err.message : String(err)}`;
      if (kindMap[e.type] === "parent_child") result.hierarchyErrors.push(msg);
      else result.edgeErrors.push(msg);
      if (e.source === "inline") result.depFailures.push(msg);
    }
  }
  return result;
}
