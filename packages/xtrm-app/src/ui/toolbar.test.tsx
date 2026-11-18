import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ListFilter, ToolbarButton, ToolbarTabs } from "./toolbar.tsx";

function FilterHarness({ count }: { count?: number }) {
  const [value, setValue] = useState("");
  return <ListFilter value={value} onChange={setValue} count={count} />;
}

const filterInput = () => screen.getByPlaceholderText("Filter this list") as HTMLInputElement;

describe("ListFilter", () => {
  it("rests as a 28px filter icon button with the '/' shortcut", () => {
    const { container } = render(<FilterHarness />);
    const button = screen.getByRole("button", { name: "Filter this list" });
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("w-7");
    expect(wrapper.className).toContain("transition-[width]");
    expect(button.querySelector("svg")!.getAttribute("class")).toContain("lucide-list-filter");
  });

  it("'/' widens the control and focuses the input", () => {
    const { container } = render(<FilterHarness />);
    fireEvent.keyDown(document, { key: "/" });
    const input = filterInput();
    expect(document.activeElement).toBe(input);
    expect((container.firstElementChild as HTMLElement).className).toContain("w-48");
  });

  it("Escape clears the value, collapses and blurs", () => {
    render(<FilterHarness />);
    fireEvent.keyDown(document, { key: "/" });
    const input = filterInput();
    fireEvent.change(input, { target: { value: "blocked" } });
    expect(input.value).toBe("blocked");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Filter this list")).toBeNull();
    expect(document.activeElement).not.toBe(input);

    // The control is back to rest; reopening shows the cleared value.
    fireEvent.keyDown(document, { key: "/" });
    expect(filterInput().value).toBe("");
  });

  it("stays expanded after blur while it holds a value, and collapses when empty", () => {
    render(<FilterHarness />);
    fireEvent.keyDown(document, { key: "/" });
    fireEvent.blur(filterInput());
    expect(screen.queryByPlaceholderText("Filter this list")).toBeNull();

    fireEvent.keyDown(document, { key: "/" });
    const input = filterInput();
    fireEvent.change(input, { target: { value: "open" } });
    fireEvent.blur(input);
    expect(screen.queryByPlaceholderText("Filter this list")).not.toBeNull();
  });

  it("shows the match count in a polite live region and clears from its close action", () => {
    render(<FilterHarness count={12} />);
    fireEvent.keyDown(document, { key: "/" });
    fireEvent.change(filterInput(), { target: { value: "open" } });
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("12");

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(filterInput().value).toBe("");
  });
});

describe("ToolbarButton", () => {
  it("is a ghost control, and only a primary action carries ink text", () => {
    render(
      <>
        <ToolbarButton>Status</ToolbarButton>
        <ToolbarButton primary>New issue</ToolbarButton>
      </>,
    );
    const ghost = screen.getByRole("button", { name: "Status" });
    expect(ghost.className).toContain("text-ink-muted");
    expect(ghost.className).toContain("hover:bg-hover");
    expect(ghost.className).not.toContain("bg-pressed");
    const primary = screen.getByRole("button", { name: "New issue" });
    expect(primary.className).toContain("text-ink");
    expect(primary.className).toContain("font-medium");
  });

  it("renders an optional text-size icon", () => {
    render(<ToolbarButton icon="filter">Filter</ToolbarButton>);
    const icon = screen.getByRole("button", { name: "Filter" }).querySelector("svg")!;
    expect(icon.getAttribute("width")).toBe("13");
  });
});

describe("ToolbarTabs", () => {
  it("marks the selected tab with ink text and a 2px ink bar, not a fill", () => {
    const onChange = vi.fn();
    render(
      <ToolbarTabs
        label="Pull request views"
        value="open"
        onChange={onChange}
        tabs={[
          { id: "open", label: "Open", count: 3 },
          { id: "closed", label: "Closed" },
        ]}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Pull request views" })).not.toBeNull();
    // jsdom concatenates label and count without a separator, so match on the label.
    const open = screen.getByRole("tab", { name: /^Open/ });
    const closed = screen.getByRole("tab", { name: "Closed" });
    expect(open.getAttribute("aria-selected")).toBe("true");
    expect(open.className).toContain("text-ink");
    expect(open.className).toContain("after:bg-ink");
    expect(within(open).getByText("3")).toBeTruthy();
    expect(closed.getAttribute("aria-selected")).toBe("false");
    expect(closed.className).not.toContain("after:bg-ink");

    fireEvent.click(closed);
    expect(onChange).toHaveBeenCalledWith("closed");
  });
});
