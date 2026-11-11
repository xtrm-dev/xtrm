import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TREE_STEP, TreeCell, TreeGuides } from "./tree.tsx";

afterEach(cleanup);

/** The guides are decorative spans; nothing else in the cell renders aria-hidden spans. */
const guides = (root: HTMLElement) => [...root.querySelectorAll("span[aria-hidden]")];

describe("tree indent (XTRM-638)", () => {
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

  it("indents by one step per level and draws one spine per level plus an elbow", () => {
    const { container } = render(
      <div>
        <TreeGuides depth={2} />
      </div>,
    );
    const drawn = guides(container);
    expect(drawn).toHaveLength(3);
    const spines = drawn.slice(0, 2);
    expect(spines.map((s) => (s as HTMLElement).style.left)).toEqual([`${TREE_STEP / 2}px`, `${TREE_STEP * 1.5}px`]);
    const elbow = drawn[2] as HTMLElement;
    expect(elbow.style.left).toBe(`${TREE_STEP * 1.5}px`);
    expect(elbow.style.width).toBe("6px");
  });

  it("stops the row's own spine at mid-row when it is the last child", () => {
    const middle = render(
      <div>
        <TreeGuides depth={1} />
      </div>,
    );
    const middleSpine = guides(middle.container)[0] as HTMLElement;
    expect(middleSpine.style.top).toBe("0px");
    expect(middleSpine.style.bottom).toBe("0px");
    middle.unmount();

    const last = render(
      <div>
        <TreeGuides depth={1} last />
      </div>,
    );
    const lastSpine = guides(last.container)[0] as HTMLElement;
    expect(lastSpine.style.top).toBe("50%");
    expect(lastSpine.style.bottom).toBe("50%");
  });

  it("supports five levels", () => {
    const { container } = render(
      <div>
        <TreeGuides depth={5} />
      </div>,
    );
    expect(guides(container)).toHaveLength(6);
    expect((guides(container)[4] as HTMLElement).style.left).toBe(`${TREE_STEP * 4.5}px`);
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
