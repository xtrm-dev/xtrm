import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";

describe("Badge", () => {
  it("has a success tone built like danger, so an Open chip is not an accent chip", () => {
    render(<Badge tone="success">Open</Badge>);
    const badge = screen.getByText("Open");
    expect(badge.className).toContain("bg-success/12");
    expect(badge.className).toContain("text-success-ink");
    expect(badge.className).not.toContain("accent-soft");
    // The word is the state; the tone only reinforces it.
    expect(badge.textContent).toBe("Open");
  });

  it("keeps the existing tones", () => {
    render(<Badge tone="danger">Blocked</Badge>);
    expect(screen.getByText("Blocked").className).toContain("bg-danger/12");
  });

  it("keeps shrink-0 by default, so a toolbar or list chip cannot compress", () => {
    render(<Badge>Open</Badge>);
    const classes = screen.getByText("Open").className.split(/\s+/);
    expect(classes).toContain("shrink-0");
    expect(classes).not.toContain("shrink");
    expect(classes).not.toContain("min-w-0");
  });

  it("lets a call site opt in to shrinking, for a constrained wrapping container", () => {
    render(<Badge shrink>area/platform-ui</Badge>);
    const classes = screen.getByText("area/platform-ui").className.split(/\s+/);
    // The class the caller used to be unable to win: `cx` is a plain join, so the primitive must
    // stop emitting `shrink-0` rather than let a later class override it.
    expect(classes).not.toContain("shrink-0");
    expect(classes).toContain("shrink");
    expect(classes).toContain("min-w-0");
  });
});
