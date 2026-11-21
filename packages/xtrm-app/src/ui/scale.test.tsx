import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_REM, Icon } from "./icon.tsx";
import { GithubMark } from "./github-mark.tsx";
import { NavRailItem } from "./nav-rail.tsx";
import { IconButton } from "./primitives.tsx";
import { SidebarRow } from "./sidebar.tsx";
import { ListFilter, ToolbarButton } from "./toolbar.tsx";

/**
 * XTRM-897: one type scale, one glyph scale, one unit. The app's text tokens are rem
 * (`body` takes `--text-sm` = 0.8125rem), so a component that hard-codes its own px stays behind
 * when the root font size is not 16px. The operator runs the console at a smaller root: 13px child
 * labels then render 1.33x the 9.75px parent rows, and 16px glyphs sit beside 8.64px toolbar text.
 *
 * jsdom has no layout and no rem resolution, so this file guards the tokens and the classes that
 * carry them; `e2e/ui-scale.spec.ts` measures the computed font size and glyph box in a browser at
 * the default and at the operator's root size.
 */

const sizeClass = (svg: SVGSVGElement) => Array.from(svg.classList).find((name) => name.startsWith("size-")) ?? "";

const remOf = (className: string) => {
  if (/^size-\d+$/.test(className)) return Number(className.slice(5)) * 0.25;
  const match = className.match(/^size-\[([\d.]+)rem\]$/);
  return match ? Number(match[1]) : NaN;
};

describe("the glyph ladder is a rem ladder", () => {
  it("derives every step to a finite rem number", () => {
    // `remOf` returns NaN for a class it cannot read; a silently NaN ladder would make every
    // comparison below vacuous (toBeCloseTo(NaN) fails, but only once a class is rendered).
    for (const [size, rem] of Object.entries(ICON_REM)) {
      expect(Number.isFinite(rem), `${size} must resolve to a number`).toBe(true);
      expect(rem, `${size} must be positive`).toBeGreaterThan(0);
    }
  });
  it("resolves every icon size to the px it has at a 16px root, in rem", () => {
    for (const [size, rem] of Object.entries(ICON_REM) as Array<[keyof typeof ICON_REM, number]>) {
      const { container } = render(<Icon name="pull" size={size} />);
      const svg = container.querySelector("svg")!;
      const declared = Number(svg.getAttribute("width"));
      // The class is what the browser applies; it must equal the documented px at a 16px root.
      expect(remOf(sizeClass(svg)), `${size} class`).toBeCloseTo(rem, 4);
      expect(rem * 16, `${size} at a 16px root`).toBeCloseTo(declared, 4);
      // The px attribute stays as the no-CSS fallback, so it must not drift from the ladder.
      expect(Number(svg.getAttribute("height"))).toBe(declared);
    }
  });

  it("keeps an extra class from overriding the size class", () => {
    const { container } = render(<Icon name="pull" size="text" className="text-ink-faint" />);
    const svg = container.querySelector("svg")!;
    expect(sizeClass(svg)).toBe("size-[0.8125rem]");
    expect(svg.getAttribute("class")).toContain("text-ink-faint");
  });
});

describe("the new rows and controls use the existing tokens", () => {
  it("gives a NavRail child the same type token as its parent row", () => {
    render(
      <SidebarRow icon="program" label="Project" expanded onToggle={() => {}}>
        <NavRailItem label="Overview" onActivate={() => {}} />
      </SidebarRow>,
    );
    const child = screen.getByText("Overview").closest("[role='button']") as HTMLElement;
    // `body` sets `--text-sm`; the parent row inherits it. The child must name that token, never a
    // copy of its current px value.
    expect(child.className).toContain("text-sm");
    expect(child.className).not.toMatch(/text-\[\d+px\]/);
    // Line height comes with the token, so the two rows cannot diverge there either.
    expect(child.className).not.toMatch(/(^|\s)leading-/);
  });

  it("sizes the sidebar filter and a toolbar button glyph the same", () => {
    const filter = render(<ListFilter value="" onChange={() => {}} />);
    const resting = filter.getByRole("button", { name: "Filter this list" });
    const filterGlyph = resting.querySelector("svg")!;
    const toolbar = render(<ToolbarButton icon="filter">Filter</ToolbarButton>);
    const toolbarGlyph = toolbar.container.querySelector("svg")!;
    expect(sizeClass(filterGlyph)).toBe(sizeClass(toolbarGlyph));
    expect(remOf(sizeClass(filterGlyph)) * 16).toBe(13);
  });

  it("lets an icon button name a glyph size, and defaults to the button's own text step", () => {
    const named = render(<IconButton icon="filter" label="Filter" iconSize="text" />);
    expect(sizeClass(named.getByRole("button", { name: "Filter" }).querySelector("svg")!)).toBe("size-[0.8125rem]");
    // XTRM-934: a size-7 control took a 16px glyph and outweighed the 11.5px label beside it.
    const fallback = render(<IconButton icon="filter" label="Default" />);
    expect(sizeClass(fallback.getByRole("button", { name: "Default" }).querySelector("svg")!)).toBe("size-[0.8125rem]");
    // A 36px control keeps the step it had.
    const large = render(<IconButton icon="filter" label="Large" size="md" />);
    expect(sizeClass(large.getByRole("button", { name: "Large" }).querySelector("svg")!)).toBe("size-[1.125rem]");
    // A 16px mark is still available, but now it is an explicit decision.
    const mark = render(<IconButton icon="filter" label="Mark" iconSize="sm" />);
    expect(sizeClass(mark.getByRole("button", { name: "Mark" }).querySelector("svg")!)).toBe("size-4");
  });

  it("sizes the octocat mark from the same rem ladder", () => {
    // The mark is a glyph: a px `size` number here stayed put while the text shrank (XTRM-907).
    const { container } = render(<GithubMark size="xs" />);
    const svg = container.querySelector("svg")!;
    expect(sizeClass(svg)).toBe("size-[0.875rem]");
    expect(Number(svg.getAttribute("width"))).toBe(14);
    expect(Number(svg.getAttribute("height"))).toBe(14);
  });

  it("keeps the NavRail geometry in rem so the child label column cannot drift", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
    expect(token("x-rail-indent")).toMatch(/rem/);
    expect(token("x-rail-gutter")).toMatch(/rem/);
    // At a 16px root the pair still resolves to the documented 15px / 18px.
    expect(token("x-rail-indent")).toBe("calc(1rem - 1px)");
    expect(token("x-rail-gutter")).toBe("1.125rem");
    // XTRM-927: a child row is pulled left by the rail x plus its hairline (16px) and its text inset
    // grows by that pull (34px), so the fill reaches the sidebar edge while the label column holds.
    expect(token("x-rail-pull")).toBe("calc(var(--x-rail-indent) + 1px)");
    expect(token("x-rail-text")).toBe("calc(var(--x-rail-pull) + var(--x-rail-gutter))");
  });
});
