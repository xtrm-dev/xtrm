import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runUxCli } from "../cli/sb-ux.ts";

describe("XTRM-94 wrapper-only help surfaces", () => {
  it("sb issue browse --help succeeds without opening the database", async () => {
    const result = await runUxCli(["issue", "browse", "--help"], {
      isTTY: false,
      env: { HOME: "/definitely-empty", NO_COLOR: "1" },
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /interactive read-first Issue navigator/);
    assert.match(result.stdout, /active → all → closed/);
    assert.match(result.stdout, /Ctrl-C/);
  });
});
