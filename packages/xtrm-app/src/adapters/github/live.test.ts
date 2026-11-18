// Wire fixtures for the GitHub adapter (XTRM-857). The row shape is the Console
// v1 store row (`packages/core/src/github/store.ts` GithubPr) and the detail
// shape is `PrDetailPayload` (`route-runtime.ts`). Field names and the values
// that exist on GitHub were recorded from xtrm-dev/xtrm#212; review and comment
// entries are recorded from #209 and repeated to reach the asserted counts.
import { describe, expect, it } from "vitest";
import { mapPull, mapPullDetail } from "./live.ts";

type Row = Parameters<typeof mapPull>[1];
type Detail = Parameters<typeof mapPullDetail>[2];

const baseRow: Row = {
  repo: "xtrm-dev/xtrm",
  number: 212,
  title: "Substrate: project, name and canonicalise execution identity (XTRM-410, 411, 412)",
  body: null,
  state: "closed",
  author: "Jaggerxtrm",
  url: "https://github.com/xtrm-dev/xtrm/pull/212",
  additions: null,
  deletions: null,
  changed_files: null,
  comment_count: null,
  label_names: null,
  created_at: "2026-09-17T14:14:49Z",
  updated_at: "2026-09-17T14:16:20Z",
  merged_at: "2026-09-17T14:16:18Z",
  closed_at: null,
};

const row = (over: Partial<Row> = {}): Row => ({ ...baseRow, ...over });

const review = (id: number, state: string, submittedAt: string) => ({
  id,
  author: "reviewer-xtrm",
  state,
  body: null,
  url: null,
  submitted_at: submittedAt,
});

const comment = (id: number, createdAt: string) => ({
  id,
  author: "Jaggerxtrm",
  body: `comment ${id}`,
  url: null,
  created_at: createdAt,
});

describe("mapPull (XTRM-857)", () => {
  it("maps every metric the poller row does not carry to null, never 0", () => {
    const pull = mapPull("xtrm-dev/xtrm", row());
    expect(pull.additions).toBeNull();
    expect(pull.deletions).toBeNull();
    expect(pull.changedFiles).toBeNull();
    expect(pull.comments).toBeNull();
    expect(pull.headBranch).toBeNull();
    expect(pull.baseBranch).toBeNull();
    expect(pull.review).toBeNull();
    expect(pull.reviewCount).toBeNull();
    expect(pull.draft).toBe(false);
  });

  it("maps an enriched row's diff, branch, review and comment fields", () => {
    const pull = mapPull(
      "xtrm-dev/xtrm",
      row({
        additions: 822,
        deletions: 61,
        changed_files: 12,
        comment_count: 3,
        head_ref: "xt/identity-drop-fix",
        base_ref: "main",
        draft: true,
        review_state: "changes_requested",
        review_count: 2,
      }),
    );
    expect(pull.additions).toBe(822);
    expect(pull.deletions).toBe(61);
    expect(pull.changedFiles).toBe(12);
    expect(pull.comments).toBe(3);
    expect(pull.headBranch).toBe("xt/identity-drop-fix");
    expect(pull.baseBranch).toBe("main");
    expect(pull.draft).toBe(true);
    expect(pull.review).toBe("changes_requested");
    expect(pull.reviewCount).toBe(2);
  });
});

