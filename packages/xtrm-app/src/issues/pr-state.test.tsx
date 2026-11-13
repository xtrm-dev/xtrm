import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrStateBadge } from "./pr-state.tsx";

function badge(label: string) {
  const node = screen.getByText(label);
  expect(node.getAttribute("data-slot")).toBe("badge");
  return node;
}

describe("PrStateBadge", () => {
  it("maps the three store states to one tone each", () => {
    const { rerender } = render(<PrStateBadge state="merged" />);
    expect(badge("merged").className).toContain("bg-accent-soft");
    rerender(<PrStateBadge state="open" />);
    expect(badge("open").className).toContain("bg-accent-soft");
    expect(badge("open").className).toContain("text-ink");
    rerender(<PrStateBadge state="closed" />);
    expect(badge("closed").className).toContain("bg-hover");
  });

  it("keeps an unrecorded state as a word, never an empty cell", () => {
    render(<PrStateBadge state={null} />);
    expect(badge("unknown").className).toContain("bg-hover");
    expect(badge("unknown").getAttribute("title")).toContain("no pull_requests row");
  });

  it("renders a state the store adds later instead of dropping it", () => {
    render(<PrStateBadge state="draft" />);
    expect(badge("draft").className).toContain("bg-hover");
  });

  it("shows the assumption only where there is room for it", () => {
    const { rerender } = render(<PrStateBadge state="open" stateSource="assumed" showSource />);
    expect(badge("assumed").getAttribute("title")).toContain("not yet confirmed");
    expect(badge("open").getAttribute("title")).toContain("assumed");

    rerender(<PrStateBadge state="open" stateSource="assumed" />);
    expect(screen.queryByText("assumed")).toBeNull();
    expect(badge("open").getAttribute("title")).toContain("assumed");
  });

  it("says nothing about assumption for an observed state", () => {
    render(<PrStateBadge state="merged" stateSource="observed" showSource />);
    expect(screen.queryByText("assumed")).toBeNull();
    expect(badge("merged").getAttribute("title")).toContain("read from the pull_requests store");
  });
});
