import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";
import { runCli } from "../cli/sb.ts";
import { CLOSURE_OUTCOMES } from "../src/domain/closure.ts";

// Gate pinning tests (XTRM-347): CLI help methodology sentences that the
// M1 surface (XTRM-252.10) promises but no shipped test pins.
//  - `issue edit` help must explicitly say not to use it for progress.
//  - `issue close` help must name the bounded --outcome vocabulary.

function helpText(args: string[]): string {
  const dbPath = join(tempDir("sb-m1-help-"), "never-created.db");
  const res = runCli(args, { dbPath });
  assert.equal(res.code, 0, `${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

describe("m1 help methodology: edit refusal and close outcome vocabulary", () => {
  it("issue edit help says not to use it for progress", () => {
    for (const args of [["help", "issue", "edit"], ["issue", "edit", "--help"]]) {
      const out = helpText(args).toLowerCase();
      assert.match(out, /usage:/, `${args.join(" ")} printed no usage`);
      assert.ok(
        out.includes("do not use") && out.includes("progress"),
        `${args.join(" ")} must say not to use edit for progress`,
      );
    }
  });

  it("issue close help names the bounded outcome vocabulary", () => {
    for (const args of [["help", "issue", "close"], ["issue", "close", "--help"]]) {
      const out = helpText(args).toLowerCase();
      assert.match(out, /usage:/, `${args.join(" ")} printed no usage`);
      for (const outcome of CLOSURE_OUTCOMES) {
        assert.ok(out.includes(outcome), `${args.join(" ")} must name outcome ${outcome}`);
      }
      // XTRM-252.16: the vocabulary must live on the `usage:` line itself. When
      // the assertion only searches the whole page, a usage line that drops the
      // outcome list survives on the surrounding prose.
      const usage = out.split("\n").find((line) => line.includes("usage:")) ?? "";
      assert.match(usage, /usage:\s*sb issue close/, `${args.join(" ")} printed no close usage line`);
      for (const outcome of CLOSURE_OUTCOMES) {
        assert.ok(usage.includes(outcome), `${args.join(" ")} usage line must name outcome ${outcome}`);
      }
    }
  });
});
