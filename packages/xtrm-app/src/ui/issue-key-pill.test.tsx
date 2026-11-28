import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueKeyPill, IssueKeyText, splitIssueRef } from "./issue-key-pill.tsx";

describe("IssueKeyPill", () => {
  it("wraps the locator and the short ref in one neutral pill, divided hairline to hairline", () => {
    const { container } = render(<IssueKeyPill locator="XTRM-1019.1" humanRef="XTRM-1020" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).toContain("border-border-muted");
    expect(pill.className).not.toContain("accent");
    expect(pill.className).toContain("h-5");
    expect(pill.getAttribute("data-issue-key")).toBe("XTRM-1020");
    expect(pill.getAttribute("data-locator")).toBe("XTRM-1019.1");
    expect(pill.getAttribute("title")).toBe("XTRM-1019.1 · XTRM-1020");
    const locator = screen.getByText("XTRM-1019.1");
    const ref = screen.getByText("XTRM-1020");
    expect(locator.className).toContain("text-ink-muted");
    expect(ref.className).toContain("text-ink");
    const rule = pill.querySelector('[aria-hidden]') as HTMLElement;
    expect(rule.className).toContain("self-stretch");
    expect(rule.className).toContain("w-px");
    expect(locator.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("wraps a root issue alone, with no hairline and no repeated string", () => {
    const { container } = render(<IssueKeyPill locator="XTRM-1019" humanRef="XTRM-1019" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(screen.getAllByText("XTRM-1019")).toHaveLength(1);
    expect(pill.querySelector('[aria-hidden]')).toBeNull();
    expect(pill.getAttribute("data-locator")).toBeNull();
    expect(pill.getAttribute("title")).toBe("XTRM-1019");
  });

  it("wraps a single segment when the index has no locator yet", () => {
    const { container } = render(<IssueKeyPill locator={null} humanRef="XTRM-1020" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.getAttribute("data-locator")).toBeNull();
    expect(pill.querySelector('[aria-hidden]')).toBeNull();
    expect(screen.getByText("XTRM-1020")).toBeTruthy();
  });
});

describe("IssueKeyText (issue list, XTRM-1136)", () => {
  it("shows the whole locator and only the short ref's number", () => {
    const { container } = render(<IssueKeyText locator="XTRM-1019.1" humanRef="XTRM-1020" />);
    const key = container.querySelector("[data-issue-key]") as HTMLElement;
    expect(key.textContent).toBe("XTRM-1019.11020");
    expect(key.querySelector("[data-issue-key-number]")!.textContent).toBe("1020");
    expect(key.getAttribute("aria-label")).toBe("issue XTRM-1019.1, XTRM-1020");
    expect(key.className).not.toContain("border");
  });

  it("shows a root key once, its number in the same weight", () => {
    const { container } = render(<IssueKeyText locator="XTRM-1019" humanRef="XTRM-1019" />);
    const key = container.querySelector("[data-issue-key]") as HTMLElement;
    expect(key.textContent).toBe("XTRM-1019");
    expect(key.querySelector("[data-issue-key-number]")!.textContent).toBe("1019");
    expect(key.getAttribute("data-locator")).toBeNull();
  });

  it("keeps a ref without a trailing counter whole", () => {
    expect(splitIssueRef("xtrm-abc")).toEqual({ prefix: "", number: "xtrm-abc" });
    expect(splitIssueRef("MMD-6040")).toEqual({ prefix: "MMD-", number: "6040" });
  });
});
