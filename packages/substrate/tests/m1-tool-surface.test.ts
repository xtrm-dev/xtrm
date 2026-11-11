import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JOURNAL_KINDS } from "../src/domain/journal.ts";
import { runCli } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";
import {
  MCP_TOOL_DESCRIPTIONS,
  MCP_TOOL_NAMES,
} from "../integrations/claude-code/mcp-server.ts";

// M1 final surface (XTRM-252.10): the four VALIDATION clauses as executable
// tests. Every store opens on an explicit temp SUBSTRATE_DB path; help paths
// never open a store at all.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");

function readDoc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, "packages", "substrate", rel), "utf8");
}

// --- CLI registrations, parsed live from cli/sb.ts (same shape as the gate)
function cliHelpKeys(): string[] {
  const src = readSrc("cli/sb.ts");
  const start = src.indexOf("const COMMAND_HELP");
  const end = src.indexOf("const HELP_COMMANDS");
  assert.ok(start >= 0 && end > start);
  const keys = new Set<string>();
  for (const m of src.slice(start, end).matchAll(/^\s{2}(?:"([a-z.]+)"|([a-z]+)):/gm)) {
    keys.add(m[1] ?? m[2]!);
  }
  return [...keys].sort();
}

// --- Clause 1: inventory ----------------------------------------------------

const DESCRIPTION_LABELS = [
  "Changes:",
  "Does not change:",
  "Revision:",
  "Readiness:",
  "Use the Journal instead:",
  "Automatic context:",
];

describe("m1 inventory: help, descriptions, documented set", () => {
  it("every registered sb command is reachable through help", () => {
    for (const key of cliHelpKeys()) {
      if (key === "top") continue;
      const dbPath = join(tempDir("sb-m1-help-"), "never-created.db");
      const res = runCli(["help", ...key.split(".")], { dbPath });
      assert.equal(res.code, 0, `sb help ${key} failed: ${res.stderr}`);
      assert.match(res.stdout, /usage:/, `sb help ${key} printed no usage`);
    }
  });

  it("every registered MCP tool carries a non-trivial normative description", () => {
    assert.ok(MCP_TOOL_NAMES.length >= 13, "M1 final set must be present");
    assert.deepEqual([...new Set(MCP_TOOL_NAMES)], MCP_TOOL_NAMES, "tool names must be unique");
    for (const name of MCP_TOOL_NAMES) {
      const description = MCP_TOOL_DESCRIPTIONS[name];
      assert.ok(typeof description === "string" && description.length >= 200, `${name} needs a non-trivial description`);
      for (const label of DESCRIPTION_LABELS) {
        assert.ok(description.includes(label), `${name} description must state ${label}`);
      }
    }
  });

  it("the documented MCP inventory matches registration exactly", () => {
    const cli = readDoc("docs/substrate/cli.md");
    const section = cli.slice(cli.indexOf("## MCP tools"));
    const fence = section.match(/```text\n([\s\S]*?)```/);
    assert.ok(fence, "cli.md needs the MCP inventory code fence");
    const documented = fence[1]!.split(/\s+/).filter(Boolean).sort();
    assert.deepEqual(documented, [...MCP_TOOL_NAMES].sort(), "documented set must equal registration");
    for (const name of MCP_TOOL_NAMES) {
      assert.ok(cli.includes(name), `${name} must be named in the operator docs`);
    }
  });

  it("cli.md documents all nine journal kinds on journal append", () => {
    const cli = readDoc("docs/substrate/cli.md");
    for (const kind of JOURNAL_KINDS) {
      assert.ok(cli.includes(kind), `cli.md must document journal kind ${kind}`);
    }
    assert.ok(
      /journal append.*checkpoint\|handoff\|milestone\|decision\|finding\|blocker\|result\|compaction\|note/s.test(cli),
      "journal append line must list all nine kinds including result",
    );
  });
});

// --- Clause 2: description content -------------------------------------------

const JOURNAL_FACING = ["journal_append", "journal_checkpoint", "journal_show", "journal_query", "issue_note"];

describe("m1 description content: revision, readiness, journal-instead, automatic context", () => {
  it("each durable-work description covers the four semantic facets", () => {
    for (const name of MCP_TOOL_NAMES) {
      const lower = MCP_TOOL_DESCRIPTIONS[name]!.toLowerCase();
      assert.ok(lower.includes("revision"), `${name} must say whether the Issue revision changes`);
      assert.ok(lower.includes("readiness"), `${name} must say whether readiness goes stale`);
      assert.ok(lower.includes("journal"), `${name} must say when the Journal is used instead`);
      assert.ok(lower.includes("automatic"), `${name} must say what actor/session/provenance context is added automatically`);
    }
  });

  it("journal-facing descriptions explain all kinds for correct agent use", () => {
    for (const name of JOURNAL_FACING) {
      const lower = MCP_TOOL_DESCRIPTIONS[name]!.toLowerCase();
      for (const kind of JOURNAL_KINDS) {
        assert.ok(lower.includes(kind), `${name} must explain journal kind ${kind}`);
      }
    }
  });

  it("result methodology is explicit: bounded payload, never a plain note", () => {
    for (const name of ["journal_append", "journal_checkpoint", "issue_note", "issue_close"]) {
      const lower = MCP_TOOL_DESCRIPTIONS[name]!.toLowerCase();
      assert.ok(lower.includes("result"), `${name} must teach the result methodology`);
      assert.ok(
        lower.includes("never a plain note") || lower.includes("must not be used in place of a result"),
        `${name} must forbid substituting a note or contract edit for a result`,
      );
    }
  });
});

