// Every trailer value, not only the last (XTRM-734).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAllTrailers, parseTrailers } from "../src/domain/provenance.ts";

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

  it("pins the single-value parser's legacy last-wins result", () => {
    assert.equal(parseTrailers("XTRM-Issue: A\nXTRM-Issue: B\n").issueId, "B");
  });
});
