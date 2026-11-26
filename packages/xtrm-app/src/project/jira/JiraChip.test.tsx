import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JiraChip } from "./JiraChip.tsx";

const issue = {
  key: "MMD-551",
  summary: "A bound Jira issue",
  status: "In Progress",
  url: "https://example.atlassian.net/browse/MMD-551",
  syncState: "linked",
} as unknown as Parameters<typeof JiraChip>[0]["issue"];

describe("JiraChip", () => {
  // 2026-11-25 ruling: a key chip carries no status dot; the status stays readable
  // through the status text and the tooltip.
  it("draws no status dot", () => {
    const { container } = render(<JiraChip issue={issue} />);
    expect(container.querySelector("[data-status]")).toBeNull();
    expect(container.querySelector("[data-jira-key]")?.getAttribute("title")).toContain("In Progress");
  });

  it("still shows the status word when asked", () => {
    const { container } = render(<JiraChip issue={issue} showStatusText />);
    expect(container.textContent).toContain("In Progress");
    expect(container.querySelector("[data-status]")).toBeNull();
  });
});
