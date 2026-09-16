import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdapters, type IssueCreate, type IssueDetail, type Lifecycle, type Scrutiny } from "../adapters/index.tsx";
import { patchContract, type ContractPatch } from "../adapters/substrate/contract.ts";

export function useCanWrite() {
  const { substrate } = useAdapters();
  return useQuery({ queryKey: ["substrate", "capabilities"], queryFn: () => substrate.canWrite(), staleTime: 5 * 60_000 }).data ?? false;
}

/**
 * Jira-style mutations. One field per write: `sb issue edit` applies title/priority before the
 * contract revision check, so combining them could half-apply on conflict.
 */
export function useIssueActions(issue: IssueDetail | undefined) {
  const { substrate } = useAdapters();
  const qc = useQueryClient();

  const refresh = async (ref = issue?.ref) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["substrate", "issue", ref] }),
      qc.invalidateQueries({ queryKey: ["substrate", "issues"] }),
    ]);
  };

  const need = () => {
    if (!issue) throw new Error("issue not loaded");
    if (!issue.projectId) throw new Error("issue project is unknown");
    return { issue, projectId: issue.projectId };
  };

  const conflict = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    return /revision/i.test(message) ? new Error(`Revision conflict: this issue changed since you opened it. Reload and reapply. (${message})`) : e;
  };

  return {
    async setTitle(title: string) {
      const { issue: i, projectId } = need();
      await substrate.editIssue(projectId, i.ref, i.revision, { title });
      await refresh();
    },
    async setPriority(priority: number) {
      const { issue: i, projectId } = need();
      await substrate.editIssue(projectId, i.ref, i.revision, { priority });
      await refresh();
    },
    async setScrutiny(scrutiny: Scrutiny) {
      const { issue: i, projectId } = need();
      await substrate.editIssue(projectId, i.ref, i.revision, { scrutiny });
      await refresh();
    },
    async patchContract(patch: ContractPatch) {
      const { issue: i, projectId } = need();
      try {
        await substrate.editIssue(projectId, i.ref, i.revision, { contract: patchContract(i.contract, patch) });
      } catch (e) {
        throw conflict(e);
      }
      await refresh();
    },
    async setLifecycle(state: Lifecycle) {
      const { issue: i, projectId } = need();
      await substrate.setLifecycle(projectId, i.ref, state);
      await refresh();
    },
    async addNote(text: string, kind: string) {
      const { issue: i, projectId } = need();
      await substrate.addNote(projectId, i.ref, text, kind);
      await refresh();
    },
  };
}

export function useCreateIssue(projectId: string | null | undefined) {
  const { substrate } = useAdapters();
  const qc = useQueryClient();
  return async (input: IssueCreate) => {
    if (!projectId) throw new Error("repository is not bound to a Substrate project");
    const ref = await substrate.createIssue(projectId, input);
    await qc.invalidateQueries({ queryKey: ["substrate", "issues"] });
    return ref;
  };
}
