import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon.tsx";

const svg = (container: HTMLElement) => container.querySelector("svg")!;

describe("Icon sizes", () => {
  it("renders the two new sizes: text 13px and micro 12px", () => {
    const text = render(<Icon name="pull" size="text" />);
    expect(svg(text.container).getAttribute("width")).toBe("13");
    const micro = render(<Icon name="pull" size="micro" />);
    expect(svg(micro.container).getAttribute("width")).toBe("12");
  });

  it("keeps the existing ladder unchanged", () => {
    for (const [size, width] of [["xs", "14"], ["sm", "16"], ["nav", "16"], ["md", "18"], ["lg", "20"]] as const) {
      const { container } = render(<Icon name="pull" size={size} />);
      expect(svg(container).getAttribute("width")).toBe(width);
    }
  });

  it("uses stroke 2 at text and micro and the app weight 2.25 elsewhere", () => {
    for (const size of ["text", "micro"] as const) {
      const { container } = render(<Icon name="pull" size={size} />);
      expect(svg(container).getAttribute("stroke-width")).toBe("2");
    }
    for (const size of ["xs", "sm", "nav", "md", "lg"] as const) {
      const { container } = render(<Icon name="pull" size={size} />);
      expect(svg(container).getAttribute("stroke-width")).toBe("2.25");
    }
  });

  it("still accepts an explicit strokeWidth", () => {
    const { container } = render(<Icon name="pull" size="text" strokeWidth={1.75} />);
    expect(svg(container).getAttribute("stroke-width")).toBe("1.75");
  });
});

describe("Icon registry additions", () => {
  it("has the local filter and the lock glyphs", () => {
    expect(svg(render(<Icon name="filter" />).container).getAttribute("class")).toContain("lucide-list-filter");
    expect(svg(render(<Icon name="lock" />).container).getAttribute("class")).toContain("lucide-lock");
  });

  it("has one glyph per PR state, distinct from the existing open-PR glyph", () => {
    expect(svg(render(<Icon name="pull" />).container).getAttribute("class")).toContain("lucide-git-pull-request");
    expect(svg(render(<Icon name="pullDraft" />).container).getAttribute("class")).toContain("lucide-git-pull-request-draft");
    expect(svg(render(<Icon name="pullClosed" />).container).getAttribute("class")).toContain("lucide-git-pull-request-closed");
    expect(svg(render(<Icon name="merge" />).container).getAttribute("class")).toContain("lucide-git-merge");
  });
});
