import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Row } from "./primitives.tsx";
import { RowAction } from "./row-action.tsx";

const svgClass = (el: HTMLElement) => el.querySelector("svg")!.getAttribute("class") ?? "";

afterEach(() => {
  vi.useRealTimers();
});

describe("RowAction", () => {
  it("is revealed by the row on hover and on keyboard focus, never at rest", () => {
    render(
      <Row actions={<RowAction icon="copy" label="Copy XTRM-1" onAct={() => {}} />}>XTRM-1 title</Row>,
    );
    const button = screen.getByRole("button", { name: "Copy XTRM-1" });
    const wrapper = button.parentElement!;
    expect(wrapper.className).toContain("opacity-0");
    expect(wrapper.className).toContain("group-hover/row:opacity-100");
    expect(wrapper.className).toContain("group-focus-within/row:opacity-100");

    // Keyboard focus reaches the button, so `focus-within` reveals it.
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("is a 20px button with a text-size glyph", () => {
    render(<RowAction icon="copy" label="Copy XTRM-1" onAct={() => {}} />);
    const button = screen.getByRole("button", { name: "Copy XTRM-1" });
    expect(button.className).toContain("size-5");
    expect(screen.getByRole("button", { name: "Copy XTRM-1" }).querySelector("svg")!.getAttribute("width")).toBe("13");
  });

  it("acts without activating the row", () => {
    const onAct = vi.fn();
    const onRow = vi.fn();
    render(
      <Row onActivate={onRow} actions={<RowAction icon="copy" label="Copy XTRM-1" onAct={onAct} />}>
        XTRM-1 title
      </Row>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy XTRM-1" }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("swaps to check for 1.2s and announces doneLabel", () => {
    vi.useFakeTimers();
    render(<RowAction icon="copy" label="Copy XTRM-1" onAct={() => {}} doneLabel="Copied" />);
    const button = screen.getByRole("button", { name: "Copy XTRM-1" });
    expect(svgClass(button)).toContain("lucide-copy");

    fireEvent.click(button);
    expect(svgClass(button)).toContain("lucide-check");
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("Copied");

    act(() => vi.advanceTimersByTime(1200));
    expect(svgClass(button)).toContain("lucide-copy");
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe("");
  });
});
