import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// G48: post-cutover agent instructions never state that Beads owns durable
// work. This sweep runs in CI over the migrated authority surfaces. It
// targets normative present-tense claims, not the words "bd"/"beads"
// themselves: compatibility notes, alias references, and frozen historical
// records (phase0 census, conformance notes) legitimately name Beads.
// Hook *mechanics* (.codex/hooks.json, .claude/settings.json, install
// scripts) stay bd-compat until an sb hook-protocol adapter lands — no new
// Substrate features in Phase 11 — so they are out of sweep scope by design
// (recorded in docs/substrate/phase12-pilot.md).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// substrate-light-prd.md is swept for its superseded marker only (REQUIRED
// below): the body is a frozen superseded draft, not post-cutover instruction.
const SWEPT = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/runtime/README.md",
  "docs/runtime/prd/native-chain-runtime.md",
  "docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md",
  "docs/specialists/PRD-Native-Specialists-Subagents-for-Pi-amendment-2026-09-08.md",
  ".agents/skills/beads/SKILL.md",
  "packages/substrate/skills/using-substrate/SKILL.md",
];

// Authority claims apply everywhere swept. Workflow-command patterns apply
// everywhere except the compat skill itself, which legitimately documents
// bd commands under its compatibility notice.
const AUTHORITY_CLAIMS: RegExp[] = [
  /beads?\s+owns\s+durable/i,
  /beads?\s+is\s+authoritative/i,
  /bead\s+is\s+authoritative\s+tracked\s+work/i,
  /the\s+bead\s+is\s+the\s+task/i,
  /use\s+`?bd`?\s+for\s+(all|durable)/i,
  /this\s+project\s+uses\s+\*\*`?bd/i,
  /issues\s+live\s+in\s+(a\s+local\s+)?dolt/i,
];

const WORKFLOW_COMMANDS: RegExp[] = [
  /run\s+`?bd\s+prime/i,
  /`?bd\s+(ready|show|update|close|remember|where)\b[^`]*#?\s*(find|view|claim|complete|refresh)/i,
  /bd\s+dolt\s+push/i,
];

const REQUIRED: Array<{ file: string; pattern: RegExp }> = [
  { file: "AGENTS.md", pattern: /substrate is authoritative for ownership/i },
  { file: "CLAUDE.md", pattern: /substrate is authoritative for ownership/i },
  { file: "docs/substrate/substrate-light-prd.md", pattern: /superseded/i },
  { file: "docs/runtime/README.md", pattern: /substrate issues \+ evidence/i },
  { file: "docs/runtime/prd/native-chain-runtime.md", pattern: /substrate issues are the authoritative/i },
  { file: "docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md", pattern: /substrate issue revision is the authoritative/i },
  { file: ".agents/skills/beads/SKILL.md", pattern: /compatibility only/i },
  { file: "packages/substrate/skills/using-substrate/SKILL.md", pattern: /substrate owns durable work/i },
];

describe("G48: no normative Beads-authority statement in cutover instructions", () => {
  for (const file of SWEPT) {
    it(file, () => {
      const text = readFileSync(join(ROOT, file), "utf8");
      const patterns = file.endsWith("beads/SKILL.md") ? AUTHORITY_CLAIMS : [...AUTHORITY_CLAIMS, ...WORKFLOW_COMMANDS];
      for (const pattern of patterns) {
        assert.ok(!pattern.test(text), `${file} still states Beads authority: ${pattern}`);
      }
    });
  }

  for (const { file, pattern } of REQUIRED) {
    it(`${file} declares the Substrate marker`, () => {
      const text = readFileSync(join(ROOT, file), "utf8");
      assert.ok(pattern.test(text), `${file} missing Substrate authority marker: ${pattern}`);
    });
  }
});