// --- Clause 3: docstring presence --------------------------------------------

const DOCSTRING_TARGETS: Array<{ file: string; anchor: string; label: string }> = [
  { file: "src/service/issue-service.ts", anchor: "export class IssueService {", label: "IssueService" },
  { file: "src/service/journal-service.ts", anchor: "export class JournalService {", label: "JournalService" },
  { file: "src/service/resume-service.ts", anchor: "export class ResumeService {", label: "ResumeService" },
  { file: "src/service/provenance-service.ts", anchor: "export class ProvenanceService {", label: "ProvenanceService" },
  { file: "src/service/closure-service.ts", anchor: "export class ClosureService {", label: "ClosureService" },
  { file: "src/workitems/store.ts", anchor: "export interface WorkItemStore {", label: "WorkItemStore" },
  { file: "src/service/repository-service.ts", anchor: "export class RepositoryService {", label: "RepositoryService" },
  { file: "src/domain/repository-discovery.ts", anchor: "export function discoverRepository(", label: "repository identity/discovery" },
  { file: "src/domain/execution-context.ts", anchor: "export function enrichExecutionContext(", label: "execution-context utilities" },
  { file: "src/workitems/dispatch-gate.ts", anchor: "export function checkDispatch(", label: "Specialist settlement gate" },
  { file: "src/workitems/dispatch-gate.ts", anchor: "export function dispatchToSpecialist(", label: "Specialist settlement dispatch" },
];

const DOCSTRING_FACETS = ["authority", "durab", "side effect", "revision", "readiness", "idempoten", "fail"];

function docblockBefore(src: string, anchor: string): string {
  const idx = src.indexOf(anchor);
  assert.ok(idx >= 0, `anchor missing: ${anchor}`);
  const open = src.lastIndexOf("/**", idx);
  assert.ok(open >= 0, `no docblock before ${anchor}`);
  const close = src.indexOf("*/", open);
  assert.ok(close > open && close < idx, `unterminated docblock before ${anchor}`);
  return src.slice(open, close).toLowerCase();
}

describe("m1 docstrings: named public durable-work APIs", () => {
  for (const target of DOCSTRING_TARGETS) {
    it(`${target.label} documents authority, durability, side effects, revision/readiness, metadata, idempotency, failure`, () => {
      const block = docblockBefore(readSrc(target.file), target.anchor);
      for (const facet of DOCSTRING_FACETS) {
        assert.ok(block.includes(facet), `${target.label} docstring must cover ${facet}`);
      }
    });
  }
});

// --- Clause 4: inlineCreate project-hint parity and refusal -------------------

function setupDb(): { dir: string; dbPath: string } {
  const dir = tempDir("sb-m1-create-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_demo", prefix: "DEMO", name: "inline" });
  db.close();
  return { dir, dbPath };
}

function createArgs(dbPath: string, contractArg: string, extra: string[] = []): string[] {
  return ["--db", dbPath, "--json", "issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", contractArg, "--scrutiny", "LOW", ...extra];
}

describe("m1 inlineCreate: inline JSON parity and refusal", () => {
  it("inline JSON and file JSON create the same contract", () => {
    const { dir, dbPath } = setupDb();
    const payload = JSON.stringify(contract({ problem: "P-inline", success: "S-inline" }));
    const file = join(dir, "c.json");
    writeFileSync(file, payload);
    const fromInline = JSON.parse(runCli(createArgs(dbPath, payload), { dbPath }).stdout) as { ok: boolean; data: { humanRef: string } };
    const fromFile = JSON.parse(runCli(createArgs(dbPath, file), { dbPath }).stdout) as { ok: boolean; data: { humanRef: string } };
    assert.equal(fromInline.ok, true);
    assert.equal(fromFile.ok, true);
    const show = (humanRef: string) =>
      JSON.parse(runCli(["--db", dbPath, "--json", "issue", "show", humanRef], { dbPath }).stdout) as {
        ok: boolean; data: { contract: unknown; contractHash: string };
      };
    const a = show(fromInline.data.humanRef);
    const b = show(fromFile.data.humanRef);
    assert.deepEqual(a.data.contract, b.data.contract);
    assert.equal(a.data.contractHash, b.data.contractHash);
  });

  it("malformed inline JSON is refused without creating an issue", () => {
    const { dbPath } = setupDb();
    const before = (JSON.parse(runCli(["--db", dbPath, "--json", "issue", "list", "--project", "prj_demo"], { dbPath }).stdout) as { data: unknown[] }).data.length;
    const res = runCli(createArgs(dbPath, "{not-json"), { dbPath });
    assert.notEqual(res.code, 0, "malformed inline contract must fail");
    const after = (JSON.parse(runCli(["--db", dbPath, "--json", "issue", "list", "--project", "prj_demo"], { dbPath }).stdout) as { data: unknown[] }).data.length;
    assert.equal(after, before, "refused create must not store an issue");
  });

  it("a wrong project hint is refused without creating an issue", () => {
    const { dbPath } = setupDb();
    const payload = JSON.stringify(contract());
    const res = runCli(
      ["--db", dbPath, "--json", "issue", "create", "--project", "prj_nope", "--title", "T", "--kind", "task", "--contract", payload],
      { dbPath },
    );
    assert.notEqual(res.code, 0, "unknown project hint must fail closed");
    const listed = (JSON.parse(runCli(["--db", dbPath, "--json", "issue", "list", "--project", "prj_demo"], { dbPath }).stdout) as { data: unknown[] }).data;
    assert.equal(listed.length, 0, "refused create must not store an issue");
  });
});
