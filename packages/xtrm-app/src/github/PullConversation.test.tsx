import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PullRequestComment, PullRequestReviewComment } from "../adapters/types.ts";
import { PullConversation, buildConversation, groupReviewThreads } from "./PullConversation.tsx";

const rc = (over: Partial<PullRequestReviewComment> & { id: string }): PullRequestReviewComment => ({
  author: "Jaggerxtrm",
  body: "body",
  path: "packages/xtrm-app/docs/README.md",
  line: 24,
  originalLine: null,
  inReplyToId: null,
  diffHunk: null,
  url: null,
  createdAt: "2026-09-17T13:03:31Z",
  updatedAt: null,
  ...over,
});

describe("groupReviewThreads", () => {
  it("groups a root with its explicit reply", () => {
    const threads = groupReviewThreads([
      rc({ id: "1", createdAt: "2026-09-17T13:03:31Z" }),
      rc({ id: "2", body: "reply", inReplyToId: "1", createdAt: "2026-09-17T13:03:32Z" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe("1");
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["2"]);
    expect(threads[0]!.path).toBe("packages/xtrm-app/docs/README.md");
    expect(threads[0]!.line).toBe(24);
  });

  it("threads same-line comments without in_reply_to_id (current backend shape)", () => {
    const threads = groupReviewThreads([
      rc({ id: "1", body: "root", createdAt: "2026-09-17T13:03:31Z" }),
      rc({ id: "2", body: "reply", createdAt: "2026-09-17T13:03:32Z" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe("1");
    expect(threads[0]!.replies).toHaveLength(1);
  });

  it("splits different lines into separate threads", () => {
    const threads = groupReviewThreads([rc({ id: "1", line: 24 }), rc({ id: "2", line: 30 })]);
    expect(threads).toHaveLength(2);
  });

  it("groups outdated comments by original_line when line is null", () => {
    const threads = groupReviewThreads([
      rc({ id: "1", line: null, originalLine: 24 }),
      rc({ id: "2", line: null, originalLine: 24, body: "reply" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.line).toBe(24);
  });
});

describe("buildConversation", () => {
  it("orders comments and review summaries chronologically and skips empty bodies", () => {
    const items = buildConversation(
      [
        { id: "c1", author: "a", body: "first", url: null, createdAt: "2026-09-17T13:03:12Z", updatedAt: null },
        { id: "c2", author: "a", body: "   ", url: null, createdAt: "2026-09-17T13:03:10Z", updatedAt: null },
      ],
      [
        { id: "r1", author: "b", state: "commented", submittedAt: "2026-09-17T13:03:31Z", body: "summary", url: null },
        { id: "r2", author: "b", state: "commented", submittedAt: "2026-09-17T13:03:32Z", body: "", url: null },
        { id: "r3", author: "b", state: "commented", submittedAt: "2026-09-17T13:03:33Z", body: null, url: null },
      ],
    );
    expect(items.map((i) => i.id)).toEqual(["c1", "r1"]);
  });
});

describe("PullConversation", () => {
  it("renders Markdown bodies with author, time, and file:line threads", () => {
    render(
      <PullConversation
        comments={[{ id: "c1", author: "Jaggerxtrm", body: "**convo** comment", url: null, createdAt: "2026-09-17T13:03:12Z", updatedAt: null }]}
        reviews={[{ id: "r1", author: "Jaggerxtrm", state: "commented", submittedAt: "2026-09-17T13:03:31Z", body: "**summary** body", url: null }]}
        reviewComments={[
          rc({ id: "1", body: "inline **root**", createdAt: "2026-09-17T13:03:31Z" }),
          rc({ id: "2", body: "thread reply", inReplyToId: "1", createdAt: "2026-09-17T13:03:32Z" }),
        ]}
      />,
    );
    // Markdown bodies render through the shared Markdown component.
    expect(screen.getByText("convo")).toBeTruthy();
    expect(screen.getByText("summary")).toBeTruthy();
    expect(screen.getByText("root")).toBeTruthy();
    expect(screen.getByText("thread reply")).toBeTruthy();
    // Compact file:line header for the code-anchored thread.
    expect(screen.getByText("packages/xtrm-app/docs/README.md:24")).toBeTruthy();
    // Review state badge and author/time affordances.
    expect(screen.getByText("commented")).toBeTruthy();
    expect(screen.getAllByText("Jaggerxtrm").length).toBeGreaterThanOrEqual(3);
  });

  it("renders an empty state when there is no conversation", () => {
    render(<PullConversation comments={[]} reviews={[]} reviewComments={[]} />);
    expect(screen.getByText("No conversation yet.")).toBeTruthy();
  });
});

// XTRM-697: pr-lens posts pure HTML (headings, <details>, <picture> with a light and a dark SVG),
// several times per PR, from an app account. All of it must render, every time.
const prLensComment = (id: string, title: string, minutes: number): PullRequestComment => ({
  id,
  author: "github-actions[bot]",
  body: `<!-- pr-lens -->\n\n<h3>${title}</h3>\n\n<details open>\n<summary><b>${title}</b></summary>\n<a href="https://example.invalid/${id}-light.svg"><picture>\n  <source media="(prefers-color-scheme: dark)" srcset="https://example.invalid/${id}-dark.svg">\n  <img alt="${title}" src="https://example.invalid/${id}-light.svg" width="1318">\n</picture></a>\n</details>`,
  url: `https://github.com/xtrm-dev/xtrm/pull/212#issuecomment-${id}`,
  createdAt: new Date(Date.UTC(2026, 8, 16, 17, 0 - minutes)).toISOString(),
  updatedAt: null,
});

describe("PullConversation GitHub HTML", () => {
  const human: PullRequestComment = { id: "h1", author: "Jaggerxtrm", body: "Heads up: this needs the Mod+I tooltip.", url: null, createdAt: new Date(Date.UTC(2026, 8, 16, 16, 20)).toISOString(), updatedAt: null };
  const comments = [human, prLensComment("c2", "Review package", 15), prLensComment("c3", "Review package (2)", 10)];

  it("renders every comment, including two from the same app account", () => {
    const { container } = render(<PullConversation comments={comments} reviews={[]} reviewComments={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getAllByText("Review package").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Review package (2)").length).toBeGreaterThanOrEqual(1);
  });

  it("renders each pr-lens diagram as an image", () => {
    const { container } = render(<PullConversation comments={comments} reviews={[]} reviewComments={[]} />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(container.querySelectorAll("img")[0]!.getAttribute("src")).toBe("https://example.invalid/c2-light.svg");
  });

  it("marks app accounts with the GitHub mark and people with an initial", () => {
    const { container } = render(<PullConversation comments={comments} reviews={[]} reviewComments={[]} />);
    const avatars = [...container.querySelectorAll("[aria-hidden='true']")];
    expect(avatars.filter((a) => a.querySelector("svg"))).toHaveLength(2);
    expect([...container.querySelectorAll("span")].filter((s) => s.textContent === "app")).toHaveLength(2);
    expect(screen.getAllByText("github-actions[bot]")).toHaveLength(2);
    expect(container.textContent).toContain("J");
  });
});
