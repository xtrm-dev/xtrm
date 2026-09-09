// Beads import compatibility (Phase 11, bead xtrm-7wc.12; PRD §42.1).
// One-shot migration intake, not a runtime backend: reads the passive Beads
// JSONL export plus a `bd dep list --json` edge batch, creates Substrate
// issues with Beads IDs as durable aliases, and never upgrades thin work.
// Idempotent (G44): re-running skips aliases already present, so resume is
// just re-run. No writes ever go back to Beads: no dual-write (§42).

import { IssueService } from "../../service/issue-service.ts";
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
}

const TBD = "TBD — imported from Beads; pending XTRM planning";

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

export function importBeads(
  svc: IssueService,
  projectId: string,
  records: BeadsIssueRecord[],
  edges: BeadsEdgeRecord[],
  opts?: { authoredBy?: string; createProject?: { prefix: string; name: string } },
): ImportResult {
  try {
    svc.getProject(projectId);
  } catch {
    if (!opts?.createProject) throw new Error(`unknown project: ${projectId} (pass createProject to create it on intake)`);
    svc.createProject({ id: projectId, prefix: opts.createProject.prefix, name: opts.createProject.name });
  }
  const result: ImportResult = { created: [], skippedPresent: [], edgesApplied: [], edgeErrors: [], unready: [] };
  const beadToIssue = new Map<string, string>();

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
    svc.appendEvent(created.id, "beads.imported", {
      beadsId,
      beadsStatus: str(r.status) ?? "open",
      beadsOwner: str(r.owner),
      authoredBy,
    });
    // G46: no imported row may be dispatchable — no attestation exists, so
    // derived state can only be draft/blocked/claimed-free; verify the claim.
    const readiness = svc.getReadiness(created.id);
    if (!readiness.dispatchable) result.unready.push(beadsId);
    else throw new Error(`import refused: ${beadsId} would land dispatchable (fail-closed, G46)`);
  }

  // Lifecycle after creation: closed beads rest as done, the rest stay open.
  for (const r of records) {
    if (!r || typeof r.id !== "string") continue;
    const issueId = beadToIssue.get(r.id);
    if (!issueId) continue;
    const target = mapStatus(r.status);
    if (target !== "open") svc.setLifecycleState(issueId, target);
  }

  // Edges second pass (both endpoints must exist). Verified live semantics:
  // parent-child {A depends-on B} ⇒ A child of B; blocks {A depends-on B}
  // ⇒ B blocks A (B is the prerequisite).
  for (const e of edges) {
    const a = beadToIssue.get(e.issue_id);
    const b = beadToIssue.get(e.depends_on_id);
    if (!a || !b) {
      result.edgeErrors.push(`${e.issue_id} -> ${e.depends_on_id} [${e.type}]: endpoint not imported`);
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
        svc.setParent(a, b);
        result.edgesApplied.push({ from: b, to: a, kind });
      } else if (kind === "blocks") {
        const edge = svc.addEdge(b, a, kind);
        result.edgesApplied.push({ from: b, to: a, kind: edge.kind });
      } else {
        const edge = svc.addEdge(a, b, kind);
        result.edgesApplied.push({ from: a, to: b, kind: edge.kind });
      }
    } catch (err) {
      result.edgeErrors.push(`${e.issue_id} -> ${e.depends_on_id} [${e.type}]: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
