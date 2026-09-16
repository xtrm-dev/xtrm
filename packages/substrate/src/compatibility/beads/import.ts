// Beads import compatibility (Phase 11, bead xtrm-7wc.12; PRD §42.1).
// One-shot migration intake, not a runtime backend: reads the passive Beads
// JSONL export (issues carry inline `dependencies[]`, `notes`, `comments[]`,
// `close_reason` — verified live, A9 receipt v3), creates Substrate issues
// with Beads IDs as durable aliases, and never upgrades thin work.
// Idempotent (G44): re-running skips aliases already present AND re-applies
// edges/hierarchy under per-edge idempotency keys, so resume is just re-run
// with zero row growth. No writes ever go back to Beads: no dual-write (§42).

import type { IssueService } from "../../service/issue-service.ts";
import type { JournalService } from "../../service/journal-service.ts";
import type { ClosureService } from "../../service/closure-service.ts";
import type { EdgeKind } from "../../domain/edge.ts";
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
  // Source fields with no first-class Substrate destination (XTRM-405).
  // Captured into the durable `beads.imported` provenance event so they stay
  // recoverable; never routed into `contextRefs` or `ownership`.
  labels?: unknown;
  external_ref?: unknown;
  assignee?: unknown;
  started_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  closed_at?: unknown;
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
  // Parent-child links the single-parent model could not represent: the child
  // was already parented by an earlier link in this import, and Substrate holds
  // one parent per child. Reported, never silently dropped.
  hierarchySuperseded: Array<{ parent: string; child: string }>;
  // Parent-child links refused by the single-parent model because the source
  // board declares a cycle. Substrate refuses the cycle by design; the link is
  // declared here so a re-run never looks like a silent failure.
  hierarchyRefused: Array<{ parent: string; child: string; reason: string }>;
  hierarchyErrors: string[];
  // Cross-board references (`external:<board>:<id>`): the endpoint belongs to
  // another project's board and must never be imported here. Declared, not an
  // import error; the link is materialisable once that board lands.
  externalRefs: string[];
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
  // -- XTRM-405 fidelity fields (all additive; the receipt schema version and
  // existing consumers are unaffected).
  // ATX headings in the source description that map to no contract section.
  // Counted so unrecognized source content is never lost silently.
  unmappedSections: Array<{ beadsId: string; heading: string; lines: number }>;
  // Census-visible dependency entries that could not be resolved to a target.
  // Every one of these fails the verdict: a parse-blind export must not PASS.
  unresolvedEntries: string[];
  // bd edge types with no faithful Substrate counterpart. Declared with their
  // source type; never applied, never downgraded into a different kind.
  unrepresentableEdges: Array<{ from: string; to: string; type: string; reason: string }>;
  // Edges applied under a kind that is a deliberate lossy mapping (e.g.
  // `validates` -> `relates_to`). Named so the downgrade is never silent.
  downgradedEdges: Array<{ from: string; to: string; type: string; kind: string }>;
  // Source fields recovered into the durable `beads.imported` provenance
  // event, because Substrate has no first-class destination for them. Lists
  // carry Beads ids so the receipt stays bounded on a large board.
  sourceFields: {
    labels: string[];
    externalRefs: string[];
    assignees: string[];
    startedAt: string[];
    issueTypesRemapped: Array<{ beadsId: string; sourceType: string; kind: string }>;
  };
}

const TBD = "TBD — imported from Beads; pending XTRM planning";

// Marker the verifier samples for (thin-source filler). Exported so the CLI
// receipt check and Core-local gates test the identical string.
export const BEADS_TBD_MARKER = TBD;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

