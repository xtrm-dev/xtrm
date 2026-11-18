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

  it("'/' focuses an already-open filter instead of being swallowed", () => {
    render(<ListFilter value="blocked" onChange={() => {}} />);
    const input = filterInput();
    expect(document.activeElement).not.toBe(input);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("'/' takes the caret after typing and blurring, while the filter stays expanded", () => {
    // The state a stale listener gets wrong: `open` is already true, so re-opening is a no-op.
    render(<FilterHarness />);
    fireEvent.keyDown(document, { key: "/" });
    fireEvent.change(filterInput(), { target: { value: "x" } });
    // `input.blur()` moves focus in jsdom, unlike a bare blur event.
    act(() => filterInput().blur());
    expect(screen.queryByPlaceholderText("Filter this list")).not.toBeNull();
    expect(document.activeElement).not.toBe(filterInput());

    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(filterInput());
  });

  it("'/' works again after Escape cleared and collapsed the filter", () => {
    // The other stale state: the listener saw `open=true` and focused a ref that is now null.
    render(<ListFilter value="blocked" onChange={() => {}} />);
    fireEvent.keyDown(filterInput(), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Filter this list")).toBeNull();

    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(filterInput());
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

  it("does not collide with an option that is itself called Clear", async () => {
    render(
      <ToolbarFilter
        label="State"
        value="open"
        onChange={() => {}}
        options={[{ label: "Clear" }, { label: "Merged" }]}
      />,
    );
    // A duplicate React key only warns, so the muted console is what proves the items are distinct.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "State filter: open" }));
    const clears = await screen.findAllByRole("menuitem", { name: "Clear" });
    expect(clears).toHaveLength(2);
    expect(errors.mock.calls.filter((args) => String(args[0]).includes("same key"))).toHaveLength(0);
    errors.mockRestore();
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

function TabsHarness() {
  const [value, setValue] = useState("open");
  return (
    <ToolbarTabs
      label="Pull request views"
      value={value}
      onChange={setValue}
      tabs={[
        { id: "open", label: "Open" },
        { id: "merged", label: "Merged" },
        { id: "closed", label: "Closed" },
      ]}
    />
  );
}

describe("ToolbarTabs", () => {
  it("moves selection with Arrow keys, Home and End, with one tab stop", () => {
    render(<TabsHarness />);
    const open = screen.getByRole("tab", { name: "Open" });
    const merged = screen.getByRole("tab", { name: "Merged" });
    const closed = screen.getByRole("tab", { name: "Closed" });
    expect(open.getAttribute("tabindex")).toBe("0");
    expect(merged.getAttribute("tabindex")).toBe("-1");

    act(() => open.focus());
    fireEvent.keyDown(open, { key: "ArrowRight" });
    expect(merged.getAttribute("aria-selected")).toBe("true");
    expect(merged.getAttribute("tabindex")).toBe("0");
    expect(open.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(merged);

    fireEvent.keyDown(merged, { key: "ArrowLeft" });
    expect(open.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(open);

    fireEvent.keyDown(open, { key: "End" });
    expect(closed.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(closed);

    fireEvent.keyDown(closed, { key: "ArrowRight" });
    expect(open.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(open);

    // Home from a non-first tab, so the assertion cannot pass just because the first tab was selected.
    fireEvent.keyDown(open, { key: "End" });
    expect(screen.getByRole("tab", { name: "Closed" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Closed" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("aria-selected")).toBe("true");

    // Wrap to the left: from the first tab back to the last.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Open" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Closed" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Closed" }));
  });

  it("leaves browser and document shortcuts alone", () => {
    render(<TabsHarness />);
    const open = screen.getByRole("tab", { name: "Open" });
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true });
    act(() => open.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(open.getAttribute("aria-selected")).toBe("true");

    const cmdEnd = new KeyboardEvent("keydown", { key: "End", metaKey: true, bubbles: true, cancelable: true });
    act(() => open.dispatchEvent(cmdEnd));
    expect(cmdEnd.defaultPrevented).toBe(false);
    expect(open.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps one tab stop when no tab matches the value, and still moves from it", () => {
    const onChange = vi.fn();
    render(
      <ToolbarTabs
        label="Views"
        value="missing"
        onChange={onChange}
        tabs={[
          { id: "open", label: "Open" },
          { id: "closed", label: "Closed" },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Closed" }).getAttribute("tabindex")).toBe("-1");

    // With nothing selected the tablist must not go inert: forward lands on the first tab,
    // backward wraps to the last.
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("open");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("closed");
  });

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
