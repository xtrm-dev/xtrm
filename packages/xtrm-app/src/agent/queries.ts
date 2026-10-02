import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
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
        void qc.invalidateQueries({ queryKey: ["agent", "session", id] });
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
  return useMutation({ mutationFn: ({ activityId, answer }: { activityId: string; answer: string }) => agent.respond(sessionId, activityId, answer) });
}

export type PickerKind = RefKind | "all";

const HOST_KINDS = ["commit", "file", "session"] as const;

/**
 * `@` picker candidates. Each kind resolves through its own adapter (PRD §36.6):
 * Substrate for issues, GitHub for PRs and GitHub issues, the agent host for commits, files, and sessions.
 */
export function useReferenceCandidates(query: string, kind: PickerKind, enabled: boolean): RefCandidate[] {
  const { agent } = useAdapters();
  const { repo } = useShell();
  const issues = useIssueIndex();
  const pulls = usePulls(repo.fullName, "open");
  const ghIssues = useGithubIssues(repo.fullName);
  const host = useQueries({
    queries: HOST_KINDS.map((k) => ({
      queryKey: ["agent", "refs", k, query, repo.fullName],
      queryFn: () => agent.searchReferences(query, k, repo.fullName),
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
    };
    const order: RefKind[] = kind === "all" ? ["session", "issue", "pr", "file", "commit", "gh-issue"] : [kind];
    const perKind = kind === "all" ? 3 : 40;
    return order.flatMap((k) => groups[k].filter(hit).slice(0, perKind));
  }, [enabled, query, kind, issues, ghIssues.data, pulls.data, repo.fullName, ...hostData]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Resolver for literal `@kind:ref` tokens typed into the composer. */
export function useReferenceResolver() {
  const { agent } = useAdapters();
  const { repo } = useShell();
  const issues = useIssueIndex();
  const pulls = usePulls(repo.fullName, "open");
  const ghIssues = useGithubIssues(repo.fullName);
  return async (ref: AgentRef): Promise<boolean> => {
    switch (ref.kind) {
      case "issue":
        return issues.has(ref.ref);
      case "pr":
        return (pulls.data ?? []).some((p) => `${repo.fullName}#${p.number}` === ref.ref);
      case "gh-issue":
        return (ghIssues.data ?? []).some((i) => `${repo.fullName}#${i.number}` === ref.ref);
      default:
        return (await agent.resolveReference(ref)) !== null;
    }
  };
}
