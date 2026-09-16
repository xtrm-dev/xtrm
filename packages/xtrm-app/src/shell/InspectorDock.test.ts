import { describe, expect, it } from "vitest";
import { RAIL, dockWidth } from "./InspectorDock.tsx";

describe("inspector dock width", () => {
  it("is only the rail when closed", () => {
    expect(dockWidth("CLOSED", 400, 900)).toBe(RAIL);
  });

  it("grows by the drawer width but never past the content card", () => {
    expect(dockWidth("CONTEXTUAL", 400, 900)).toBe(RAIL + 400);
    expect(dockWidth("CONTEXTUAL", 700, 500)).toBe(RAIL + 500 - 24);
    expect(dockWidth("CONTEXTUAL", 400, 0)).toBe(RAIL);
  });

  it("covers exactly the card when maximized and reserves layout width when pinned", () => {
    expect(dockWidth("MAXIMIZED", 400, 900)).toBe(RAIL + 900);
    expect(dockWidth("PINNED", 400, 900)).toBe(RAIL + 400);
  });
});
