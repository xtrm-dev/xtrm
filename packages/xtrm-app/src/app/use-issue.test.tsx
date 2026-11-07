import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdaptersProvider, fixtureAdapters, type IssueDetail, type IssueSummary, type SubstrateAdapter } from "../adapters/index.tsx";
import { mapBoard, mapIssueCore, type WireIssueDetail, type WireProjectionRow } from "../adapters/substrate/live.ts";
import { useIssue } from "./queries.ts";

const wireRow = (id: string, extra: Partial<WireProjectionRow> = {}): WireProjectionRow => ({
  id, humanRef: id.toUpperCase(), locator: id.toUpperCase(), title: id, kind: "task", lifecycleState: "open", priority: 1, scrutiny: "LOW", revision: 1,
  readinessState: "draft", dispatchable: false, claimState: "none", parentRef: null, parentLocator: null, childCount: 0, childrenTerminal: 0, blockedBy: [],
  createdAt: 1, updatedAt: 2, ...extra,
});
const core: IssueDetail = mapIssueCore({ ...wireRow("a"), reasons: [], contract: {} } as unknown as WireIssueDetail, { projectId: "prj_x", resume: null, trace: null, journal: [] });

function setup(boards: IssueSummary[][]) {
  let n = 0;
  const listIssues = vi.fn(async () => boards[Math.min(n++, boards.length - 1)]!);
  const getIssue = vi.fn(async () => core);
  const substrate = {
    ...fixtureAdapters.substrate,
    listProjects: async () => [{ id: "prj_x", prefix: "A", name: "x", gitRoots: [] }],
    listIssues,
    getIssue,
  } as unknown as SubstrateAdapter;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><AdaptersProvider adapters={{ ...fixtureAdapters, substrate }}>{children}</AdaptersProvider></QueryClientProvider>
  );
  return { client, wrapper, getIssue, listIssues };
}

describe("useIssue (XTRM-717)", () => {
  it("asks the adapter for the core detail and merges the shared board", async () => {
    const { wrapper, getIssue } = setup([mapBoard([wireRow("a", { priority: 3 })])]);
    const { result } = renderHook(() => useIssue("A-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.priority).toBe(3));
    // The detail never waits for the project list: the adapter resolves the project beside its reads.
    expect(getIssue).toHaveBeenCalledWith("A-1", undefined, { withBoard: false });
    expect(getIssue).toHaveBeenCalledTimes(1);
  });

  it("shows the core detail before the board arrives", async () => {
    let release: (b: IssueSummary[]) => void = () => {};
    const gate = new Promise<IssueSummary[]>((r) => { release = r; });
    const s = setup([]);
    const substrate = { ...fixtureAdapters.substrate, listProjects: async () => [{ id: "prj_x", prefix: "A", name: "x", gitRoots: [] }], listIssues: () => gate, getIssue: async () => core } as unknown as SubstrateAdapter;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={s.client}><AdaptersProvider adapters={{ ...fixtureAdapters, substrate }}>{children}</AdaptersProvider></QueryClientProvider>
    );
    const { result } = renderHook(() => useIssue("A-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.ref).toBe("A"));
    expect(result.current.data?.priority).toBeNull();
    await act(async () => release(mapBoard([wireRow("a", { priority: 4 })])));
    await waitFor(() => expect(result.current.data?.priority).toBe(4));
  });

  it("updates board-derived fields when the board is invalidated, without refetching the detail", async () => {
    const { client, wrapper, getIssue } = setup([mapBoard([wireRow("a", { priority: 3 })]), mapBoard([wireRow("a", { priority: 0 })])]);
    const { result } = renderHook(() => useIssue("A-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.priority).toBe(3));
    await act(async () => { await client.invalidateQueries({ queryKey: ["substrate", "issues"] }); });
    await waitFor(() => expect(result.current.data?.priority).toBe(0));
    expect(getIssue).toHaveBeenCalledTimes(1);
  });

  it("walks the board once when the Issues table already holds it", async () => {
    const { client, wrapper, listIssues } = setup([mapBoard([wireRow("a")])]);
    await client.prefetchQuery({ queryKey: ["substrate", "issues", "prj_x"], queryFn: () => listIssues(), staleTime: 30_000 });
    const { result } = renderHook(() => useIssue("A-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.ref).toBe("A"));
    expect(listIssues).toHaveBeenCalledTimes(1);
  });
});
