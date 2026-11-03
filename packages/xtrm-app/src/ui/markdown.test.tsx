import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown, proxyGithubAsset } from "./markdown.tsx";

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

// pr-lens posts pure HTML: a heading, a meta paragraph, and <details> blocks holding a <picture>
// with a light and a dark SVG. GitHub renders it; the Inspector must render it the same way.
const PR_LENS = `<h3>Rail keyboard model review package</h3>

<p>The change reworks the rail. <code>1 file</code> · <code>+412</code></p>

<details open>
<summary><b>Rail before and after</b></summary>

<a href="https://example.invalid/rail-light.svg"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://example.invalid/rail-dark.svg">
  <img alt="Rail before and after" src="https://example.invalid/rail-light.svg" width="1318">
</picture></a>

</details>

<sub>◈ Rendered by <a href="https://github.com/coldteadotai/pr-lens">PR Lens</a></sub>`;

describe("Markdown html", () => {
  afterEach(() => {
    document.documentElement.dataset.theme = "light";
  });

  it("renders a GitHub HTML body: headings, code, details and the diagram", () => {
    const { container } = render(<Markdown html>{PR_LENS}</Markdown>);
    expect(container.querySelector("h3")!.textContent).toBe("Rail keyboard model review package");
    expect(container.querySelector("code")!.textContent).toBe("1 file");
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(1);
    expect(details[0]!.hasAttribute("open")).toBe(true);
    expect(container.querySelectorAll("summary")).toHaveLength(1);
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute("src")).toBe("https://example.invalid/rail-light.svg");
    expect(images[0]!.getAttribute("alt")).toBe("Rail before and after");
    expect(images[0]!.getAttribute("width")).toBe("1318");
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("selects the dark diagram from the app theme, not prefers-color-scheme", () => {
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<Markdown html>{PR_LENS}</Markdown>);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://example.invalid/rail-dark.svg");
    expect(container.querySelector("picture")).toBeNull();
  });

  it("keeps script, style, inline svg, event handlers and javascript URLs out", () => {
    const hostile = `<h3>ok</h3><script>alert(1)</script><style>b{}</style><iframe src="https://evil.invalid"></iframe>
<svg><circle r="4"></circle></svg><img src="javascript:alert(1)" onerror="alert(1)" alt="x"><a href="javascript:alert(1)">go</a>`;
    const { container } = render(<Markdown html>{hostile}</Markdown>);
    expect(container.querySelector("h3")).not.toBeNull();
    expect(container.querySelector("script, style, iframe, svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The anchor survives as inert text: the sanitizer drops the javascript: href.
    expect(container.querySelector("a")!.hasAttribute("href")).toBe(false);
  });

  it("renders no raw HTML without the html prop", () => {
    const { container } = render(<Markdown>{PR_LENS}</Markdown>);
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("proxyGithubAsset", () => {
  it("routes a repository SVG through the console instead of github.com", () => {
    expect(proxyGithubAsset("https://github.com/o/r/raw/pr-lens/pr/7/abc/diagram-light-1a2b.svg")).toBe(
      "/api/github/repo/o/r/raw-svg?path=pr%2F7%2Fabc%2Fdiagram-light-1a2b.svg&ref=pr-lens",
    );
    expect(proxyGithubAsset("https://raw.githubusercontent.com/o/r/pr-lens/diagram.svg")).toBe("/api/github/repo/o/r/raw-svg?path=diagram.svg&ref=pr-lens");
  });

  it("leaves other addresses alone", () => {
    for (const url of [
      "https://github.com/o/r/raw/pr-lens/notes.md",
      "https://avatars.githubusercontent.com/u/1?v=4",
      "https://example.invalid/diagram.svg",
      "/api/github/repo/o/r/raw-svg?path=a.svg&ref=main",
    ]) {
      expect(proxyGithubAsset(url)).toBe(url);
    }
  });

  it("renders a comment diagram with the proxied address", () => {
    const { container } = render(<Markdown html>{'<img src="https://github.com/o/r/raw/pr-lens/pr/7/abc/d.svg" alt="d">'}</Markdown>);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/api/github/repo/o/r/raw-svg?path=pr%2F7%2Fabc%2Fd.svg&ref=pr-lens");
  });
});
