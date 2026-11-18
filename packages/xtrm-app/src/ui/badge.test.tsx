import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";

describe("Badge", () => {
  it("has a success tone built like danger, so an Open chip is not an accent chip", () => {
    render(<Badge tone="success">Open</Badge>);
    const badge = screen.getByText("Open");
    expect(badge.className).toContain("bg-success/12");
    expect(badge.className).toContain("text-success");
    expect(badge.className).not.toContain("accent-soft");
    // The word is the state; the tone only reinforces it.
    expect(badge.textContent).toBe("Open");
  });

  it("keeps the existing tones", () => {
    render(<Badge tone="danger">Blocked</Badge>);
    expect(screen.getByText("Blocked").className).toContain("bg-danger/12");
  });
});
