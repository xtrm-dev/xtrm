import { describe, expect, it, vi } from "vitest";
import { applyBoard, liveSubstrate, mapBoard, mapIssueCore, mapIssueDetail, type WireIssueDetail, type WireProjectionRow } from "./live.ts";

const row = (id: string, extra: Partial<WireProjectionRow> = {}): WireProjectionRow => ({
  id, humanRef: id.toUpperCase(), locator: id.toUpperCase(), title: id, kind: "task", lifecycleState: "open", priority: 1, scrutiny: "LOW", revision: 1,
  readinessState: "draft", dispatchable: false, claimState: "none", parentRef: null, parentLocator: null, childCount: 0, childrenTerminal: 0, blockedBy: [],
  createdAt: 1, updatedAt: 2, ...extra,
});
const wire = (id: string): WireIssueDetail => ({
  ...row(id), readinessState: "draft", dispatchable: false, reasons: [],
  contract: { problem: "p", success: "s", scope: [], nonGoals: [], constraints: [], validation: [], output: [] },
}) as unknown as WireIssueDetail;
const ctx = { projectId: "prj_x", resume: null, trace: null, journal: [] };

describe("applyBoard (XTRM-717)", () => {
  const board = mapBoard([
    row("epic", { priority: 0 }),
    row("a", { priority: 2, parentRef: "EPIC", parentLocator: "EPIC", blockedBy: ["B"] }),
    row("b", { priority: 3 }),
    row("kid", { parentRef: "A" }),
  ]);

  it("leaves board-derived fields neutral in the core detail", () => {
    const core = mapIssueCore(wire("a"), ctx);
    expect(core).toMatchObject({ priority: null, parentRef: null, parent: null, blockers: [], children: [] });
  });

  it("fills priority, parent, blockers and board children from the board", () => {
    const d = applyBoard(mapIssueCore(wire("a"), ctx), board);
    expect(d.priority).toBe(2);
    expect(d.parent?.ref).toBe("EPIC");
    expect(d.blockers.map((b) => b.ref)).toEqual(["B"]);
    expect(d.children.map((c) => c.ref)).toEqual(["KID"]);
    expect(d.childCount).toBe(1);
  });

  it("is idempotent and equals mapIssueDetail", () => {
    const once = applyBoard(mapIssueCore(wire("a"), ctx), board);
    expect(applyBoard(once, board)).toEqual(once);
    expect(mapIssueDetail(wire("a"), { ...ctx, board })).toEqual(once);
  });

  it("recomputes from the core when a newer board arrives (no stale parent)", () => {
    const core = mapIssueCore(wire("a"), ctx);
    const next = mapBoard([row("a", { priority: 0, parentRef: null }), row("epic")]);
    expect(applyBoard(core, board).parent?.ref).toBe("EPIC");
    expect(applyBoard(core, next)).toMatchObject({ priority: 0, parent: null, parentRef: null });
  });

  it("keeps resume children and fills their locators from the board", () => {
    const core = mapIssueCore(wire("a"), { ...ctx, resume: { children: [{ issueId: "kid", humanRef: "KID", title: "kid", lifecycleState: "done" }] } as never });
    const d = applyBoard(core, board);
    expect(d.children).toEqual([{ id: "kid", ref: "KID", locator: "KID", title: "kid", lifecycle: "done" }]);
    expect(d.childrenDone).toBe(1);
  });
});

describe("liveSubstrate.getIssue board reads (XTRM-717)", () => {
  const envelope = (command: string, data: unknown) => ({ schema: "substrate-cli/v1", command, ok: true, data });
  const stub = () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const path = url.replace("/xtrm-api/substrate", "");
      const data = path.startsWith("/issue?") ? wire("a")
        : path.startsWith("/query") ? { rows: [row("a", { priority: 2 })], nextCursor: null, hasMore: false, scanned: 1, truncated: false }
        : path.startsWith("/journal") ? []
        : path.startsWith("/projects") ? [{ id: "prj_x", prefix: "A", name: "x" }]
        : path.startsWith("/links") ? { links: [] }
        : {};
      return { status: 200, json: async () => envelope("x", data) } as unknown as Response;
    }));
    return calls;
  };

  it("withBoard:false makes no /query request and returns the core detail", async () => {
    const calls = stub();
    try {
      const d = await liveSubstrate.getIssue("A-1", "prj_x", { withBoard: false });
      expect(calls.some((u) => u.includes("/query"))).toBe(false);
      expect(d.priority).toBeNull();
      expect(d.projectId).toBe("prj_x");
    } finally { vi.unstubAllGlobals(); }
  });

  it("default still reads the board (agent reference resolver path)", async () => {
    const calls = stub();
    try {
      const d = await liveSubstrate.getIssue("A-1", "prj_x");
      expect(calls.filter((u) => u.includes("/query"))).toHaveLength(1);
      expect(d.priority).toBe(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it("resolves the project beside the detail reads when none is given", async () => {
    const calls = stub();
    try {
      const d = await liveSubstrate.getIssue("A-1", undefined, { withBoard: false });
      expect(d.projectId).toBe("prj_x");
      expect(calls.some((u) => u.includes("/query"))).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
