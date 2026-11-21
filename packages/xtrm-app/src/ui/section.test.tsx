import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldLabel } from "./fields.tsx";
import { Fields, InspectorSection } from "./drawer.tsx";
import { Badge } from "./badge.tsx";
import { EmptyState } from "./primitives.tsx";
import { Kbd } from "./primitives.tsx";
import { ListSection, Section, SectionHeader } from "./section.tsx";

// XTRM-934 (epic XTRM-933): one section header, one glyph default, one micro scale. The point of
// these assertions is not that a class string looks nice, it is that the gutter, the step and the
// heading level are decided once. A surface that re-declares any of them has to delete these.

describe("SectionHeader", () => {
  it("takes the list gutter and the micro step, and is an h2 by default", () => {
    render(<SectionHeader title="Pull requests" count={12} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Pull requests" });
    // The step, not the shape: a section name is 0.72rem, never body copy.
    expect(heading.className).toContain("text-xs");
    expect(heading.className).toContain("text-ink-faint");
    // The list gutter is the Row box (h-8 px-3), so the header starts where its rows do.
    const box = heading.parentElement as HTMLElement;
    expect(box.className).toContain("h-8");
    expect(box.className).toContain("px-3");
    expect(screen.getByText("12").className).toContain("tabular");
  });

  it("drops the height and the gutter for the drawer inset", () => {
    render(<SectionHeader title="Overview" inset="drawer" level={3} />);
    const heading = screen.getByRole("heading", { level: 3, name: "Overview" });
    const box = heading.parentElement as HTMLElement;
    // The drawer section owns px-5 py-4, so the header must not add a second gutter.
    expect(box.className).toContain("h-7");
    expect(box.className).not.toContain("px-3");
    expect(box.className).not.toContain("px-5");
  });

  it("keeps an aside at the trailing edge and a mono caption uppercase", () => {
    render(<SectionHeader title="2026-11-20" mono inset="none" aside={<span>2 runs</span>} />);
    const heading = screen.getByRole("heading", { name: "2026-11-20" });
    expect(heading.className).toContain("font-mono");
    expect(heading.className).toContain("uppercase");
    expect(screen.getByText("2 runs").parentElement?.className).toContain("ml-auto");
  });
});

describe("Section", () => {
  it("draws one hairline above and the drawer frame, and the first one drops its rule", () => {
    const { container } = render(<Section title="Labels">body</Section>);
    const frame = container.querySelector("section") as HTMLElement;
    expect(frame.className).toContain("border-t");
    expect(frame.className).toContain("first:border-t-0");
    expect(frame.className).toContain("px-5");
    expect(frame.className).toContain("py-4");
    // Section renders the same header, at drawer inset and h3, as InspectorSection always did.
    expect(screen.getByRole("heading", { level: 3, name: "Labels" }).parentElement?.className).toContain("h-7");
  });

  it("is the component behind InspectorSection, not a second implementation", () => {
    const a = render(<Section title="Comments">body</Section>).container.innerHTML;
    const b = render(<InspectorSection title="Comments">body</InspectorSection>).container.innerHTML;
    expect(b).toBe(a);
  });

  it("ListSection separates stacked lists with one rule and no padding of its own", () => {
    const { container } = render(<ListSection title="Workers">rows</ListSection>);
    const frame = container.querySelector("section") as HTMLElement;
    expect(frame.className).toContain("border-b");
    expect(frame.className).not.toContain("border-t");
    expect(frame.className).not.toContain("px-5");
  });
});

describe("FieldLabel", () => {
  it("renders the shared section heading, so a form label and a drawer heading are one step", () => {
    render(<FieldLabel>Details</FieldLabel>);
    const heading = screen.getByRole("heading", { level: 3, name: "Details" });
    expect(heading.className).toContain("text-xs");
    expect(heading.className).toContain("text-ink-faint");
    // inset="none": the label sits inside a box that already has padding.
    expect(heading.parentElement?.className).not.toContain("h-7");
    expect(heading.parentElement?.className).not.toContain("px-");
  });
});

describe("the micro scale", () => {
  it("Badge xs is the dense step and sm the default, both one step below body", () => {
    render(
      <>
        <Badge size="xs">xs</Badge>
        <Badge>sm</Badge>
      </>,
    );
    expect(screen.getByText("xs").className).toContain("text-2xs");
    expect(screen.getByText("xs").className).toContain("h-4");
    expect(screen.getByText("sm").className).toContain("text-xs");
    expect(screen.getByText("sm").className).toContain("h-[1.125rem]");
    // No arbitrary rem survives in the chip: both steps are named.
    expect(screen.getByText("sm").className).not.toMatch(/text-\[/);
  });

  it("Kbd uses the smallest step, not a literal", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("⌘K").className).toContain("text-2xs");
  });

  it("EmptyState marks itself with a glyph, not a bordered tile", () => {
    const { container } = render(<EmptyState icon="pull" title="No pull requests" />);
    const mark = container.querySelector("svg") as SVGElement;
    expect(mark).toBeTruthy();
    // Eleven pages had a 36px rounded box around this mark; the icon is the only chrome now.
    expect(mark.parentElement?.className).not.toContain("border");
  });

  // XTRM-934 review round 2: `Fields` is the drawer's one label/value grid and its two knobs were the
  // only part of the primitive with no test. Both are rem, and both steps are named tokens.
  it("Fields keeps one label column and names its value step", () => {
    const { container, rerender } = render(<Fields rows={[["State", "open"]]} />);
    const dl = container.querySelector("dl") as HTMLElement;
    // The default column is the drawer's, in rem so it follows the operator's root size.
    expect(dl.style.gridTemplateColumns).toBe("7.5rem 1fr");
    expect(dl.className).toContain("text-sm");
    expect(dl.className).not.toMatch(/text-\[/);

    rerender(<Fields rows={[["State", "open"]]} labelWidth="3.5rem" size="xs" />);
    const dense = container.querySelector("dl") as HTMLElement;
    // A timeline fact is metadata, not body copy: the column narrows and the step drops one.
    expect(dense.style.gridTemplateColumns).toBe("3.5rem 1fr");
    expect(dense.className).toContain("text-xs");
    expect(dense.className).not.toContain("text-sm");
  });
});
