import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityScrutinyPill } from "./meta.tsx";

const pill = (priority: number | null, scrutiny: string | null) => {
  const { container } = render(<PriorityScrutinyPill priority={priority} scrutiny={scrutiny} />);
  return container.querySelector<HTMLElement>('[data-stat="priority"]');
};

describe("PriorityScrutinyPill (2026-11-27 ruling)", () => {
  it("carries the priority bars and the scrutiny word in one pill, both named in the tooltip", () => {
    const el = pill(1, "HIGH")!;
    expect(el.textContent).toBe("High");
    const glyph = el.querySelector<HTMLElement>('[aria-label^="P1"]')!;
    // The in-pill glyph is the compact 10px form, the height of the row text.
    expect(glyph.className).toContain("h-2.5");
    expect(el.getAttribute("title")).toBe("P1 · High · High scrutiny");
  });

  it("tints by scrutiny on existing tokens: neutral, attention for High, danger for Critical", () => {
    expect(pill(2, "LOW")!.className).toContain("bg-pressed");
    expect(pill(2, "MEDIUM")!.className).toContain("bg-pressed");
    expect(pill(2, "HIGH")!.className).toContain("bg-chip-attention/12");
    expect(pill(2, "HIGH")!.className).not.toContain("accent");
    expect(pill(2, "CRITICAL")!.className).toContain("bg-danger/12");
  });

  it("states a missing value in the tooltip and renders nothing when both are absent", () => {
    expect(pill(3, null)!.getAttribute("title")).toBe("P3 · Low · Scrutiny not set");
    expect(pill(null, null)).toBeNull();
  });
});