// -- section extraction (XTRM-405) ---------------------------------------------
// Real `bd export` descriptions are markdown: `## PROBLEM`, `## SCOPE (agreed
// model)`, sometimes `# PROBLEM`, sometimes the labeled `PROBLEM:` form. The
// original extractor matched labeled `KEY:` headers on a trimmed line only and
// collected `- `/`* ` bullets only, so on real exports ZERO sections were
// recognized and the entire description fell through to `problem` (measured:
// 66/66 imported revisions carried the filler). This extractor recognizes ATX
// headings and the labeled form, keeps arbitrary prose bodies, and reports
// headings it could not map rather than discarding them silently.

export const SECTION_KEYS = ["PROBLEM", "SUCCESS", "SCOPE", "NON_GOALS", "CONSTRAINTS", "VALIDATION", "OUTPUT"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface UnmappedSection {
  heading: string;
  lines: number;
}

export interface SectionExtraction {
  sections: Partial<Record<SectionKey, string[]>>;
  /** Contract section headings recognized, in source order. */
  recognized: SectionKey[];
  /** ATX headings that are not contract sections. Counted, never fabricated. */
  unmapped: UnmappedSection[];
}

// `NON-GOALS`, `NON GOALS` and `NON_GOALS` all normalize onto the contract key,
// and the combined `NON_GOALS / CONSTRAINTS` heading populates both. A heading
// with any unrecognized part is not a contract heading at all (null), so
// `## REFERENCES` can never half-populate a field.
function normalizeHeading(label: string): SectionKey[] | null {
  // Real exports qualify their headings: `## SCOPE (agreed model)`,
  // `## OUTPUT (handoff schema)`, `## VALIDATION (must pass before handoff)`.
  // Drop a trailing parenthetical qualifier before matching. A heading whose
  // remaining text is not a contract section stays unmapped, so a numbered or
  // otherwise unrelated heading is never forced into a field.
  let base = label.replace(/:+\s*$/, "");
  while (/\s*\([^()]*\)\s*$/.test(base)) base = base.replace(/\s*\([^()]*\)\s*$/, "");
  const parts = base
    .split("/")
    .map((p) => p.trim().toUpperCase().replace(/[\s-]+/g, "_"))
    .filter((p) => p !== "");
  if (parts.length === 0) return null;
  const keys: SectionKey[] = [];
  for (const p of parts) {
    if (!(SECTION_KEYS as readonly string[]).includes(p)) return null;
    if (!keys.includes(p as SectionKey)) keys.push(p as SectionKey);
  }
  return keys;
}

const ATX_HEADING = /^#{1,6}\s+(.*?)\s*$/;
const LABELED_HEADING = /^([A-Za-z][A-Za-z0-9 _/-]*?)\s*:\s*(.*)$/;
const BULLET = /^([-*+]|\d{1,3}[.)])\s+(.*)$/;

// Split a body into items: a bullet starts an item, a blank line ends one, and
// continuation lines attach to the item in progress. Bullet markers are
// stripped so an item is the text, not the markup (matching the original
// `line.slice(2).trim()` convention).
function splitItems(lines: string[]): string[] {
  const items: string[] = [];
  let cur: string[] | null = null;
  const flush = (): void => {
    if (cur !== null) {
      const text = cur.join("\n").trim();
      if (text) items.push(text);
    }
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line.trim());
    if (bullet) {
      flush();
      cur = [bullet[2]!.trim()];
      continue;
    }
    if (cur === null) cur = [line.trim()];
    else cur.push(line.trim());
  }
  flush();
  return items;
}

