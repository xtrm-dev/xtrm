import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JOURNAL_KINDS } from "../src/domain/journal.ts";
import { MCP_TOOL_DESCRIPTIONS, MCP_TOOL_NAMES } from "../integrations/claude-code/mcp-server.ts";

// Documentation anti-drift gate (ADR §§82-83, bead XTRM-252.11 / XTRM-263).
//
// Strategy: every inventory is derived from the runtime definition AT GATE
// RUN TIME — never a copied list that can go stale:
// - Journal kinds: imported JOURNAL_KINDS (src/domain/journal.ts).
// - CLI registrations: COMMAND_HELP keys parsed from cli/sb.ts source.
// - MCP tool names: TOOL_DEFS entries parsed from
//   integrations/claude-code/mcp-server.ts source (M1 registers through one
//   table, so per-call registerTool literals no longer exist).
// - MCP descriptions: the exported MCP_TOOL_DESCRIPTIONS inventory (M1).
// - Skill command references: `sb <group> [<verb>]` mentions parsed out of
//   the skill files, resolved against the CLI registrations above.
//
// One condition is genuinely PENDING (no definition exists yet):
// - closure-outcome enum (owner C1): no ClosureOutcome enum anywhere in
//   src/domain or src/service. The gate asserts the absence AND the
//   PENDING marker in the docs, so landing the enum fails the gate until
//   the docs go live — the anti-drift property.
// - MCP description inventory (owner M1, LANDED): tool names are checked
//   live against TOOL_DEFS, and the exported MCP_TOOL_DESCRIPTIONS inventory
//   carries the normative depth the gate asserts label by label.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");

function readDoc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, "packages", "substrate", rel), "utf8");
}

// --- Runtime inventories (parsed live, never copied) ------------------------

export function cliHelpKeys(): string[] {
  const src = readSrc("cli/sb.ts");
  const start = src.indexOf("const COMMAND_HELP");
  const end = src.indexOf("const HELP_COMMANDS");
  assert.ok(start >= 0 && end > start, "COMMAND_HELP block must exist in cli/sb.ts");
  const block = src.slice(start, end);
  const keys = new Set<string>();
  for (const m of block.matchAll(/^\s{2}(?:"([a-z.]+)"|([a-z]+)):/gm)) {
    keys.add(m[1] ?? m[2]!);
  }
  return [...keys].sort();
}

export function knownGroups(): Set<string> {
  const src = readSrc("cli/sb.ts");
  const m = src.match(/const KNOWN_GROUPS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "KNOWN_GROUPS must exist in cli/sb.ts");
  return new Set(m[1]!.match(/"([^"]+)"/g)!.map((s) => s.replace(/"/g, "")));
}

export function mcpToolNames(): string[] {
  const src = readSrc("integrations/tool-surface.ts");
  const start = src.indexOf("export const TOOL_NAMES = [");
  const end = src.indexOf("] as const;", start);
  assert.ok(start >= 0 && end > start, "TOOL_NAMES table must exist in tool-surface.ts");
  const names = [...src.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(names.length > 0, "TOOL_NAMES must register at least one tool");
  return names;
}

export function closureEnumPresent(): boolean {
  const dirs = ["src/domain", "src/service"].map((d) =>
    join(ROOT, "packages", "substrate", d),
  );
  const files: string[] = [];
  for (const d of dirs) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f.endsWith(".ts") && statSync(p).isFile()) files.push(p);
    }
  }
  assert.ok(files.length > 0, "src/domain + src/service must contain .ts files");
  return files.some((p) =>
    /\bClosureOutcome\b|enum\s+[A-Za-z]*[Cc]losure[A-Za-z]*/.test(readFileSync(p, "utf8")),
  );
}

// --- Doc-side extractors -----------------------------------------------------

const CLI_DOC = "docs/substrate/cli.md";
const JOURNAL_DOC = "docs/substrate/journal.md";
const PROV_DOC = "docs/substrate/provenance.md";
const REPO_DOC = "docs/substrate/repository-identity.md";
const WORKFLOW_DOC = "docs/substrate/workflow.md";
const SUB_README = "docs/substrate/README.md";

function cliKeyToDocForm(key: string): string {
  return key.replace(".", " ");
}

// Every `sb <group> [<verb>]` mention in a doc. `<...>` placeholders and
// `...` ellipses never match the verb class by construction.
export function sbMentions(text: string): Array<{ group: string; verb: string | null }> {
  const out: Array<{ group: string; verb: string | null }> = [];
  for (const m of text.matchAll(/\bsb ([a-z-]+)(?: ([a-z-]+))?/g)) {
    out.push({ group: m[1]!, verb: m[2] ?? null });
  }
  return out;
}

