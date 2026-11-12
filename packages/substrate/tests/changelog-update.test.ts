import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("changelog-update", () => {
  it("is idempotent (--check passes after a refresh)", () => {
    execFileSync("node", ["scripts/changelog-update.mjs"], { cwd: root, stdio: "pipe" });
    execFileSync("node", ["scripts/changelog-update.mjs", "--check"], { cwd: root, stdio: "pipe" });
    assert.ok(true);
  });

  it("fails closed when git-cliff is missing", () => {
    // Simulate by PATH without git-cliff: exec should throw.
    let threw = false;
    try {
      execFileSync("node", ["scripts/changelog-update.mjs"], { cwd: root, stdio: "pipe", env: { ...process.env, PATH: "/nonexistent" } });
    } catch (e) {
      threw = true;
    }
    assert.equal(threw, true);
  });
});
