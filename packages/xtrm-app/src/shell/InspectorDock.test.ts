import { describe, expect, it } from "vitest";
import { RAIL, dockWidth } from "./InspectorDock.tsx";

describe("inspector dock width", () => {
  it("is only the rail when closed", () => {
    expect(dockWidth("CLOSED", 400)).toBe(RAIL);
  });

  it("is rail plus drawer width in flow (no overlay clamp, no clipping)", () => {
    expect(dockWidth("CONTEXTUAL", 400)).toBe(RAIL + 400);
    expect(dockWidth("PINNED", 400)).toBe(RAIL + 400);
  });

  it("fills the group when maximized so it covers the card area", () => {
    expect(dockWidth("MAXIMIZED", 400)).toBe("100%");
  });
});