const TOP_LEVEL = new Set(["help", "version", "init", "doctor"]);

function unregisteredSbMentions(text: string): string[] {
  const keys = new Set(cliHelpKeys());
  const groups = knownGroups();
  const bad: string[] = [];
  for (const { group, verb } of sbMentions(text)) {
    if (group.startsWith("-")) continue; // flags (--help, --json), not commands
    if (TOP_LEVEL.has(group)) continue;
    if (!groups.has(group)) {
      bad.push(`unknown group: sb ${group}`);
      continue;
    }
    if (verb === null || verb.startsWith("-")) continue; // --help/--json flags, not verbs
    if (!keys.has(`${group}.${verb}`)) {
      bad.push(`unregistered: sb ${group} ${verb}`);
    }
  }
  return [...new Set(bad)];
}

// Section 68 checklist: topic -> case-insensitive marker that must appear
// in journal.md. The checklist itself is ADR text; the anti-drift half is
// the JOURNAL_KINDS assertion below it.
const SECTION_68: Array<[string, RegExp]> = [
  ["purpose", /## purpose/i],
  ["what Journal is not", /## what journal is not/i],
  ["all Journal kinds", /## all journal kinds/i],
  ["actor identity", /## actor identity/i],
  ["session lineage", /## session lineage/i],
  ["automatic metadata", /## automatic metadata/i],
  ["manual metadata", /## manual metadata/i],
  ["coordinator methodology", /## coordinator methodology/i],
  ["ordinary worker methodology", /## ordinary worker methodology/i],
  ["Specialist results", /## specialist results/i],
  ["review/validator results", /## review \/ validator results/i],
  ["checkpointing", /## checkpointing/i],
  ["compaction", /## compaction/i],
  ["handoff", /## handoff/i],
  ["root/child aggregation", /## root \/ child aggregation/i],
  ["external comments", /## external comments/i],
  ["notes vs findings", /## notes vs findings/i],
  ["decisions vs Issue revisions", /## decisions vs issue revisions/i],
  ["blockers", /## blockers/i],
  ["result size discipline", /## result size discipline/i],
  ["querying", /## querying/i],
  ["resume integration", /## resume integration/i],
  ["provenance links", /## provenance links/i],
  ["retention", /## retention/i],
  ["historical Beads notes", /## historical beads notes/i],
];

export function missingSection68(text: string): string[] {
  return SECTION_68.filter(([, re]) => !re.test(text)).map(([name]) => name);
}

function codeBlocks(text: string): string {
  return [...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]).join("\n");
}

export function kindsWithoutExample(text: string, kinds: readonly string[]): string[] {
  const code = codeBlocks(text);
  return kinds.filter(
    (k) =>
      !new RegExp(`### \\s*\\\`${k}\\\`|## .*${k}`, "i").test(text) ||
      !code.includes(k),
  );
}

// Active-workflow bd/bv verbs fail; history-marked lines pass (same
// allowlist shape as the skill-migration gate: retired/formerly/migration).
const BD_VERB = /(^|[^a-zA-Z])bd [a-z-]+|(^|[^a-zA-Z])bv [a-z-]+/;
const HISTORY = /retired|formerly|migration|historical/i;

function activeBdLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!BD_VERB.test(line)) return;
    const ctx = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
    if (HISTORY.test(ctx)) return;
    out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

function skillFiles(): string[] {
  const rels: string[] = [];
  const dirs = [
    "docs/substrate/skills",
    "packages/substrate/skills/using-substrate",
  ];
  for (const d of dirs) {
    const abs = join(ROOT, d);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const f of readdirSync(abs)) {
      if (f.endsWith(".md")) rels.push(`${d}/${f}`);
    }
  }
  return rels.sort();
}

// --- Gate: hierarchy exists --------------------------------------------------

describe("docs-drift-gate: hierarchy exists and is cross-linked", () => {
  it("all five operator pages exist alongside README", () => {
    for (const rel of [SUB_README, WORKFLOW_DOC, JOURNAL_DOC, PROV_DOC, REPO_DOC, CLI_DOC]) {
      assert.ok(existsSync(join(ROOT, rel)), `${rel} must exist (ADR §67)`);
    }
  });
  it("substrate README links the hierarchy and backlinks sbcloseout4", () => {
    const readme = readDoc(SUB_README);
    for (const rel of [WORKFLOW_DOC, JOURNAL_DOC, PROV_DOC, REPO_DOC, CLI_DOC]) {
      const base = rel.split("/").pop()!;
      assert.match(readme, new RegExp(base.replace(".", "\\.")), `README must link ${base}`);
    }
    assert.match(readme, /sbcloseout4-adr\.md/, "README must backlink sbcloseout4-adr.md");
  });
  it("sbcloseout3 is marked superseded by sbcloseout4", () => {
    const readme = readDoc(SUB_README);
    assert.match(readme, /sbcloseout3-adr\.md.*superseded.*sbcloseout4-adr\.md/si, "README must mark sbcloseout3 superseded by sbcloseout4");
  });
  it("root README points at the operator hierarchy", () => {
    const root = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(root, /docs\/substrate\/(README|workflow|cli)\.md/, "root README must cross-link the substrate operator docs");
  });
  it("PRD points at the operator hierarchy", () => {
    const prd = readDoc("docs/substrate/substrate-issues-v0-prd.md");
    assert.match(prd, /docs\/substrate\/(README|workflow|cli|journal)\.md|operator hierarchy|workflow\.md/, "PRD must point at the new operator hierarchy");
  });
});

// --- Gate: journal.md (§68) ---------------------------------------------------

describe("docs-drift-gate: journal.md covers ADR §68", () => {
  it("covers every checklist topic", () => {
    assert.deepEqual(missingSection68(readDoc(JOURNAL_DOC)), [], "§68 topics missing from journal.md");
  });
  it("includes an example of every Journal kind in JOURNAL_KINDS", () => {
    const kinds = [...JOURNAL_KINDS];
    assert.ok(kinds.length > 0, "JOURNAL_KINDS must be non-empty");
    assert.deepEqual(kindsWithoutExample(readDoc(JOURNAL_DOC), kinds), [], "every registered Journal kind needs a section plus a code example");
  });
});

// --- Gate: CLI docs ↔ registrations ------------------------------------------

describe("docs-drift-gate: cli.md matches CLI registrations", () => {
  it("every registered help topic is documented", () => {
    const cli = readDoc(CLI_DOC);
    const missing = cliHelpKeys()
      .filter((k) => k !== "top")
      .filter((k) => !cli.includes(cliKeyToDocForm(k)));
    assert.deepEqual(missing, [], "registered commands missing from cli.md");
  });
  it("every sb command taught in cli.md is registered", () => {
    assert.deepEqual(unregisteredSbMentions(readDoc(CLI_DOC)), [], "cli.md teaches unregistered commands");
  });
  it("cli.md documents sb init", () => {
    assert.match(readDoc(CLI_DOC), /sb init/, "cli.md must document sb init");
  });
});

// --- Gate: MCP tools ----------------------------------------------------------

describe("docs-drift-gate: MCP tools", () => {
  it("every registered MCP tool is named in the Claude integration doc", () => {
    const doc = readSrc("docs/claude.md");
    const missing = mcpToolNames().filter((t) => !doc.includes(t));
    assert.deepEqual(missing, [], "registered MCP tools missing from claude.md");
  });
  it("the exported inventory agrees with the shared tool surface", () => {
    assert.deepEqual([...MCP_TOOL_NAMES].sort(), [...mcpToolNames()].sort(), "exported MCP inventory must match TOOL_NAMES");
    assert.equal(MCP_TOOL_NAMES.length, 9, "XTRM-674 minimal surface");
    for (const name of MCP_TOOL_NAMES) {
      const description = MCP_TOOL_DESCRIPTIONS[name];
      assert.ok(typeof description === "string" && description.length >= 20, `${name} must carry a description`);
    }
  });
});

// --- Gate: closure outcomes (LANDED, owner C1) --------------------------------

describe("docs-drift-gate: closure outcomes", () => {
  it("the closure-outcome enum exists, and the docs describe the landed state (C1)", () => {
    assert.equal(closureEnumPresent(), true, "C1 landed: src/domain/closure.ts must carry the ClosureOutcome vocabulary");
    const prov = readDoc(PROV_DOC);
    assert.doesNotMatch(prov, /closure-outcome enum is PENDING/, "provenance.md must no longer record the closure-outcome enum as pending");
    assert.match(prov, /C1/, "provenance.md must name C1 as the owner of the landed closure-outcome enum");
  });
});

// --- Gate: provenance.md (§69) -------------------------------------------------

describe("docs-drift-gate: provenance.md covers ADR §69", () => {
  it("shows the forward graph with real commands", () => {
    const prov = readDoc(PROV_DOC);
    for (const marker of ["ExecutionBinding", "receipt", "closure", "sb provenance dispatch", "sb provenance trace"]) {
      assert.ok(prov.includes(marker), `provenance.md must show ${marker}`);
    }
  });
  it("shows reverse graphs", () => {
    const prov = readDoc(PROV_DOC);
    for (const marker of ["commit → receipt", "session → Issues touched", "closure → result/receipt", "sb provenance commit", "sb provenance receipt"]) {
      assert.ok(prov.includes(marker), `provenance.md must show reverse ${marker}`);
    }
  });
});

// --- Gate: repository-identity.md (§70) ----------------------------------------

describe("docs-drift-gate: repository-identity.md covers ADR §70", () => {
  it("explains every listed topic", () => {
    const text = readDoc(REPO_DOC).toLowerCase();
    for (const topic of [
      "one global",
      "many projects",
      "project per git repository",
      "sb init",
      "worktree",
      "clone",
      "normalization",
      "base branch",
      "no-remote",
      "override",
      "collision",
    ]) {
      assert.ok(text.includes(topic), `repository-identity.md must explain ${topic}`);
    }
  });
  it("keeps the normal path simple", () => {
    assert.match(readDoc(REPO_DOC), /sb init/, "normal path must be sb init");
  });
});

// --- Gate: skills (consume D2; D1 checks references only) -----------------------

describe("docs-drift-gate: skill command references resolve", () => {
  it("skill files reference only registered sb commands", () => {
    const files = skillFiles();
    assert.ok(files.length > 0, "skill files must exist to check");
    const bad: string[] = [];
    for (const rel of files) {
      for (const offense of unregisteredSbMentions(readDoc(rel))) {
        bad.push(`${rel}: ${offense}`);
      }
    }
    assert.deepEqual(bad, [], "skills teach unregistered sb commands");
  });
  it("no skill teaches an active retired bd/bv workflow verb", () => {
    const bad: string[] = [];
    for (const rel of skillFiles()) {
      for (const line of activeBdLines(readDoc(rel))) bad.push(`${rel}: ${line}`);
    }
    assert.deepEqual(bad, [], "retired bd/bv workflow verbs must stay retired");
  });
});

// --- Fail direction: matchers are not vacuous ----------------------------------

describe("docs-drift-gate matchers fail on regressed content", () => {
  it("§68 matcher fails when a topic section is stripped", () => {
    const text = readDoc(JOURNAL_DOC);
    assert.deepEqual(missingSection68(text), []);
    const mutated = text.replace(/## Checkpointing[\s\S]*?(?=## )/, "");
    assert.ok(missingSection68(mutated).length > 0, "stripped doc must fail the §68 matcher");
  });
  it("kind matcher fails when a kind example is stripped", () => {
    const text = readDoc(JOURNAL_DOC);
    assert.deepEqual(kindsWithoutExample(text, JOURNAL_KINDS), []);
    const mutated = text.replaceAll("blocker", "BLOCKER_REMOVED");
    assert.ok(kindsWithoutExample(mutated, JOURNAL_KINDS).includes("blocker"), "stripped kind must fail the kind matcher");
  });
  it("CLI reverse matcher fails on an unregistered verb", () => {
    assert.deepEqual(unregisteredSbMentions(readDoc(CLI_DOC)), []);
    assert.ok(
      unregisteredSbMentions("run `sb issue teleport <ref>` to finish faster").length > 0,
      "unregistered verb must fail the reverse matcher",
    );
  });
  it("CLI forward matcher fails when a registered command is undocumented", () => {
    const cli = readDoc(CLI_DOC);
    const mutated = cli.replaceAll("journal render", "JOURNAL_RENDER_REMOVED");
    const missing = cliHelpKeys()
      .filter((k) => k !== "top")
      .filter((k) => !mutated.includes(cliKeyToDocForm(k)));
    assert.ok(missing.includes("journal.render"), "undocumented command must fail the forward matcher");
  });
  it("skill matcher fails on an active bd verb but passes history", () => {
    assert.equal(activeBdLines("run bd show every morning\n").length, 1);
    assert.deepEqual(activeBdLines("formerly on Beads:\nbd prime\n"), []);
  });
  it("MCP inventory is derived from registrations, not a copy", () => {
    const names = mcpToolNames();
    assert.ok(names.includes("resume_capsule"), "resume_capsule must come from the registration scan");
    assert.ok(names.includes("provenance"), "provenance must come from the registration scan");
    assert.ok(names.includes("issue_claim"), "op-discriminated issue_claim must come from the registration scan");
    assert.ok(names.includes("journal_read"), "mode-discriminated journal_read must come from the registration scan");
    assert.deepEqual([...names].sort(), [...MCP_TOOL_NAMES].sort(), "scan and export must agree exactly");
    assert.equal(names.length, 9, "the full tool set must be found by the scan");
  });
});
