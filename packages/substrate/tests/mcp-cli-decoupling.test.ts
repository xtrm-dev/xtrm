import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Boundary XTRM-337: repository discovery lives in the shared domain module.
// The MCP server must not import the CLI module (no MCP->CLI dependency) and
// the CLI must not import the MCP server (no CLI<->MCP dependency either way);
// both import discoverGitRoot/discoverRepository from
// src/domain/repository-discovery.ts, re-exported from src/index.ts.

const ROOT = join(import.meta.dirname, "..");
const mcpSource = readFileSync(join(ROOT, "integrations", "claude-code", "mcp-server.ts"), "utf8");
const cliSource = readFileSync(join(ROOT, "cli", "sb.ts"), "utf8");
const indexSource = readFileSync(join(ROOT, "src", "index.ts"), "utf8");

describe("MCP/CLI decoupling (XTRM-337)", () => {
  it("mcp-server.ts does not import the CLI module", () => {
    assert.ok(!mcpSource.includes("cli/sb"), "mcp-server.ts must not reference cli/sb.ts");
    assert.ok(
      !mcpSource.includes('from "../../cli') && !mcpSource.includes('from "../cli'),
      "mcp-server.ts must not import from the cli directory",
    );
  });

  it("mcp-server.ts imports discovery from the shared domain module", () => {
    assert.ok(
      mcpSource.includes('from "../../src/domain/repository-discovery.ts"'),
      "mcp-server.ts must import discoverRepository from src/domain/repository-discovery.ts",
    );
  });

  it("cli/sb.ts does not import the MCP server", () => {
    assert.ok(!cliSource.includes("mcp-server"), "cli/sb.ts must not reference mcp-server.ts");
    assert.ok(
      !cliSource.includes("integrations/claude-code"),
      "cli/sb.ts must not import from integrations/claude-code",
    );
  });

  it("cli/sb.ts imports discovery from the shared domain module", () => {
    assert.ok(
      cliSource.includes('from "../src/domain/repository-discovery.ts"'),
      "cli/sb.ts must import discovery from src/domain/repository-discovery.ts",
    );
  });

  it("src/index.ts exports the shared discovery module", () => {
    assert.ok(
      indexSource.includes('"./domain/repository-discovery.ts"'),
      "src/index.ts must export ./domain/repository-discovery.ts",
    );
  });
});
