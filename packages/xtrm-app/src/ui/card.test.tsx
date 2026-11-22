import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CARD_FRAME, Card } from "./card.tsx";

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

function tsxSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tsxSources(path, found);
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) found.push(path);
  }
  return found;
}

/**
 * XTRM-989: one card. These assertions are about the frame being decided in one place, not about
 * the string reading well: a surface that re-declares a radius or a padding has to delete them.
 */
describe("Card", () => {
  it("draws the row radius, the hairline and the list gutter", () => {
    render(<Card data-testid="card">body</Card>);
    const card = screen.getByTestId("card");
    // The row's radius (--radius-md), never the panel's rounded-lg: a card is a record box, and the
    // panel frame belongs to `Section` (px-5 py-4).
    expect(card.className).toContain("rounded-md");
    expect(card.className).not.toContain("rounded-lg");
    expect(card.className).toContain("border-border-muted");
    // The gutter a list row and a list-inset SectionHeader use, so the card's text starts on the
    // same x as the rows above it; the stack rhythm is the card's, not the caller's.
    expect(card.className).toContain("px-3");
    expect(card.className).toContain("py-2.5");
    expect(card.className).toContain("gap-2");
    expect(card.className).toContain("flex-col");
  });

  it("keeps the frame when a caller adds the state the card cannot know", () => {
    render(<Card data-testid="card" className="bg-deep/40" aria-pressed="true" />);
    const card = screen.getByTestId("card");
    expect(card.className).toContain(CARD_FRAME);
    expect(card.className).toContain("bg-deep/40");
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });

  it("decides radius, gutter and rhythm once, inside the constant", () => {
    // A second `rounded-*`, `px-*` or `py-*` in the frame is the drift the old call sites carried.
    expect(CARD_FRAME.match(/rounded-/g) ?? []).toHaveLength(1);
    expect(CARD_FRAME.match(/\bpx-/g) ?? []).toHaveLength(1);
    expect(CARD_FRAME.match(/\bpy-/g) ?? []).toHaveLength(1);
  });

  it("is the only place a card frame is written: no surface re-declares it", () => {
    // Beside the component, `src/issues` held the same frame twice and the page used another one
    // (`rounded-lg border border-border-muted p-4`). Comments record that history, so the component
    // itself is out of the scan; every other source file must be free of both shapes.
    const offenders: string[] = [];
    for (const file of tsxSources(SRC)) {
      if (file === join(SRC, "ui", "card.tsx")) continue;
      const source = readFileSync(file, "utf8");
      for (const frame of ["rounded-md border border-border-muted px-3 py-2.5", "rounded-lg border border-border-muted"]) {
        if (source.includes(frame)) offenders.push(`${file.slice(SRC.length + 1)}: ${frame}`);
      }
    }
    expect(offenders, "a card is composed from src/ui/card.tsx, never re-drawn").toEqual([]);
  });
});
