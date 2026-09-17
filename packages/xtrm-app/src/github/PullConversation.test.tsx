import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PullRequestReviewComment } from "../adapters/types.ts";
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
