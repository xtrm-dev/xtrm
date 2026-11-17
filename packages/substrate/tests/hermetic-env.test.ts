// XTRM-824: the exemption is one named function with its own proof, so widening
// it is a reviewable change rather than a quieter assertion scattered across
// four suites.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withoutNodeSqliteWarning } from "./hermetic-env.ts";

const PAIR = "(node:4242) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n"
  + "(Use `node --trace-warnings ...` to show where the warning was created)\n";

describe("withoutNodeSqliteWarning (XTRM-824)", () => {
  it("removes the sqlite startup pair", () => {
    assert.equal(withoutNodeSqliteWarning(PAIR), "");
  });

  it("removes the pair from the middle of a real payload and keeps the payload whole", () => {
    const payload = "first line\n" + PAIR + "last line\n";
    assert.equal(withoutNodeSqliteWarning(payload), "first line\nlast line\n");
  });

  it("keeps a different ExperimentalWarning: the exemption is the sqlite notice, not warnings in general", () => {
    const other = "(node:1) ExperimentalWarning: Importing JSON modules is an experimental feature\n";
    assert.equal(withoutNodeSqliteWarning(other), other);
  });

  it("keeps a genuine error and its stack", () => {
    const failure = "Error: unresolvable ref\n    at resolve (/pkg/src/x.ts:1:1)\n";
    assert.equal(withoutNodeSqliteWarning(failure), failure);
  });

  it("removes a lone sqlite warning: the trace hint is printed once per process, for the first warning only", () => {
    // A different warning can consume the hint, leaving the sqlite line alone.
    // Stripping it is the point; keeping it would reintroduce the XTRM-824
    // failure for any suite that happens to import node:sqlite second.
    const lone = "(node:9) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n";
    assert.equal(withoutNodeSqliteWarning(lone), "");
  });

  it("keeps the hint line when it is not attached to a sqlite warning", () => {
    const stray = "(node:3) ExperimentalWarning: Something else\n(Use `node --trace-warnings ...` to show where the warning was created)\n";
    assert.equal(withoutNodeSqliteWarning(stray), stray);
  });

  it("is inert on empty stderr", () => {
    assert.equal(withoutNodeSqliteWarning(""), "");
  });
});
