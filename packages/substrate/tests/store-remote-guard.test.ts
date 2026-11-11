// The stale local store must not be opened silently when a remote is configured
// (XTRM-693, ADR-008). On this PC that store holds a single unrelated project
// binding, so a consumer reading it answers confidently about the wrong data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";
import { CANONICAL_STORE_PATH, assertStoreIsChosen, openSubstrate } from "../src/store/sqlite.ts";

function withConfig(remote: string | null): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = tempDir("store-guard-");
  const configPath = join(dir, "substrate.json");
  if (remote !== null) {
    writeFileSync(configPath, JSON.stringify({ remote, remoteSb: "/usr/local/bin/sb", checkouts: {} }));
  }
  return { env: { SUBSTRATE_REMOTE_CONFIG: configPath }, dir };
}

describe("the canonical store when a remote is configured", () => {
  it("is refused, and the refusal names the remote and the path", () => {
    const { env, dir } = withConfig("ssh:server");
    try {
      assert.throws(
        () => assertStoreIsChosen(CANONICAL_STORE_PATH, env),
        (error: unknown) => {
          const e = error as Error & { code?: string };
          assert.equal(e.code, "remote_store_selected");
          assert.match(e.message, /ssh:server/);
          assert.match(e.message, new RegExp(CANONICAL_STORE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          assert.doesNotMatch(e.message, /sb init/, "the old message pointed at the wrong store");
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses through openSubstrate too, before touching the file", () => {
    const { env, dir } = withConfig("ssh:server");
    const previous = process.env["SUBSTRATE_REMOTE_CONFIG"];
    process.env["SUBSTRATE_REMOTE_CONFIG"] = env["SUBSTRATE_REMOTE_CONFIG"];
    try {
      assert.throws(() => openSubstrate(CANONICAL_STORE_PATH), /remote_store_selected|tried to open the local store/);
    } finally {
      if (previous === undefined) delete process.env["SUBSTRATE_REMOTE_CONFIG"];
      else process.env["SUBSTRATE_REMOTE_CONFIG"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours an explicit local file, because that is a deliberate choice", () => {
    const { env, dir } = withConfig("ssh:server");
    try {
      assertStoreIsChosen(join(dir, "explicit.db"), env);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes nothing when no remote is configured", () => {
    const { env, dir } = withConfig(null);
    try {
      assertStoreIsChosen(CANONICAL_STORE_PATH, env);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
