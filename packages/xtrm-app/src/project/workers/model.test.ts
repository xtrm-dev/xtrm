import { describe, expect, it, vi } from "vitest";
import { fixtureSubstrate } from "../../adapters/substrate/fixture.ts";
import type { Worker } from "../../adapters/status-board/types.ts";
import { buildFlatGroups, buildWorkersTree, claimState, CLAIM_SOON_MS, statusTone } from "./model.ts";

const graph = () => fixtureSubstrate.dispatchGraph("prj_xtrm");

const boardWorker = (over: Partial<Worker> = {}): Worker => ({ name: "w", kind: "worker", status: "working", ...over });

describe("Workers tree model", () => {
  it("builds the chain from dispatched_by: lead on top, worker, then the activation", async () => {
    const model = buildWorkersTree(await graph(), []);
    expect(model.roots.map((n) => n.name)).toEqual(["console-lead"]);
    const lead = model.roots[0]!;
    expect(lead.roleWord).toBe("lead");
    // A pure dispatcher participant carries no works_on edge, so it has no issue trail.
    expect(lead.issueRef).toBeNull();
    expect(lead.children.map((c) => c.name)).toEqual(["board-worker", "quant-reviewer"]);

    const worker = lead.children[0]!;
    expect(worker.roleWord).toBe("worker");
    expect(worker.issueRef).toBe("XTRM-817");
    expect(worker.children.map((c) => c.name)).toEqual(["test-engineer"]);
    expect(worker.children[0]!.roleWord).toBe("activation");
    expect(worker.children[0]!.issueRef).toBe("XTRM-813");
  });

  it("never guesses a parent for a binding without a dispatcher", async () => {
    const model = buildWorkersTree(await graph(), []);
    expect(model.unknown.map((n) => n.name)).toEqual(["pr-reviewer"]);
    const childIds = model.roots.flatMap((r) => r.children.flatMap((c) => [c.id, ...c.children.map((g) => g.id)]));
    for (const node of model.unknown) expect(childIds).not.toContain(node.id);
  });

  it("enriches a vertex from the board record joined on the issue ref, and keeps the PR trail", async () => {
    const model = buildWorkersTree(await graph(), [
      boardWorker({ name: "board-worker", issue: "XTRM-817", status: "working", ctxPct: 42, claimUntil: "2026-11-18T10:00:00Z" }),
    ]);
    const worker = model.roots[0]!.children[0]!;
    expect(worker.status).toBe("working");
    expect(worker.ctxPct).toBe(42);
    expect(worker.board?.name).toBe("board-worker");
    expect(worker.claimUntil).toBe("2026-11-18T10:00:00Z");
    // The PR delivers the unknown-dispatcher worker's issue (XTRM-816), so it rides that trail.
    expect(model.unknown[0]!.prs).toEqual([{ number: 912, repo: "mercury/market-data" }]);
  });

  it("reports board workers the graph does not mention as orphans, not as tree nodes", async () => {
    expect(buildWorkersTree(await graph(), [boardWorker({ name: "sre-ops", issue: "XTRM-816" })]).orphans).toHaveLength(0);
    const never = boardWorker({ name: "ghost", issue: "XTRM-999" });
    expect(buildWorkersTree(await graph(), [never]).orphans.map((w) => w.name)).toEqual(["ghost"]);
    // A board row with no issue at all cannot join, so it is an orphan too.
    expect(buildWorkersTree(await graph(), [boardWorker({ name: "no-issue", issue: undefined })]).orphans.map((w) => w.name)).toEqual(["no-issue"]);
  });

  it("reads a claim as none, held, ending within 2h, or expired", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(claimState(null, now)).toBe("none");
    expect(claimState("not-a-date", now)).toBe("none");
    expect(claimState(new Date(now + CLAIM_SOON_MS * 2).toISOString(), now)).toBe("ok");
    expect(claimState(new Date(now + CLAIM_SOON_MS / 2).toISOString(), now)).toBe("soon");
    expect(claimState(new Date(now - 1000).toISOString(), now)).toBe("expired");
  });

  it("groups the flat view by status and puts the archived rows behind the control", () => {
    const workers = [
      boardWorker({ name: "b", status: "blocked" }),
      boardWorker({ name: "a", status: "working" }),
      boardWorker({ name: "z", status: "archived" }),
      boardWorker({ name: "n", status: undefined }),
    ];
    const hidden = buildFlatGroups(workers, { includeArchived: false });
    expect(hidden.archivedCount).toBe(1);
    expect(hidden.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual(["a", "b", "n"]);
    expect(hidden.groups.map((g) => g.status)).toEqual(["working", "blocked", null]);
    const shown = buildFlatGroups(workers, { includeArchived: true });
    expect(shown.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual(["a", "b", "z", "n"]);
  });

  it("renders an unknown status neutrally and logs it once as a contract gap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(statusTone("invented-status")).toBe("neutral");
    expect(statusTone("invented-status")).toBe("neutral");
    const calls = warn.mock.calls.filter((c) => String(c[0]).includes("invented-status"));
    expect(calls).toHaveLength(1);
    expect(statusTone("blocked")).toBe("danger");
    warn.mockRestore();
  });
});
