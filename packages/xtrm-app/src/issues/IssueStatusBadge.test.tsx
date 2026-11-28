import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../adapters/index.tsx";
import { detailReadiness } from "../adapters/substrate/live.ts";
import { IssueStatusBadge } from "./IssueStatusBadge.tsx";
import { issueStatus } from "./issue-table.ts";

const issue = (over: Partial<IssueSummary> = {}): IssueSummary => ({
  id: "i", ref: "XTRM-1", locator: "XTRM-1", title: "t", kind: "task", lifecycle: "open", revision: 1, priority: 2, scrutiny: null,
  createdAt: 1, updatedAt: 1, lastActivityAt: 1, eventCount: 0, pointerCount: 0, attestation: null, contractComplete: null, dispatchable: null,
  parentRef: null, parentLocator: null, childCount: 0, childrenDone: 0, blockedBy: [], readiness: "not_ready", ...over,
});

describe("detail readiness (2026-11-27 drawer defect)", () => {
  it("keeps Substrate's operational state instead of collapsing it to dispatchable", () => {
    expect(detailReadiness("claimed", false)).toBe("claimed");
    expect(detailReadiness("blocked", false)).toBe("blocked");
    expect(detailReadiness("ready", true)).toBe("ready");
  });

  it("falls back to dispatchable only when the state is absent or unknown", () => {
    expect(detailReadiness(undefined, true)).toBe("ready");
    expect(detailReadiness("something-new", false)).toBe("not_ready");
  });

  it("a claimed, attested, non-dispatchable issue derives In progress, not Open", () => {
    // The operator's case: claimed and 100% attested; a claim makes it non-dispatchable.
    const claimed = issue({ readiness: detailReadiness("claimed", false), dispatchable: false, attestation: "current", contractComplete: true });
    expect(issueStatus(claimed).label).toBe("In progress");
  });
});

describe("IssueStatusBadge", () => {
  it("leads with a glyph that differs by status, like the PR state chip (XTRM-1136)", () => {
    const glyph = (over: Partial<IssueSummary>) => {
      const { unmount } = render(<IssueStatusBadge issue={issue(over)} />);
      const svg = screen.getByTestId("issue-status").querySelector("svg");
      const shape = svg?.getAttribute("class") ?? "";
      unmount();
      return shape;
    };
    const inProgress = glyph({ readiness: "claimed" });
    const blocked = glyph({ blockedBy: ["XTRM-2"] });
    const done = glyph({ lifecycle: "done" });
    expect(inProgress).not.toBe("");
    expect(new Set([inProgress, blocked, done]).size).toBe(3);
    expect(issueStatus(issue({ lifecycle: "done" })).icon).toBe("statusDone");
  });

  it("renders a state of work as a solid chip", () => {
    render(<IssueStatusBadge issue={issue({ readiness: "claimed" })} />);
    const chip = screen.getByTestId("issue-status");
    expect(chip.textContent).toBe("In progress");
    expect(chip.className).toContain("text-white");
  });

  it.each([
    ["Unattested", { contractComplete: true, attestation: "none" as const }],
    ["Draft", { contractComplete: false }],
    ["Stale", { contractComplete: true, attestation: "stale" as const }],
    ["Open", {}],
  ])("renders the gap %s as the quiet muted tint", (label, over) => {
    render(<IssueStatusBadge issue={issue(over)} />);
    const chip = screen.getByTestId("issue-status");
    expect(chip.textContent).toBe(label);
    expect(chip.className).toContain("bg-hover");
    expect(chip.className).not.toContain("text-white");
  });

  it("gives closed work the success fill", () => {
    render(<IssueStatusBadge issue={issue({ lifecycle: "done" })} />);
    expect(screen.getByTestId("issue-status").className).toContain("bg-chip-success");
  });

  it("differs between list and drawer only by size", () => {
    const i = issue({ readiness: "blocked", blockedBy: ["XTRM-2"] });
    const { container } = render(
      <>
        <IssueStatusBadge issue={i} size="xs" />
        <IssueStatusBadge issue={i} size="sm" />
      </>,
    );
    const [row, drawer] = Array.from(container.querySelectorAll<HTMLElement>("[data-testid=issue-status]"));
    const strip = (c: string) => c.split(" ").filter((k) => !/^(h-|px-|text-(2xs|xs)|leading-)/.test(k)).sort().join(" ");
    expect(row!.textContent).toBe(drawer!.textContent);
    expect(strip(row!.className)).toBe(strip(drawer!.className));
  });
});