export function extractSectionsDetailed(description: string): SectionExtraction {
  const out: SectionExtraction = { sections: {}, recognized: [], unmapped: [] };
  const bodies = new Map<SectionKey, string[]>();
  let current: SectionKey[] | null = null;
  let unmappedIdx: number | null = null;
  let sawHeading = false;
  for (const raw of description.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed !== "") {
      const atx = ATX_HEADING.exec(trimmed);
      const labeled = atx ? null : LABELED_HEADING.exec(trimmed);
      if (atx || labeled) {
        const label = (atx ? atx[1] : labeled![1])!;
        const rest = atx ? "" : labeled![2]!;
        const keys = normalizeHeading(label);
        sawHeading = true;
        if (keys === null) {
          // A labeled form only counts as a heading when it names a contract
          // section; otherwise it is ordinary prose (`Note: ...`). An ATX
          // heading is unambiguous, so it is reported as unmapped.
          if (atx) {
            current = null;
            out.unmapped.push({ heading: trimmed, lines: 0 });
            unmappedIdx = out.unmapped.length - 1;
            continue;
          }
        } else {
          current = keys;
          unmappedIdx = null;
          for (const k of keys) {
            if (!bodies.has(k)) bodies.set(k, []);
            if (!out.recognized.includes(k)) out.recognized.push(k);
          }
          if (rest.trim() !== "") for (const k of keys) bodies.get(k)!.push(rest);
          continue;
        }
      }
    }
    if (!sawHeading) continue; // preamble before any heading is not a section body
    if (current === null) {
      // Body text under an unmapped heading: count it so the receipt is loud.
      if (trimmed !== "" && unmappedIdx !== null) out.unmapped[unmappedIdx]!.lines += 1;
      continue;
    }
    if (trimmed === "") continue;
    for (const k of current) bodies.get(k)!.push(line);
  }
  for (const [k, lines] of bodies) out.sections[k] = splitItems(lines);
  return out;
}

// Back-compat shape for callers and gates that want only the section map.
function extractSections(description: string): Record<string, string[]> {
  return extractSectionsDetailed(description).sections as Record<string, string[]>;
}

// Expected problem text for the notesPreserved sample check: the PROBLEM
// section when the export description carries sections, else the description
// head, else the thin-source filler. Exported so the CLI receipt check and
// Core-local gates test the identical rule.
export function expectedProblemHead(description: unknown): string {
  const text = typeof description === "string" ? description : "";
  const sections = extractSections(text);
  const problem = sections["PROBLEM"]?.join("\n");
  if (problem && problem.trim()) return problem;
  if (text.trim()) return text.slice(0, 80);
  return BEADS_TBD_MARKER;
}

