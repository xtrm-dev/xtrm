// Every trailer value, not only the last (XTRM-734).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAllTrailers, parseTrailers, subjectIssueRefs } from "../src/domain/provenance.ts";

describe("parseAllTrailers", () => {
  it("returns both issue/revision pairs in order", () => {
    const msg = [
      "feat: work",
      "",
      "XTRM-Issue: XTRM-1",
      "XTRM-Issue-Revision: 3",
      "XTRM-Issue: XTRM-2",
      "XTRM-Issue-Revision: 5",
      "XTRM-Receipt: rec-1",
    ].join("\n");
    assert.deepEqual(parseAllTrailers(msg), {
      issues: [
        { issueId: "XTRM-1", issueRevision: 3 },
        { issueId: "XTRM-2", issueRevision: 5 },
      ],
      receipts: ["rec-1"],
    });
  });

  it("keeps an issue without a revision and attaches a later one", () => {
    const msg = "XTRM-Issue: XTRM-7\nXTRM-Issue-Revision: 2\n";
    assert.deepEqual(parseAllTrailers(msg).issues, [{ issueId: "XTRM-7", issueRevision: 2 }]);
  });

  it("dedupes identical pairs and receipts, ignores malformed lines", () => {
    const msg = [
      "XTRM-Issue: XTRM-1",
      "XTRM-Issue: XTRM-1",
      "XTRM-Issue:",
      "XTRM-Issue-Revision: 4",
      "XTRM-Issue-Revision: nope",
      "XTRM-Receipt: r1",
      "XTRM-Receipt: r1",
    ].join("\n");
    // The empty issue line resets the pairing, so revision 4 attaches to
    // nothing; XTRM-1 stays revision-less and is deduped.
    assert.deepEqual(parseAllTrailers(msg), {
      issues: [{ issueId: "XTRM-1", issueRevision: null }],
      receipts: ["r1"],
    });
  });

  it("dedupes two identical issue+revision pairs", () => {
    const msg = [
      "XTRM-Issue: XTRM-1",
      "XTRM-Issue-Revision: 2",
      "XTRM-Issue: XTRM-1",
      "XTRM-Issue-Revision: 2",
    ].join("\n");
    assert.deepEqual(parseAllTrailers(msg).issues, [{ issueId: "XTRM-1", issueRevision: 2 }]);
  });

  it("an empty issue line does not receive the next revision", () => {
    const msg = ["XTRM-Issue: XTRM-1", "XTRM-Issue:", "XTRM-Issue-Revision: 4"].join("\n");
    assert.deepEqual(parseAllTrailers(msg).issues, [{ issueId: "XTRM-1", issueRevision: null }]);
  });

  it("a blank issue after a revision resets and keeps the first pair", () => {
    const msg = ["XTRM-Issue: A", "XTRM-Issue-Revision: 1", "XTRM-Issue:", "XTRM-Issue-Revision: 9"].join("\n");
    assert.deepEqual(parseAllTrailers(msg).issues, [{ issueId: "A", issueRevision: 1 }]);
  });

  it("a second revision for one issue keeps the first and ignores the later line", () => {
    const msg = ["XTRM-Issue: A", "XTRM-Issue-Revision: 1", "XTRM-Issue-Revision: 2"].join("\n");
    assert.deepEqual(parseAllTrailers(msg).issues, [{ issueId: "A", issueRevision: 1 }]);
  });

  it("rejects a revision that is not plain decimal digits", () => {
    for (const bad of ["0x10", "-2", "1.5", "+3"]) {
      const msg = `XTRM-Issue: A\nXTRM-Issue-Revision: ${bad}`;
      assert.deepEqual(parseAllTrailers(msg).issues, [{ issueId: "A", issueRevision: null }], bad);
    }
  });

  it("pins the single-value parser's legacy last-wins result", () => {
    assert.equal(parseTrailers("XTRM-Issue: A\nXTRM-Issue: B\n").issueId, "B");
  });
});

describe("subjectIssueRefs (XTRM-953)", () => {
  // `xt` names its issue in the subject, not in a trailer. Both shapes must be
  // readable or a whole merge queue's evidence is invisible: before this, zero
  // of the (XTRM-938)-style commits ever attached.
  it("reads the suffix the way xt writes it", () => {
    assert.deepEqual(subjectIssueRefs("feat(console): one section header (XTRM-934) (#466)"), ["XTRM-934"]);
  });

  it("reads dotted children and dedupes", () => {
    assert.deepEqual(subjectIssueRefs("fix: thing (XTRM-811.23) (XTRM-811.23)"), ["XTRM-811.23"]);
  });

  it("reads every ref in a multi-issue subject", () => {
    assert.deepEqual(subjectIssueRefs("chore: two lanes (XTRM-949, XTRM-958)"), ["XTRM-949", "XTRM-958"]);
  });

  it("reads only the subject line, because a ref in the body prose is not evidence", () => {
    assert.deepEqual(subjectIssueRefs("feat: work\n\nsee (XTRM-123) for context"), []);
  });

  it("ignores lowercase and unparenthesised refs", () => {
    assert.deepEqual(subjectIssueRefs("feat: xtrm-931 and XTRM-931 without parens"), []);
  });

  it("returns nothing for a message with no suffix", () => {
    assert.deepEqual(subjectIssueRefs("just a subject"), []);
  });
});
