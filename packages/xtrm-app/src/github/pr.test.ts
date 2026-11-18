import { describe, expect, it } from "vitest";
import { conversationUnavailable, mergeableText } from "./pr.ts";

describe("mergeableText (XTRM-857, F2)", () => {
  it("returns null when the mergeable state is unknown, so the row renders a dash", () => {
    expect(mergeableText(null, null)).toBeNull();
    expect(mergeableText(true, null)).toBeNull();
  });

  it("labels each mergeable state", () => {
    expect(mergeableText(true, "clean")).toBe("mergeable · clean");
    expect(mergeableText(false, "dirty")).toBe("conflicts · dirty");
    expect(mergeableText(null, "unknown")).toBe("unknown · unknown");
  });
});

describe("conversationUnavailable (XTRM-857, F1)", () => {
  it("treats a failed comments, reviews or review_comments section as unavailable", () => {
    expect(conversationUnavailable(["comments"])).toBe(true);
    expect(conversationUnavailable(["reviews"])).toBe(true);
    expect(conversationUnavailable(["review_comments"])).toBe(true);
    expect(conversationUnavailable(["files", "reviews"])).toBe(true);
  });

  it("leaves the conversation available when only other sections failed", () => {
    expect(conversationUnavailable([])).toBe(false);
    expect(conversationUnavailable(["files", "commits", "timeline", "pr"])).toBe(false);
  });
});
