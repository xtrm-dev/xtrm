import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../adapters/index.tsx";
import { buildTree, issueStatus, keyColumnRem, rollupActivity, type Sort } from "./issue-table.ts";

const issue = (ref: string, over: Partial<IssueSummary> = {}): IssueSummary => ({
  id: ref, ref, locator: ref, title: ref, kind: "task", lifecycle: "open", revision: 1, priority: 2, scrutiny: null,
  createdAt: 1, updatedAt: 1, lastActivityAt: 1, eventCount: 0, pointerCount: 0, parentRef: null, parentLocator: null,
  childCount: 0, childrenDone: 0, blockedBy: [], readiness: "not_ready", ...over,
});
const updated: Sort = { key: "updated", desc: true };
const order = (rows: IssueSummary[], sort: Sort, collapsed = new Set<string>()) =>
  buildTree(rows, rollupActivity(rows), sort, collapsed).map((r) => `${"  ".repeat(r.depth)}${r.issue.ref}`);

describe("issue table", () => {
  it("nests children under the parent and moves the parent on child journal activity", () => {
    const rows = [
      issue("X-1", { lastActivityAt: 10 }),
      issue("X-2", { lastActivityAt: 20 }),
      issue("X-3", { parentRef: "X-1", lastActivityAt: 30 }),
      issue("X-4", { parentRef: "X-3", lastActivityAt: 40 }),
    ];
    expect(order(rows, updated)).toEqual(["X-1", "  X-3", "    X-4", "X-2"]);
  });

  it("counts a child the current view hides when rolling up, and detaches a child whose parent is hidden", () => {
    const parent = issue("X-1", { eventCount: 2, lastActivityAt: 1 });
    const hidden = issue("X-2", { parentRef: "X-1", eventCount: 5, pointerCount: 3, lastActivityAt: 90 });
    const rollups = rollupActivity([parent, hidden]);
    expect(rollups.get("X-1")).toEqual({ activityAt: 90, events: 7, pointers: 3 });
    expect(buildTree([hidden], rollups, updated, new Set())[0]).toMatchObject({ depth: 0, detached: true });
  });

  it("sorts most active first and breaks ties by key, stable in both directions", () => {
    const rows = [issue("X-10", { eventCount: 1 }), issue("X-2", { eventCount: 1 }), issue("X-3", { eventCount: 9 })];
    expect(order(rows, { key: "events", desc: true })).toEqual(["X-3", "X-2", "X-10"]);
    expect(order(rows, { key: "events", desc: false })).toEqual(["X-2", "X-10", "X-3"]);
  });

  it("keeps missing values last in both directions", () => {
    const rows = [issue("X-1", { priority: null }), issue("X-2", { priority: 3 }), issue("X-3", { priority: 0 })];
    expect(order(rows, { key: "priority", desc: false })).toEqual(["X-3", "X-2", "X-1"]);
    expect(order(rows, { key: "priority", desc: true })).toEqual(["X-2", "X-3", "X-1"]);
  });

  it("hides the children of a collapsed parent", () => {
    const rows = [issue("X-1"), issue("X-2", { parentRef: "X-1" })];
    expect(order(rows, updated, new Set(["X-1"]))).toEqual(["X-1"]);
  });

  it("survives a parent cycle", () => {
    const rows = [issue("X-1", { parentRef: "X-2", eventCount: 1 }), issue("X-2", { parentRef: "X-1", eventCount: 1 })];
    expect(rollupActivity(rows).size).toBe(2);
  });

  it("derives one status: settled lifecycle first, then blocked, then readiness", () => {
    expect(issueStatus(issue("X-1", { readiness: "ready" })).label).toBe("Ready");
    expect(issueStatus(issue("X-1", { readiness: "ready", blockedBy: ["X-2"] })).label).toBe("Blocked");
    expect(issueStatus(issue("X-1", { lifecycle: "done", readiness: "terminal", blockedBy: ["X-2"] })).label).toBe("Done");
  });

  it("widens the key column to the longest key so it never truncates", () => {
    expect(keyColumnRem([issue("X-1", { locator: "XTRM-300.12.4", ref: "XTRM-1234" })])).toBeGreaterThan(keyColumnRem([issue("X-1")]));
  });
});
