import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { resolveForSubmit } from "../adapters/agent/references.ts";
import { useAdapters, type AgentRef, type RefCandidate, type RefKind, type SubmitInput } from "../adapters/index.tsx";
import { useGithubIssues, usePulls } from "../app/queries.ts";
import { useIssueIndex } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";

/** Pushed host changes invalidate the affected queries; nothing polls (PRD §35.5). */
export function useAgentLive() {
  const { agent } = useAdapters();
  const qc = useQueryClient();
  useEffect(
    () =>
      agent.subscribe((id) => {
        void qc.invalidateQueries({ queryKey: ["agent", "sessions"] });
        // An empty id means every session changed (the adapter switched hosts).
        void qc.invalidateQueries({ queryKey: id ? ["agent", "session", id] : ["agent", "session"] });
      }),
    [agent, qc],
  );
}

export function useAgentSessions() {
  const { agent } = useAdapters();
  return useQuery({ queryKey: ["agent", "sessions"], queryFn: () => agent.listSessions(), staleTime: 30_000 });
}

export function useAgentSession(id: string | null) {
  const { agent } = useAdapters();
  return useQuery({ queryKey: ["agent", "session", id], queryFn: () => agent.getSession(id!), enabled: !!id, staleTime: 30_000 });
}

export function useSubmit(sessionId: string) {
  const { agent } = useAdapters();
  return useMutation({ mutationFn: (input: SubmitInput) => agent.submit(sessionId, input) });
}

export function useRespond(sessionId: string) {
  const { agent } = useAdapters();
  return useMutation({ mutationFn: ({ activityId, answer }: { activityId: string; answer: string | null }) => agent.respond(sessionId, activityId, answer) });
}

export function useAbort(sessionId: string) {
  const { agent } = useAdapters();
  return useMutation({ mutationFn: () => agent.abort(sessionId) });
}

export type PickerKind = RefKind | "all";

const HOST_KINDS = ["commit", "file", "session"] as const;

/**
 * `@` picker candidates. Each kind resolves through its own adapter (PRD §36.6):
 * Substrate for issues, GitHub for PRs and GitHub issues, the agent host for commits, files, and sessions.
 */
export function useReferenceCandidates(query: string, kind: PickerKind, enabled: boolean, sessionId?: string): RefCandidate[] {
  const { agent } = useAdapters();
  const { repo } = useShell();
  const issues = useIssueIndex();
  const pulls = usePulls(repo.fullName, "open");
  const ghIssues = useGithubIssues(repo.fullName);
  const host = useQueries({
    queries: HOST_KINDS.map((k) => ({
      queryKey: ["agent", "refs", k, query, repo.fullName, sessionId],
      queryFn: () => agent.searchReferences(query, k, repo.fullName, sessionId),
      enabled: enabled && (kind === "all" || kind === k),
      staleTime: 30_000,
    })),
  });
  const hostData = host.map((h) => h.data);

  return useMemo(() => {
    if (!enabled) return [];
    const q = query.trim().toLowerCase();
    const hit = (c: RefCandidate) => !q || c.ref.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
    const seen = new Set<string>();
    const issueRows: RefCandidate[] = [];
    for (const i of issues.values()) {
      if (seen.has(i.ref)) continue;
      seen.add(i.ref);
      if (i.lifecycle === "open") issueRows.push({ kind: "issue", ref: i.ref, title: i.title, detail: i.locator !== i.ref ? i.locator : undefined });
    }
    const groups: Record<RefKind, RefCandidate[]> = {
      issue: issueRows,
      "gh-issue": (ghIssues.data ?? []).map((i) => ({ kind: "gh-issue" as const, ref: `${repo.fullName}#${i.number}`, title: i.title, detail: i.state })),
      pr: (pulls.data ?? []).map((p) => ({ kind: "pr" as const, ref: `${repo.fullName}#${p.number}`, title: p.title, detail: p.state })),
      commit: hostData[0] ?? [],
      file: hostData[1] ?? [],
      session: hostData[2] ?? [],
      // Typed only (`@epic:`, `@agent:`, `@frame:`): the picker has no tab for them.
      epic: [],
      agent: [],
      frame: [],
    };
    const order: RefKind[] = kind === "all" ? ["session", "issue", "pr", "file", "commit", "gh-issue"] : [kind];
    const perKind = kind === "all" ? 3 : 40;
    return order.flatMap((k) => groups[k].filter(hit).slice(0, perKind));
  }, [enabled, query, kind, issues, ghIssues.data, pulls.data, repo.fullName, ...hostData]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Resolves a submit's references through their adapters, with revisions and budgets (PRD §36.6). */
export function useResolveForSubmit(sessionId: string) {
  const { agent, substrate, github } = useAdapters();
  return (refs: AgentRef[]) => resolveForSubmit({ agent, substrate, github }, sessionId, refs);
}
