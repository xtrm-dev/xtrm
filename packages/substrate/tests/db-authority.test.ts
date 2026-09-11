import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CANONICAL_DB_PATH, resolveDbPath } from "../integrations/claude-code/runtime.ts";

// Acceptance xtrm-iip.2 (closeout E2): one state.db authority. Hermetic by
// construction — resolveDbPath never opens a database, so the operator's
// real ~/.xtrm/state.db is untouched. Live same-DB proof is E5 acceptance.

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prior = process.env[key];
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    fn();
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

describe("one state.db authority (xtrm-iip.2)", () => {
  it("default resolution without overrides yields the canonical path", () => {
    withEnv("SUBSTRATE_DB", undefined, () => {
      assert.equal(resolveDbPath(), join(homedir(), ".xtrm", "state.db"));
      assert.equal(resolveDbPath(), CANONICAL_DB_PATH);
    });
  });

  it("explicit override beats env beats default", () => {
    withEnv("SUBSTRATE_DB", "/tmp/env-override.db", () => {
      assert.equal(resolveDbPath(), "/tmp/env-override.db");
      assert.equal(resolveDbPath("/tmp/explicit.db"), "/tmp/explicit.db");
    });
  });

  it("exactly one plugin manifest is named substrate (§7, xtrm-6qu.6)", () => {
    assert.equal(existsSync(new URL("../integrations/claude-code/plugin.json", import.meta.url)), false, "legacy integrations manifest retired; plugin/substrate is canonical");
    const manifest = JSON.parse(readFileSync(new URL("../plugin/substrate/.claude-plugin/plugin.json", import.meta.url), "utf8")) as { name?: string };
    assert.equal(manifest.name, "substrate");
  });

  it("the packaged plugin ships no repo-local database default", () => {
    const mcp = JSON.parse(readFileSync(new URL("../plugin/substrate/.mcp.json", import.meta.url), "utf8")) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    for (const [name, server] of Object.entries(mcp.mcpServers ?? {})) {
      assert.equal(server.env?.["SUBSTRATE_DB"], undefined, `${name} must not default SUBSTRATE_DB to a repo-local DB`);
    }
  });
});
