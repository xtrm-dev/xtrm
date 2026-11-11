import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";
import { openSubstrate } from "../src/store/sqlite.ts";

const mode = (path: string): number => statSync(path).mode & 0o777;

describe("openSubstrate store permissions (CORE-2381)", () => {
  const roots: string[] = [];
  const freshRoot = (): string => {
    const root = tempDir("sb-perm-");
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // regression: CORE-2381
  it("creates a missing parent directory as 0700 and the DB as 0600", () => {
    const stateDir = join(freshRoot(), ".xtrm");
    const dbPath = join(stateDir, "state.db");
    openSubstrate(dbPath).close();
    assert.equal(mode(stateDir), 0o700);
    assert.equal(mode(dbPath), 0o600);
  });

  it("leaves the modes of an existing directory and DB unchanged", () => {
    const stateDir = freshRoot();
    const dbPath = join(stateDir, "state.db");
    writeFileSync(dbPath, "");
    chmodSync(stateDir, 0o750);
    chmodSync(dbPath, 0o640);
    openSubstrate(dbPath).close();
    assert.equal(mode(stateDir), 0o750);
    assert.equal(mode(dbPath), 0o640);
  });
});
