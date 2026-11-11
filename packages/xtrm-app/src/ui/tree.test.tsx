import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TREE_STEP, TreeCell, TreeGuides } from "./tree.tsx";

afterEach(cleanup);

/** The guides are decorative spans; nothing else in the cell renders aria-hidden spans. */
const guides = (root: HTMLElement) => [...root.querySelectorAll("span[aria-hidden]")] as HTMLElement[];

describe("tree indent (XTRM-639)", () => {
  it("starts a root row at the base padding with no guides", () => {
    const { container } = render(
      <TreeCell depth={0} hasChildren={false} expanded label="XTRM-1" onToggle={() => {}} className="flex items-center">
        <span>title</span>
      </TreeCell>,
    );
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.style.paddingLeft).toBe("8px");
    expect(guides(cell)).toHaveLength(0);
  });

  it("indents by one step per level and hangs one guide under each ancestor's icon", () => {
    const { container } = render(
      <div>
        <TreeGuides depth={2} />
      </div>,
    );
    const drawn = guides(container);
    expect(drawn).toHaveLength(2);
    // 8px padding + 20px disclosure slot + 6px gap + half of the 14px icon.
    expect(drawn.map((s) => s.style.left)).toEqual(["41px", `${41 + TREE_STEP}px`]);
  });

  it("draws a straight line: full row height, one pixel wide, no elbow", () => {
    const { container } = render(
      <div>
        <TreeGuides depth={1} />
      </div>,
    );
    const [spine] = guides(container);
    expect(spine!.style.top).toBe("");
    expect(spine!.style.bottom).toBe("");
    expect(spine!.className).toContain("inset-y-0");
    expect(spine!.className).toContain("w-px");
    expect(guides(container)).toHaveLength(1);
  });

  it("supports five levels", () => {
    const { container } = render(
      <div>
        <TreeGuides depth={5} />
      </div>,
    );
    const drawn = guides(container);
    expect(drawn).toHaveLength(5);
    expect(drawn[4]!.style.left).toBe(`${41 + TREE_STEP * 4}px`);
  });

  it("shows a disclosure for parents and toggles without activating the row", () => {
    const onToggle = vi.fn();
    render(
      <TreeCell depth={1} hasChildren expanded={false} label="XTRM-301" onToggle={onToggle}>
        <span>title</span>
      </TreeCell>,
    );
    const button = screen.getByRole("button", { name: "Expand XTRM-301" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reserves the disclosure slot on leaf rows so titles stay aligned", () => {
    const { container } = render(
      <TreeCell depth={1} hasChildren={false} expanded label="XTRM-301" onToggle={() => {}}>
        <span>title</span>
      </TreeCell>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("span.w-5")).not.toBeNull();
  });
});
