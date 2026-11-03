import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GithubPill } from "./github-pill.tsx";

describe("GithubPill", () => {
  it("is a new-tab link with the GitHub mark and the button look", () => {
    const { container } = render(<GithubPill href="https://github.com/xtrm-dev/xtrm/pull/212" />);
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://github.com/xtrm-dev/xtrm/pull/212");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.textContent).toBe("Open on GitHub");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.className).toContain("rounded-full");
    expect(link.className).toContain("bg-github");
  });

  it("accepts its own label", () => {
    const { container } = render(<GithubPill href="https://github.com/xtrm-dev/xtrm">{"Open repository"}</GithubPill>);
    expect(container.querySelector("a")!.textContent).toBe("Open repository");
  });
});
