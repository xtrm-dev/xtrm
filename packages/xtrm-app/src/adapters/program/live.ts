import type { ProgramAdapter, ProgramItem, ProgramItemKind, ProgramView } from "../types.ts";

// Subset of `ProgrammeSnapshotResponse` (schema v3) from `Jaggerxtrm/console`
// apps/console/src/types/programme.ts @ 4b0d9f5. Only fields read here.

interface WireRecord {
  id: string;
  title: string;
  status: string;
  path: string;
  updated_at?: string | null;
  jira_refs: string[];
  metadata: Record<string, unknown>;
}

export interface WireProgrammeResponse {
  snapshot: {
    generated_at: string;
    programme: { repository: string; branch: string; short_sha?: string | null };
    now: { title: string; evidence_cutoff?: string | null } | null;
    workstreams: WireRecord[];
    assignments: WireRecord[];
    decisions: WireRecord[];
    activity: Array<{ sha: string; date: string; subject: string; url: string }>;
  } | null;
  freshness: "fresh" | "stale" | "degraded";
  source_health: { message?: string };
  error?: string | null;
}

// Programme snapshot v3 has no typed reference to Substrate Issues. Until the
// contract gains one, `metadata.executable_refs` (string[]) is read if present.
function issueRefs(metadata: Record<string, unknown>): string[] {
  const refs = metadata.executable_refs;
  return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [];
}

const item = (kind: ProgramItemKind) => (r: WireRecord): ProgramItem => ({
  id: r.id,
  kind,
  title: r.title,
  status: r.status,
  path: r.path,
  updatedAt: r.updated_at ?? null,
  jiraRefs: r.jira_refs,
  issueRefs: issueRefs(r.metadata),
});

export function mapProgramme(res: WireProgrammeResponse): ProgramView {
  const s = res.snapshot;
  if (!s) throw new Error(res.error ?? "programme snapshot unavailable");
  return {
    source: { repository: s.programme.repository, branch: s.programme.branch, shortSha: s.programme.short_sha ?? null, generatedAt: s.generated_at },
    freshness: res.freshness,
    healthMessage: res.source_health.message ?? res.error ?? null,
    now: s.now ? { title: s.now.title, evidenceCutoff: s.now.evidence_cutoff ?? null } : null,
    items: [...s.workstreams.map(item("workstream")), ...s.assignments.map(item("assignment")), ...s.decisions.map(item("decision"))],
    activity: s.activity,
  };
}

export const liveProgram: ProgramAdapter = {
  source: "live",
  async snapshot() {
    const res = await fetch("/api/programme");
    if (res.status === 404) throw new Error("Program read model is disabled on the Console backend (programme_dashboard_disabled)");
    if (!res.ok) throw new Error(`Program backend returned ${res.status}`);
    return mapProgramme((await res.json()) as WireProgrammeResponse);
  },
};
