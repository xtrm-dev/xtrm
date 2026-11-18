import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ListFilter, ToolbarButton, ToolbarFilter, ToolbarTabs } from "./toolbar.tsx";

function FilterHarness({ count, total }: { count?: number; total?: number }) {
  const [value, setValue] = useState("");
  return <ListFilter value={value} onChange={setValue} count={count} total={total} />;
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
    expect(live.textContent).toBe("12 matching");

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(filterInput().value).toBe("");
  });

  it("mounts expanded when it starts with a value, without taking the caret", () => {
    render(<ListFilter value="blocked" onChange={() => {}} />);
    expect(filterInput().value).toBe("blocked");
    expect(document.activeElement).not.toBe(filterInput());
  });

  it("widens on keyboard focus of the resting button", () => {
    const { container } = render(<FilterHarness />);
    const button = screen.getByRole("button", { name: "Filter this list" });
    act(() => button.focus());
    expect(document.activeElement).toBe(filterInput());
    expect((container.firstElementChild as HTMLElement).className).toContain("w-48");
  });

  it("renders `matched of total` when the consumer passes a total", () => {
    render(<FilterHarness count={12} total={41} />);
    fireEvent.keyDown(document, { key: "/" });
    fireEvent.change(filterInput(), { target: { value: "open" } });
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe("12 of 41");
  });
});

function FilterMenuHarness() {
  const [value, setValue] = useState<string | null>(null);
  return <ToolbarFilter label="Status" value={value} onChange={setValue} options={[{ label: "Open" }, { label: "Merged" }]} />;
}

describe("ToolbarFilter", () => {
  it("names the value in the trigger", () => {
    render(<ToolbarFilter label="Status" value="open" onChange={() => {}} options={[]} />);
    const trigger = screen.getByRole("button", { name: "Status filter: open" });
    expect(trigger.textContent).toContain("Status:");
    expect(trigger.textContent).toContain("open");
  });

  it("reports the chosen option's label", async () => {
    render(<FilterMenuHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Status filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Merged" }));
    expect(await screen.findByRole("button", { name: "Status filter: Merged" })).toBeTruthy();
  });

  it("clears through the Clear item, and offers none without a value", async () => {
    render(<FilterMenuHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Status filter" }));
    await screen.findByRole("menuitem", { name: "Open" });
    expect(screen.queryByRole("menuitem", { name: "Clear" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Status filter: Open" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Clear" }));
    expect(await screen.findByRole("button", { name: "Status filter" })).toBeTruthy();
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
    // The selected fill is also its focus state, so keyboard focus stays visible (§2.2).
    expect(open.className).toContain("focus-visible:bg-hover");
    expect(within(open).getByText("3")).toBeTruthy();
    expect(closed.getAttribute("aria-selected")).toBe("false");
    expect(closed.className).not.toContain("after:bg-ink");

    fireEvent.click(closed);
    expect(onChange).toHaveBeenCalledWith("closed");
  });
});