describe("mapPullDetail (XTRM-857)", () => {
  const detail = (over: Partial<Detail> = {}): Detail => ({
    pr: row({
      head_ref: "xt/identity-drop-fix",
      base_ref: "main",
      draft: false,
      comment_count: 3,
    }),
    comments: [comment(1, "2026-09-17T14:15:00Z"), comment(2, "2026-09-17T14:15:30Z"), comment(3, "2026-09-17T14:16:00Z")],
    reviews: [review(11, "COMMENTED", "2026-09-17T14:15:10Z"), review(12, "APPROVED", "2026-09-17T14:16:10Z")],
    review_comments: [],
    commits: [{ sha: "a1" }, { sha: "b2" }],
    files: [
      { filename: "packages/substrate/cli/sb.ts", status: "modified", additions: 31, deletions: 12 },
      { filename: "packages/substrate/src/domain/execution-context.ts", status: "modified", additions: 194, deletions: 0 },
    ],
    errors: {},
    ...over,
  });

  it("resolves head -> base from the detail payload and counts reviews and comments", () => {
    // The plain row carries no refs or counters; the detail payload does.
    const pull = mapPullDetail("xtrm-dev/xtrm", row(), detail(), null);
    expect(pull.headBranch).toBe("xt/identity-drop-fix");
    expect(pull.baseBranch).toBe("main");
    // The row counters are null, so the file summary is the diff source.
    expect(pull.additions).toBe(225);
    expect(pull.deletions).toBe(12);
    expect(pull.changedFiles).toBe(2);
    expect(pull.comments).toBe(3);
    // Latest review decides; the count is the review list size.
    expect(pull.review).toBe("approved");
    expect(pull.reviewCount).toBe(2);
    expect(pull.reviews.map((r) => r.state)).toEqual(["commented", "approved"]);
    expect(pull.conversationComments).toHaveLength(3);
  });

  it("keeps the poller's persisted counters when the row carries them", () => {
    const pull = mapPullDetail(
      "xtrm-dev/xtrm",
      row({ additions: 822, deletions: 61, changed_files: 12, comment_count: 5 }),
      detail({ pr: row({ head_ref: "xt/identity-drop-fix", base_ref: "main" }) }),
      null,
    );
    expect(pull.additions).toBe(822);
    expect(pull.deletions).toBe(61);
    expect(pull.changedFiles).toBe(12);
    expect(pull.comments).toBe(5);
  });

  it("maps a failed section to unknown, never to zero", () => {
    const pull = mapPullDetail(
      "xtrm-dev/xtrm",
      row(),
      detail({
        pr: row({ head_ref: "xt/identity-drop-fix", base_ref: "main" }),
        comments: [],
        reviews: [],
        files: [],
        errors: { comments: "403 rate limited", reviews: "403 rate limited", files: "403 rate limited" },
      }),
      null,
    );
    expect(pull.additions).toBeNull();
    expect(pull.deletions).toBeNull();
    expect(pull.changedFiles).toBeNull();
    expect(pull.comments).toBeNull();
    expect(pull.review).toBeNull();
    expect(pull.reviewCount).toBeNull();
    expect(pull.reviews).toEqual([]);
  });

  it("names failed sections so the drawer says unavailable, not empty (F1)", () => {
    const pull = mapPullDetail("xtrm-dev/xtrm", row(), detail({ pr: row({ head_ref: "xt/identity-drop-fix", base_ref: "main" }), errors: { files: "500 upstream", comments: "403 forbidden" } }), null);
    expect(pull.unavailableSections).toEqual(["comments", "files"]);
    expect(pull.comments).toBeNull();
    expect(pull.changedFiles).toBeNull();
  });

  it("keeps a known row value when the detail copy sends null (F3)", () => {
    // The backend can send null for a field the row already knows. Null means
    // unknown, so the merge must keep the row value instead of blanking it.
    const detailPr = row({
      head_ref: "xt/identity-drop-fix",
      base_ref: "main",
      body: null,
      url: null,
      draft: null,
      author: null as unknown as string,
    });
    const pull = mapPullDetail(
      "xtrm-dev/xtrm",
      row({ body: "row body", author: "row-author", url: "https://example.test/pull/212", draft: true }),
      detail({ pr: detailPr }),
      null,
    );
    expect(pull.body).toBe("row body");
    expect(pull.author).toBe("row-author");
    expect(pull.url).toBe("https://example.test/pull/212");
    expect(pull.draft).toBe(true);
    expect(pull.unavailableSections).toEqual([]);
  });

  it("keeps zero for a section that is present and genuinely empty", () => {
    const pull = mapPullDetail("xtrm-dev/xtrm", row(), detail({ pr: row({ head_ref: "xt/identity-drop-fix", base_ref: "main" }), comments: [], reviews: [], files: [] }), null);
    expect(pull.additions).toBe(0);
    expect(pull.deletions).toBe(0);
    expect(pull.changedFiles).toBe(0);
    expect(pull.comments).toBe(0);
    expect(pull.review).toBe("none");
    expect(pull.reviewCount).toBe(0);
  });

  it("leaves the commit count unknown when its section failed (F2)", () => {
    const pull = mapPullDetail("xtrm-dev/xtrm", row(), detail({ pr: row(), commits: [], errors: { commits: "502 upstream" } }), null);
    expect(pull.commits).toBeNull();
    expect(pull.unavailableSections).toEqual(["commits"]);
  });
});
