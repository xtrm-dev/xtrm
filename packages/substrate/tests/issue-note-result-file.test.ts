// XTRM-835: `issue note --kind result --file` stored the file text verbatim as
// `result.summary`, so a caller who wrote the structured envelope to a file got escaped
// JSON in the summary and a brace-and-quote blob in human `journal show`. The envelope is
// now stored as structure; everything else stays prose.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

function seed(): { dir: string; dbPath: string } {
  const dir = tempDir("sb-note-");
  const dbPath = join(dir, "state.db");
  const store = openSubstrate(dbPath);
  new IssueService(store).createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  store.close();
  return { dir, dbPath };
}

function cliFactory(dbPath: string) {
  return (argv: string[], expectZero = true): unknown => {
    const res = runCli(["--db", dbPath, "--json", ...argv]);
    if (expectZero) assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
    return (JSON.parse(res.stdout) as { data: unknown }).data;
  };
}

function createIssue(cli: ReturnType<typeof cliFactory>, dir: string): string {
  const contractPath = join(dir, "c.json");
  writeFileSync(contractPath, JSON.stringify(contract()));
  const created = cli([
    "issue", "create", "--project", "prj_xtrm", "--title", "K", "--kind", "task",
    "--contract", contractPath, "--scrutiny", "LOW",
  ]) as { humanRef: string };
  return created.humanRef;
}

function noteFromFile(cli: ReturnType<typeof cliFactory>, dir: string, ref: string, body: string): { summary: string; validation?: string[] } {
  const path = join(dir, "result.json");
  writeFileSync(path, body);
  cli(["issue", "note", ref, "--kind", "result", "--file", path, "--project", "prj_xtrm"]);
  const shown = cli(["journal", "show", ref]) as Array<{ kind: string; result: { summary: string; validation?: string[] } | null }>;
  const row = shown.filter((e) => e.kind === "result").at(-1);
  assert.ok(row?.result, "the entry carries a result payload");
  return row.result;
}

describe("issue note --kind result --file (XTRM-835)", () => {
  it("stores a structured envelope as fields, not as escaped JSON in the summary", () => {
    const { dir, dbPath } = seed();
    try {
      const cli = cliFactory(dbPath);
      const ref = createIssue(cli, dir);
      const envelope = {
        summary: "bridge verified against the clone",
        outcome: "completed",
        validation: ["65 vitest cases pass", "tsc clean"],
        findings: ["the clone ran an older CLI"],
      };
      const result = noteFromFile(cli, dir, ref, JSON.stringify(envelope, null, 2));
      assert.equal(result.summary, "bridge verified against the clone", "the summary is the envelope's summary, not the file text");
      assert.deepEqual(result.validation, ["65 vitest cases pass", "tsc clean"]);
      assert.doesNotMatch(JSON.stringify(result), /\\"summary\\"/, "no escaped JSON survives in the payload");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps prose as the summary, including prose that starts with a brace", () => {
    const { dir, dbPath } = seed();
    try {
      const cli = cliFactory(dbPath);
      const ref = createIssue(cli, dir);
      assert.equal(noteFromFile(cli, dir, ref, "specialist finished").summary, "specialist finished");
      const braceProse = "{not json, just a note";
      assert.equal(noteFromFile(cli, dir, ref, braceProse).summary, braceProse);
      const jsonWithoutSummary = '{"attempted":"something"}';
      assert.equal(noteFromFile(cli, dir, ref, jsonWithoutSummary).summary, jsonWithoutSummary, "no summary key means it is not an envelope");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says when it read the text as an envelope, and renders prose in human show", () => {
    const { dir, dbPath } = seed();
    try {
      const cli = cliFactory(dbPath);
      const ref = createIssue(cli, dir);
      const path = join(dir, "result.json");
      writeFileSync(path, JSON.stringify({ summary: "envelope read", outcome: "completed" }));
      const res = runCli(["--db", dbPath, "issue", "note", ref, "--kind", "result", "--file", path, "--project", "prj_xtrm"]);
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stderr, /stored the result envelope as structured fields/);
      const human = runCli(["--db", dbPath, "journal", "show", ref]);
      assert.equal(human.code, 0, human.stderr);
      assert.match(human.stdout, /result: envelope read \(completed\)/);
      assert.doesNotMatch(human.stdout, /\\"summary\\"/, "human show never prints escaped JSON for an envelope note");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
