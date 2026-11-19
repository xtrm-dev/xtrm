import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../adapters/index.tsx";
import { INDENT_REM, KEY_COL_MAX_REM, buildTree, hiddenColumns, issueStatus, keyColumnRem, keyNames, listDensity, primaryKey, rollupActivity, type Sort } from "./issue-table.ts";

const issue = (ref: string, over: Partial<IssueSummary> = {}): IssueSummary => ({
  id: ref, ref, locator: ref, title: ref, kind: "task", lifecycle: "open", revision: 1, priority: 2, scrutiny: null,
  createdAt: 1, updatedAt: 1, lastActivityAt: 1, eventCount: 0, pointerCount: 0, attestation: null, contractComplete: null, dispatchable: null, parentRef: null, parentLocator: null,
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

  it("uses Substrate's vocabulary: settled lifecycle, then blocked, in progress, attested, then what a draft lacks", () => {
    const label = (over: Partial<IssueSummary>) => issueStatus(issue("X-1", over)).label;
    expect(label({ lifecycle: "done", readiness: "terminal", blockedBy: ["X-2"] })).toBe("Done");
    expect(label({ readiness: "ready", blockedBy: ["X-2"] })).toBe("Blocked");
    expect(label({ readiness: "claimed" })).toBe("In progress");
    expect(label({ readiness: "ready", dispatchable: true })).toBe("Ready");
    expect(label({ readiness: "ready", dispatchable: false })).toBe("Attested");
    expect(label({ readiness: "draft", contractComplete: false, attestation: "none" })).toBe("Draft");
    expect(label({ readiness: "draft", contractComplete: true, attestation: "none" })).toBe("Unattested");
    expect(label({ readiness: "draft", contractComplete: true, attestation: "stale" })).toBe("Stale");
    expect(label({ readiness: "draft", contractComplete: true, attestation: "rejected" })).toBe("Rejected");
  });

  it("sizes the key column from the primary locator alone, plus the deepest row's indent", () => {
    const short = issue("X-1", { locator: "XTRM-300.12", ref: "XTRM-1234" });
    const long = issue("X-2", { locator: "XTRM-300.12.4.1", ref: "XTRM-1234" });
    expect(keyColumnRem([long])).toBeGreaterThan(keyColumnRem([short]));
    // The alias moves to the tooltip, so it must not widen the column (XTRM-898).
    expect(keyColumnRem([issue("X-1", { locator: "XTRM-300.12", ref: "XTRM-1234" })])).toBe(
      keyColumnRem([issue("X-1", { locator: "XTRM-300.12", ref: "XTRM-1234567890" })]),
    );
    // Each level widens the base column by one indent; the key cell gives that width back per row.
    expect(keyColumnRem([short], 3) - keyColumnRem([short])).toBeCloseTo(3 * INDENT_REM, 5);
  });

  it("caps the key column, so one deep locator cannot tax every visible row (XTRM-911)", () => {
    const deep = issue("X-1", { locator: "MMD-5244.2331.298.20.2.1.1.1" });
    expect(keyColumnRem([deep], 4)).toBe(KEY_COL_MAX_REM);
    // Below the cap the column still follows the data, depth included.
    const short = issue("X-2", { locator: "XTRM-300.1" });
    expect(keyColumnRem([short], 1)).toBeLessThan(KEY_COL_MAX_REM);
  });

  it("drops the low-value numeric columns as the list narrows, header and rows together (XTRM-911)", () => {
    expect(listDensity(1098)).toBe("wide");
    expect([...hiddenColumns("wide")]).toEqual([]);
    expect(listDensity(62 * 16 - 1)).toBe("medium");
    expect([...hiddenColumns("medium")]).toEqual(["events", "pointers"]);
    expect(listDensity(48 * 16 - 1)).toBe("compact");
    expect([...hiddenColumns("compact")]).toEqual(["events", "pointers", "created", "updated"]);
  });

  it("names the primary key and the tooltip that keeps the alias", () => {
    const imported = issue("X-1", { locator: "XTRM-300.12", ref: "XTRM-1234" });
    expect(primaryKey(imported)).toBe("XTRM-300.12");
    expect(keyNames(imported)).toBe("XTRM-300.12 / XTRM-1234");
    expect(keyNames(issue("X-2"))).toBe("X-2");
  });
});
