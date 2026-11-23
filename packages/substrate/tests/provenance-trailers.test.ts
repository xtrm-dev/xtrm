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

describe("refsInGroup is linear (XTRM-953)", () => {
  // A docstring claiming linearity is not a guard: the shipped scanner resumed a failed
  // run at `start + 1`, which is quadratic on one long uppercase run and indistinguishable
  // from linear on real subjects. A budget over a pathological input is the only assertion
  // that can go red for the defect, and it is generous enough not to flake on a slow box.
  const scan = (n: number): number => {
    const subject = `feat: x (${"A".repeat(n)})`;
    const started = performance.now();
    subjectIssueRefs(subject);
    return performance.now() - started;
  };
  it("scans a 32k uppercase run in well under a tenth of the quadratic time", () => {
    scan(2000); // warm the JIT so the budget measures the algorithm, not compilation
    const small = scan(4000);
    const big = scan(32000);
    // 8x the input: linear is ~8x, the defect measured ~270x (208 ms -> 18768 ms).
    assert.ok(big < 2000, `a 32k run took ${big.toFixed(0)}ms; it must stay in the linear regime`);
    assert.ok(big < small * 40 + 200, `8x the input took ${(big / Math.max(small, 0.001)).toFixed(0)}x the time (${small.toFixed(0)}ms -> ${big.toFixed(0)}ms)`);
  });

  it("scans a 32k run with one trailing dash in the same regime", () => {
    // The two overflow points are separate: the no-dash branch fails to advance past
    // an uppercase run, and the dash-with-no-digits branch fails to advance past a
    // dash. `("A" * n)` exercises only the first, so a budget over it alone would
    // say "the scanner is linear on the input I happened to time".
    const scanDash = (n: number): number => {
      const subject = `feat: x (${"A".repeat(n)}-)`;
      const started = performance.now();
      subjectIssueRefs(subject);
      return performance.now() - started;
    };
    scanDash(2000); // warm the JIT, as the no-dash budget does
    const small = scanDash(4000);
    const big = scanDash(32000);
    assert.ok(big < 2000, `a 32k run with a trailing dash took ${big.toFixed(0)}ms; it must stay in the linear regime`);
    assert.ok(big < small * 40 + 200, `8x the input took ${(big / Math.max(small, 0.001)).toFixed(0)}x the time (${small.toFixed(0)}ms -> ${big.toFixed(0)}ms)`);
  });

  it("still returns exactly what the regex returned, so the budget is not bought by scanning less", () => {
    // These pin BEHAVIOUR, not approval: the scanner is permissive by design (a prefix is any
    // uppercase/digit run, so `(ABXTRM-9)` is a ref and `(XTRM-9AB)` reads as `XTRM-9`), and
    // every value here is what the recursive-descent regex form returned on the same subject.
    // The pair of tests is the point: linearity must be bought by the scanner's advance, never
    // by scanning less. If a later refactor narrows the shape, these rows move with it and the
    // diff says so.
    const cases: Array<[string, string[]]> = [
      ["(XTRM-934)", ["XTRM-934"]],
      ["(XTRM-811.23)", ["XTRM-811.23"]],
      ["(XTRM-949, XTRM-958)", ["XTRM-949", "XTRM-958"]],
      ["(ABXTRM-9)", ["ABXTRM-9"]],
      ["(XTRM-9AB)", ["XTRM-9"]],
      ["(A-B-1)", ["B-1"]],
      ["(XTRM---3)", []],
      ["(9XTRM-1)", ["XTRM-1"]],
      ["(XTRM-9.)", ["XTRM-9"]],
    ];
    for (const [subject, expected] of cases) assert.deepEqual(subjectIssueRefs(subject), expected, subject);
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

  it("takes only a trailing suffix, not a parenthesised group mid-subject", () => {
    // Before this, the scanner matched every parenthesised group, so prose that
    // named a ref ("keep (XTRM-500) ordering intact") claimed the commit for an
    // issue it only talks about. A widened scanner turns both rows red.
    assert.deepEqual(subjectIssueRefs("fix: keep (XTRM-500) ordering intact (XTRM-123)"), ["XTRM-123"]);
    assert.deepEqual(subjectIssueRefs("fix: keep (XTRM-500) ordering intact"), []);
  });
});
