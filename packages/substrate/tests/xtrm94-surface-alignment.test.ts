import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runUxCli } from "../cli/sb-ux.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const repo = join(pkg, "..", "..");
const readPkg = (rel: string) => readFileSync(join(pkg, rel), "utf8");
const readRepo = (rel: string) => readFileSync(join(repo, rel), "utf8");

// Both providers register the shared tool surface (XTRM-674); the inventory is
// the TOOL_NAMES table, not a copy.
function sharedToolNames(): string[] {
  const src = readPkg("integrations/tool-surface.ts");
  const start = src.indexOf("export const TOOL_NAMES = [");
  const end = src.indexOf("] as const;", start);
  assert.ok(start >= 0 && end > start, "TOOL_NAMES inventory must remain parseable");
  return [...src.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

const piToolNames = (): string[] => sharedToolNames().map((n) => `substrate_${n}`);
const claudeToolNames = sharedToolNames;

describe("XTRM-94 provider-facing doctrine follows live registrations", () => {
  it("Pi skill names every registered Pi Substrate tool", () => {
    const skill = readPkg("skills/using-substrate/SKILL.md");
    const names = piToolNames();
    assert.equal(names.length, 9, "Pi tool count changed: update the skill/reference deliberately");
    // One skill (XTRM-679): it names the shared tools and the Pi prefix rule.
    for (const name of claudeToolNames()) assert.match(skill, new RegExp(`\\b${name}\\b`), `skill missing ${name}`);
    assert.match(skill, /prefixes each name with `substrate_`/);
    assert.ok(names.every((n) => n.startsWith("substrate_")));
    assert.match(skill, /SUBSTRATE_ISSUE_REF.*canonical/s);
    assert.match(skill, /SUBSTRATE_ISSUE.*compatibility alias/s);
  });

  it("Claude skill names every registered MCP tool and never teaches cardinality fallback", () => {
    const skill = readPkg("plugin/substrate/skills/using-substrate/SKILL.md");
    const names = claudeToolNames();
    assert.equal(names.length, 9, "Claude MCP inventory changed: update skill/reference deliberately");
    for (const name of names) assert.match(skill, new RegExp(`\\b${name}\\b`), `Claude skill missing ${name}`);
    assert.doesNotMatch(skill, /single-project default|only project|sole project/i);
    assert.match(skill, /fail closed.*sb init/is);
  });

  it("current provider surfaces contain no pre-closeout provenance promise", () => {
    for (const rel of [
      "integrations/pi/handlers.ts",
      "integrations/pi/extension.ts",
      "skills/using-substrate/SKILL.md",
      "plugin/substrate/skills/using-substrate/SKILL.md",
    ]) {
      const text = readPkg(rel);
      assert.doesNotMatch(text, /receipt-backed trace lands in Phase 8|before Phase 8 owns receipts/i, `${rel} is stale`);
    }
  });
});

describe("XTRM-94 help surfaces expose the human UX", () => {
  it("issue list help includes active-board filters and browser", async () => {
    const result = await runUxCli(["issue", "list", "--help"], { isTTY: false, env: { NO_COLOR: "1", HOME: "/empty" } });
    assert.equal(result.code, 0);
    for (const token of ["--status", "--all", "--flat", "--search", "sb issue browse"]) {
      assert.match(result.stdout, new RegExp(token.replace("--", "\\-\\-")), `help missing ${token}`);
    }
  });
});

describe("XTRM-94 documentation gate anchors", () => {
  it("package docs describe active-board UX and both providers", () => {
    const cli = readPkg("docs/cli.md");
    for (const token of ["active board", "--status", "--all", "--flat", "--search", "sb issue browse"]) {
      assert.match(cli, new RegExp(token.replace("--", "\\-\\-"), "i"), `package cli docs missing ${token}`);
    }
    assert.ok(readPkg("docs/pi.md").length > 200);
    assert.ok(readPkg("docs/claude.md").length > 200);
  });

  it("root README classifies every local package directory", () => {
    const root = readRepo("README.md");
    for (const name of ["arena-top", "board-audit", "mcpq", "service-knowledge", "service-knowledge-ext", "substrate", "xtprompt", "xtrm-app", "xtrm-tui", "xts"]) {
      assert.match(root, new RegExp(`packages/${name.replace("-", "\\-")}`), `root README missing packages/${name}`);
    }
    assert.doesNotMatch(root, /packages\/(core|channels|specialists)\b/, "sibling repositories must not be presented as local packages");
    assert.doesNotMatch(root, /will be grafted|fresh start, per-package history grafted/i);
  });
});
