import { describe, expect, it } from "vitest";
import { RAIL, dockWidth, frameMinWidth } from "./InspectorDock.tsx";

describe("inspector dock width (in flow)", () => {
  it("reserves only the rail when closed or floating", () => {
    expect(dockWidth("CLOSED", 400)).toBe(RAIL);
    expect(dockWidth("CONTEXTUAL", 400)).toBe(RAIL);
  });

  it("is a real column when pinned and fills the group when maximized", () => {
    expect(dockWidth("PINNED", 400)).toBe(RAIL + 400);
    expect(dockWidth("MAXIMIZED", 400)).toBe("100%");
  });
});

describe("inspector frame min width (visible)", () => {
  it("is the rail when closed and rail plus drawer when open", () => {
    expect(frameMinWidth("CLOSED", 400)).toBe(RAIL);
    for (const state of ["CONTEXTUAL", "PINNED", "MAXIMIZED"]) expect(frameMinWidth(state, 400)).toBe(RAIL + 400);
  });

  it("overhangs the dock only when floating", () => {
    expect(frameMinWidth("CONTEXTUAL", 400)).toBeGreaterThan(dockWidth("CONTEXTUAL", 400) as number);
    expect(frameMinWidth("PINNED", 400)).toBe(dockWidth("PINNED", 400));
  });
});
