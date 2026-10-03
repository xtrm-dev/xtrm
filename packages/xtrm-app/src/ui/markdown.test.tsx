import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown.tsx";

// Assistant replies keep single newlines (XTRM-615); every other markdown surface keeps GFM soft breaks.
const lines = (el: HTMLElement) => el.querySelectorAll("br").length;

describe("Markdown breaks", () => {
  it("renders each single-newline line of a reply on its own line", () => {
    const { container } = render(<Markdown breaks>{"1\n2\n3\n4\n5"}</Markdown>);
    const p = container.querySelectorAll("p");
    expect(p).toHaveLength(1);
    expect(lines(p[0]!)).toBe(4);
    expect(p[0]!.textContent).toBe("12345".split("").join("\n"));
  });

  it("leaves paragraphs, lists and code blocks as they were", () => {
    const md = "First line\nsecond line\n\n- a\n- b\n\n```\nx\ny\n```\n\nEnd";
    const { container } = render(<Markdown breaks>{md}</Markdown>);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(lines(container.querySelector("p")!)).toBe(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("ul br")).toBeNull();
    expect(container.querySelector("pre code")!.textContent).toBe("x\ny\n");
    expect(container.querySelector("pre br")).toBeNull();
  });

  it("keeps soft breaks as spaces without the prop", () => {
    const { container } = render(<Markdown>{"1\n2\n3"}</Markdown>);
    expect(lines(container)).toBe(0);
  });
});