// True when the source description carries at least one recognized contract
// section. Used by the verifier to decide whether the filler marker is a
// legitimate expectation or a symptom (XTRM-405 success 1).
export function hasRecognizedSections(description: unknown): boolean {
  return extractSectionsDetailed(typeof description === "string" ? description : "").recognized.length > 0;
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

// An entry the census counted (it carries a `type`) but that could not be
// resolved to a target. Reported, never dropped silently: before XTRM-405 the
// union simply skipped these, so a parse-blind export made the union and every
// check derived from it shrink together and still report PASS.
export interface DroppedEdge {
  source: "inline" | "edges-file";
  issue_id: string;
  depends_on_id: string | null;
  type: string;
  reason: string;
}

export interface UnionReport {
  edges: NormalizedEdge[];
  dropped: DroppedEdge[];
  /** Entries that duplicated an earlier (from,to,type) triple; inline wins. */
  collapsed: number;
}

// Inline dependencies[] are authoritative (verified live: 376 inline entries
// match the legacy bd-dep-list harvest type-for-type). --edges-file is an
// optional supplement; union dedupes by (from,to,type), inline wins.
export function unionEdgesDetailed(records: BeadsIssueRecord[], fileEdges: BeadsEdgeRecord[]): UnionReport {
  const seen = new Set<string>();
  const edges: NormalizedEdge[] = [];
  const dropped: DroppedEdge[] = [];
  let collapsed = 0;
  const push = (issueId: string | null, dependsOnId: string | null, type: string, source: "inline" | "edges-file"): void => {
    if (!issueId || !dependsOnId) {
      dropped.push({
        source,
        issue_id: issueId ?? "",
        depends_on_id: dependsOnId,
        type,
        reason: !issueId ? "dependency entry has no source issue id" : "dependency entry has no resolvable target id",
      });
      return;
    }
    const key = `${issueId}|${dependsOnId}|${type}`;
    if (seen.has(key)) {
      collapsed += 1;
      return;
    }
    seen.add(key);
    edges.push({ issue_id: issueId, depends_on_id: dependsOnId, type, source });
  };
  for (const r of records) {
    if (!r || typeof r.id !== "string") continue;
    const deps = (r as { dependencies?: unknown }).dependencies;
    if (!Array.isArray(deps)) continue;
    for (const d of deps) {
      if (!d || typeof d !== "object") continue;
      const rec = d as Record<string, unknown>;
      const type = typeof rec["type"] === "string" ? (rec["type"] as string) : null;
      // Census parity: the CLI counts an inline entry only when it carries a
      // string `type`, so only those entries are subject to reconciliation.
      if (type === null) continue;
      const depId = typeof rec["depends_on_id"] === "string" ? (rec["depends_on_id"] as string) : null;
      // Some exporters emit {id, ...} for the dependency target instead.
      const altId = typeof rec["id"] === "string" ? (rec["id"] as string) : null;
      push(r.id, depId ?? altId, type, "inline");
    }
  }
  for (const e of fileEdges) {
    const rec = e as unknown as Record<string, unknown> | null;
    const type = rec && typeof rec["type"] === "string" ? (rec["type"] as string) : null;
    if (type === null) {
      dropped.push({ source: "edges-file", issue_id: "", depends_on_id: null, type: "", reason: "file edge entry has no string type" });
      continue;
    }
    const issueId = typeof rec!["issue_id"] === "string" ? (rec!["issue_id"] as string) : null;
    const depId = typeof rec!["depends_on_id"] === "string" ? (rec!["depends_on_id"] as string) : null;
    push(issueId, depId, type, "edges-file");
  }
  return { edges, dropped, collapsed };
}

export function unionEdges(records: BeadsIssueRecord[], fileEdges: BeadsEdgeRecord[]): NormalizedEdge[] {
  return unionEdgesDetailed(records, fileEdges).edges;
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
    // First-class Closure intake (C1): closed records land a Closure row
    // (source=beads) instead of burying the reason in event prose. Absent
    // -> legacy behavior (lifecycle only), so direct-service callers that
    // predate C1 keep working.
    closures?: ClosureService;
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
    hierarchySuperseded: [],
    hierarchyRefused: [],
    hierarchyErrors: [],
    externalRefs: [],
    depFailures: [],
    notesApplied: [],
    notesSkipped: [],
    commentsApplied: [],
    commentsSkipped: [],
    closeReasonCarried: [],
    closeReasonMissing: [],
    unmappedSections: [],
    unresolvedEntries: [],
    unrepresentableEdges: [],
    downgradedEdges: [],
    sourceFields: { labels: [], externalRefs: [], assignees: [], startedAt: [], issueTypesRemapped: [] },
  };
  const beadToIssue = new Map<string, string>();
  const union = unionEdgesDetailed(records, edges);
  // A census-visible entry with no resolvable target is a parse-level failure,
  // not an accounted-for outcome. It lands on a named failure list so the
  // verdict fails and check 0c names the entries (XTRM-405 success 4).
  for (const d of union.dropped) {
    const msg = `${d.issue_id || "(no source)"} -> ${d.depends_on_id ?? "(no target)"} [${d.type || "(no type)"}]: ${d.reason}`;
    result.unresolvedEntries.push(msg);
    if (d.source === "inline") result.depFailures.push(msg);
  }

  for (const r of records) {
    if (!r || typeof r.id !== "string" || !r.id.trim()) continue;
    const beadsId = r.id;
    // G44: alias presence means already imported — skip without mutating.
    // Exact alias lookup, never resolveRef: a legacy id shaped like a durable
    // ref (id `core-076` parses as CORE-76) would otherwise match an unrelated
    // issue, skip the record, and re-point its edges at that issue.
    const imported = svc.issueIdForAlias(beadsId);
    if (imported !== null) {
      beadToIssue.set(beadsId, imported);
      result.skippedPresent.push(beadsId);
      continue;
    }
    const title = str(r.title) ?? "(untitled beads import)";
    const description = str(r.description) ?? "";
    const extraction = extractSectionsDetailed(description);
    const sections: Record<string, string[]> = extraction.sections as Record<string, string[]>;
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
    for (const u of extraction.unmapped) {
      result.unmappedSections.push({ beadsId, heading: u.heading, lines: u.lines });
    }
    const authoredBy = str(r.created_by) ?? opts?.authoredBy ?? "beads-import";
    const closeReason = str(r.close_reason);
    const kind = mapKind(r.issue_type);
    const created = svc.createIssue(
      {
        projectId,
        title,
        kind,
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
    //
    // XTRM-405: source fields with no first-class Substrate destination are
    // captured here so they stay recoverable. They are deliberately NOT in
    // `contextRefs` — `resolveInheritedContext` (readiness.ts:213-236) merges
    // refs down the parent chain, tags non-leaf entries `inherited`, feeds them
    // into a resolved hash, and throws fail-closed for `journal`/`memory` kinds:
    // it is execution-planning input, not inert provenance. Nor in `ownership`,
    // whose fields are repositories/paths/services/interfaces — technical
    // scope, not a person.
    const labels = Array.isArray(r.labels) ? r.labels.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
    const externalRef = str(r.external_ref);
    const assignee = str(r.assignee);
    const startedAt = str(r.started_at);
    const sourceType = str(r.issue_type);
    svc.appendEvent(created.id, "beads.imported", {
      beadsId,
      beadsStatus: str(r.status) ?? "open",
      beadsOwner: str(r.owner),
      beadsCloseReason: closeReason,
      authoredBy,
      beadsLabels: labels.length > 0 ? labels : null,
      beadsExternalRef: externalRef,
      beadsAssignee: assignee,
      beadsStartedAt: startedAt,
      beadsIssueType: sourceType,
    });
    if (labels.length > 0) result.sourceFields.labels.push(beadsId);
    if (externalRef) result.sourceFields.externalRefs.push(beadsId);
    if (assignee) result.sourceFields.assignees.push(beadsId);
    if (startedAt) result.sourceFields.startedAt.push(beadsId);
    if (sourceType && sourceType.toLowerCase() !== kind) {
      result.sourceFields.issueTypesRemapped.push({ beadsId, sourceType, kind });
    }
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
  for (const e of union.edges) {
    const a = beadToIssue.get(e.issue_id);
    const b = beadToIssue.get(e.depends_on_id);
    if (!a || !b) {
      const msg = `${e.issue_id} -> ${e.depends_on_id} [${e.type}]: endpoint not imported`;
      // A cross-board reference is foreign by design, not a failed import.
      if (/^external:/i.test(e.issue_id) || /^external:/i.test(e.depends_on_id)) {
        result.externalRefs.push(msg);
        continue;
      }
      result.edgeErrors.push(msg);
      if (e.source === "inline") result.depFailures.push(msg);
      continue;
    }
    // bd edge vocabulary -> Substrate kinds (XTRM-405). `null` means bd carries
    // a distinct semantic that Substrate cannot represent faithfully; those are
    // declared in the receipt rather than downgraded into a different kind.
    const kindMap: Record<string, EdgeKind | null> = {
      "parent-child": "parent_child",
      blocks: "blocks",
      "discovered-from": "discovered_from",
      supersedes: "supersedes",
      "relates-to": "relates_to",
      // bd's generic alias (`related` is its Linear-mapping fallback).
      related: "relates_to",
      duplicates: "duplicates",
      // Lossy but DECLARED: Substrate has no `validates` kind. Kept as
      // relates_to so the graph stays connected; named in the receipt.
      validates: "relates_to",
      // No faithful counterpart, so NOT applied. Verified against
      // /var/tmp/beads-main-inspect/internal/types/types.go: `waits-for` is a
      // fanout gate on the spawner's dynamic children (WaitsForMeta /
      // ParseWaitsForGateMetadata at types.go:1489, `also_blocks` at
      // types.go:1319-1322), and `conditional-blocks` means "runs only if the
      // other failed", resolved by IsFailureClose (types.go:1539). Plain
      // `blocks` waits on the target itself: a different and strictly stronger
      // constraint, so neither may be mapped onto it.
      "waits-for": null,
      "conditional-blocks": null,
    };
    // Types whose bd semantic survives the mapping intact. Anything else is a
    // deliberate lossy mapping and is named so the downgrade is never silent.
    const faithfulTypes = new Set(["parent-child", "blocks", "discovered-from", "supersedes", "relates-to", "related", "duplicates"]);
    const mapped: EdgeKind | null = Object.prototype.hasOwnProperty.call(kindMap, e.type)
      ? (kindMap[e.type] as EdgeKind | null)
      : "relates_to";
    if (mapped === null) {
      result.unrepresentableEdges.push({
        from: e.issue_id,
        to: e.depends_on_id,
        type: e.type,
        reason: `bd edge type "${e.type}" has no faithful Substrate counterpart`,
      });
      continue;
    }
    const kind: EdgeKind = mapped;
    if (!faithfulTypes.has(e.type)) {
      result.downgradedEdges.push({ from: e.issue_id, to: e.depends_on_id, type: e.type, kind });
    }
    try {
      if (kind === "parent_child") {
        // setParent short-circuits on identical reparent; the key makes
        // resume-before-commit safe as well.
        svc.setParent(a, b, { idempotencyKey: `beads-parent:${e.issue_id}` });
        // Single-parent model: a child declared under two parents keeps the
        // first (the per-child key makes the later call a no-op). Record what
        // actually holds; the superseded link is reported, not counted as
        // applied — otherwise the verifier's hierarchy check reports a state
        // the database was never going to reach.
        if (svc.listChildren(b).some((c) => c.id === a)) {
          result.hierarchyApplied.push({ parent: e.depends_on_id, child: e.issue_id });
        } else {
          result.hierarchySuperseded.push({ parent: e.depends_on_id, child: e.issue_id });
        }
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
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `${e.issue_id} -> ${e.depends_on_id} [${e.type}]: ${detail}`;
      const cycleRefused = /parent cycle rejected/.test(detail);
      if (kind === "parent_child" && cycleRefused) {
        // Source-board cycle: Substrate refuses it by design, so it is a
        // declared refusal rather than an import failure.
        result.hierarchyRefused.push({ parent: e.depends_on_id, child: e.issue_id, reason: detail });
      } else if (kind === "parent_child") {
        result.hierarchyErrors.push(msg);
      } else {
        result.edgeErrors.push(msg);
      }
      if (e.source === "inline" && !cycleRefused) result.depFailures.push(msg);
    }
  }
  // Closure intake (C1): every record that rests terminal gets a Closure
  // row preserving the verbatim reason, legacy status, transition
  // timestamp, and recorded author with source=beads. Open records get no
  // row; reruns are idempotent (recordBeadsClosure skips issues that
  // already carry a Closure). The beads.imported event above stays as
  // import provenance; the Closure row is the queryable authority.
  const closures = opts?.closures;
  if (closures) {
    for (const r of records) {
      if (!r || typeof r.id !== "string") continue;
      const issueId = beadToIssue.get(r.id);
      if (!issueId) continue;
      const target = mapStatus(r.status);
      if (target === "open") continue;
      const author = str(r.created_by) ?? opts?.authoredBy ?? "beads-import";
      closures.recordBeadsClosure(issueId, {
        reason: str(r.close_reason) ?? "",
        actor: author,
        legacyState: str(r.status) ?? "closed",
      });
    }
  }
  return result;
}
