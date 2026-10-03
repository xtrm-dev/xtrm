import { describe, expect, it } from "vitest";
import { fixtureGithub } from "../github/fixture.ts";
import { createFixtureSubstrate } from "../substrate/fixture.ts";
import { createFixtureAgent } from "./fixture.ts";
import {
  REFERENCE_BUDGET_BYTES,
  SUBMIT_BUDGET_BYTES,
  blockReason,
  byteLength,
  checkReferences,
  composeMessage,
  issueReference,
  resolveForSubmit,
  splitMessage,
  truncateUtf8,
} from "./references.ts";
import type { ContextReference } from "./types.ts";

const sources = () => ({ agent: createFixtureAgent(), substrate: createFixtureSubstrate(), github: fixtureGithub });

describe("@ references at submit (XTRM-598)", () => {
  it("resolves each kind through its adapter, in order, with revisions", async () => {
    const check = await resolveForSubmit(sources(), "pi-main", [
      { kind: "issue", ref: "XTRM-301" },
      { kind: "epic", ref: "XTRM-300" },
      { kind: "gh-issue", ref: "xtrm-dev/xtrm#41" },
      { kind: "file", ref: "packages/xtrm-app/src/shell/AppShell.tsx" },
    ]);
    expect(check.unresolved).toEqual([]);
    const [issue, epic, gh, file] = check.references;
    expect(issue).toMatchObject({ kind: "issue", raw: "@issue:XTRM-301", status: "resolved", revision: expect.stringMatching(/^rev:\d+$/), truncated: false });
    expect(issue!.content).toContain("XTRM-301");
    expect(epic!.content).toContain("CHILDREN");
    expect(gh).toMatchObject({ kind: "gh-issue", status: "resolved", revision: expect.stringMatching(/^updated:/) });
    expect(gh!.content).toContain("Steps to reproduce");
    expect(file).toMatchObject({ kind: "file", status: "resolved", revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
    expect(check.totalBytes).toBe(check.references.reduce((n, r) => n + (r.bytes ?? 0), 0));
    expect(blockReason(check)).toBeNull();
  });

  it("blocks submit on an unresolved reference and names the reason", async () => {
    const check = await resolveForSubmit(sources(), "pi-main", [
      { kind: "file", ref: "../secret.txt" },
      { kind: "issue", ref: "NOPE-1" },
      { kind: "pr", ref: "not-a-ref" },
    ]);
    expect(check.unresolved.map((r) => [r.raw, r.error])).toEqual([
      ["@file:../secret.txt", "path_outside_cwd"],
      ["@issue:NOPE-1", "issue_not_found"],
      ["@pr:not-a-ref", "invalid_reference"],
    ]);
    expect(blockReason(check)).toBe(
      "Unresolved reference @file:../secret.txt (path outside cwd), @issue:NOPE-1 (issue not found), @pr:not-a-ref (invalid reference). Fix or remove it before sending.",
    );
  });

  it("blocks submit above the total budget", () => {
    const big = (i: number): ContextReference => ({ kind: "file", raw: `@file:${i}`, status: "resolved", bytes: 32 * 1024 });
    expect(checkReferences([big(1), big(2), big(3)]).overBudget).toBe(false);
    const over = checkReferences([big(1), big(2), big(3), big(4)]);
    expect(over.totalBytes).toBeGreaterThan(SUBMIT_BUDGET_BYTES);
    expect(blockReason(over)).toBe("References total 128 KB, above the 96 KB budget per submit. Remove references before sending.");
  });

  it("keeps whole contract sections in order and points at the full issue above the budget", async () => {
    const issue = await createFixtureSubstrate().getIssue("XTRM-301");
    const long = { ...issue, contract: { ...issue.contract, problem: "p".repeat(10_000), success: "s".repeat(10_000) } };
    const r = issueReference({ kind: "issue", ref: "XTRM-301" }, long);
    expect(r.truncated).toBe(true);
    expect(r.pointer).toBe("sb issue show XTRM-301");
    expect(r.bytes).toBeLessThanOrEqual(REFERENCE_BUDGET_BYTES.issue);
    expect(r.content).toContain("PROBLEM");
    expect(r.content).not.toContain("SUCCESS");
  });

  it("cuts UTF-8 without splitting a character", () => {
    expect(truncateUtf8("aé€", 4)).toBe("aé");
    expect(byteLength(truncateUtf8("€€€", 7))).toBe(6);
  });

  it("round-trips the message block: the Frame gets the text and the revisions back", () => {
    const refs: ContextReference[] = [
      { kind: "file", raw: "@file:big.txt", status: "resolved", revision: "sha256:ab", content: "x", bytes: 1, budgetBytes: 32768, truncated: true, pointer: "@file:big.txt#L1-9000" },
      { kind: "issue", raw: "@issue:XTRM-1", status: "resolved", revision: "rev:4", content: 'a "quoted" </reference> line', bytes: 9, truncated: false },
    ];
    const message = composeMessage("look\n\nat these", refs);
    expect(message).toContain("[excerpt: 1 of the content within the 32768 byte budget; full content: @file:big.txt#L1-9000]");
    expect(splitMessage(message)).toEqual({
      text: "look\n\nat these",
      refs: [
        { kind: "file", ref: "big.txt", revision: "sha256:ab", pointer: "@file:big.txt#L1-9000" },
        { kind: "issue", ref: "XTRM-1", revision: "rev:4" },
      ],
    });
    expect(composeMessage("plain", [])).toBe("plain");
    expect(splitMessage("plain")).toEqual({ text: "plain", refs: [] });
  });
});
