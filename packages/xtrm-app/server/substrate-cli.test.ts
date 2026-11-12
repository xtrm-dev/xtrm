// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { downgradeNotice, interpretJournalProbe, readArgv, resolveSbBin, shadowedBinHint, writeArgv } from "./substrate-cli.ts";

const q = (s: string) => new URLSearchParams(s);

describe("sb binary resolution", () => {
  it("finds sb on PATH, falls back to the running node's bin dir, else keeps the bare name", () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-bin-"));
    const name = "sb-resolve-fixture";
    const file = join(dir, name);
    writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
    const path = process.env.PATH;
    try {
      process.env.PATH = dir;
      expect(resolveSbBin(name)).toBe(file);
      expect(resolveSbBin("/opt/custom/sb")).toBe("/opt/custom/sb");
      // Not on PATH: the node running this test is itself findable that way.
      process.env.PATH = "";
      expect(resolveSbBin(basename(process.execPath))).toBe(process.execPath);
      expect(resolveSbBin(name)).toBe(name);
    } finally {
      process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sb binary diagnostics", () => {
  it("flags an npm-prepended node_modules/.bin as the shadowing case", () => {
    expect(shadowedBinHint("/home/u/dev/node_modules/.bin/sb")).toMatch(/shadowed/);
    expect(shadowedBinHint("C:\\dev\\node_modules\\.bin\\sb")).toMatch(/shadowed/);
    expect(shadowedBinHint("/home/u/.nvm/versions/node/v25/bin/sb")).toBeNull();
  });

  it("names the binary and version when journal paging downgrades", () => {
    expect(downgradeNotice("/old/node_modules/.bin/sb", "0.2.2")).toContain("/old/node_modules/.bin/sb (sb 0.2.2)");
    expect(downgradeNotice("sb", null)).toContain("(sb unknown)");
    expect(downgradeNotice("sb", "0.2.2")).toContain("XTRM_SB_BIN");
  });
});

describe("substrate CLI bridge reads", () => {
  it("maps supported reads to fixed argv", () => {
    expect(readArgv("/projects", q(""))).toEqual(["project", "list"]);
    expect(readArgv("/issues", q("project=prj_xtrm"))).toEqual(["issue", "list", "--project", "prj_xtrm"]);
    expect(readArgv("/query", q("project=prj_xtrm"))).toEqual(["issue", "query", "--project", "prj_xtrm", "--limit", "500"]);
    expect(readArgv("/query", q("project=prj_xtrm&limit=200&cursor=abc123"))).toEqual(["issue", "query", "--project", "prj_xtrm", "--limit", "200", "--cursor", "abc123"]);
    expect(readArgv("/issue", q("ref=XTRM-94.2"))).toEqual(["issue", "show", "XTRM-94.2"]);
    expect(readArgv("/journal", q("ref=XTRM-1&limit=20"))).toEqual(["journal", "show", "XTRM-1", "--limit", "20"]);
    expect(readArgv("/journal", q("ref=XTRM-1&tail=200"))).toEqual(["journal", "show", "XTRM-1", "--tail", "200"]);
    expect(readArgv("/journal", q("ref=XTRM-1&before=900&limit=200"))).toEqual(["journal", "show", "XTRM-1", "--before", "900", "--limit", "200"]);
  });

  it("downgrades only on an unknown-flag failure, never on another error", () => {
    const envelope = (ok: boolean, extra: string) => `{"schema":"substrate-cli/v1","command":"journal.show","ok":${ok}${extra}}`;
    expect(interpretJournalProbe(envelope(false, ',"error":"unknown flag --tail for `journal.show` (see usage)"'))).toBe(false);
    // The flag was accepted; the run failed later for another reason.
    expect(interpretJournalProbe(envelope(false, ',"error":"unresolvable ref: XTRM-9"'))).toBe(true);
    expect(interpretJournalProbe(envelope(true, ',"data":[]'))).toBe(true);
    // The binary never ran, so the probe proves nothing and must not be cached.
    expect(interpretJournalProbe('{"ok":false,"error":"sb failed (bin=/missing/sb): spawn ENOENT"}')).toBeNull();
    expect(interpretJournalProbe("not json at all")).toBeNull();
  });

  it("bounds the paged journal read and keeps the per-page ceiling", () => {
    expect(readArgv("/journal", q("ref=XTRM-1&tail=0"))).toBeNull();
    expect(readArgv("/journal", q("ref=XTRM-1&tail=abc"))).toBeNull();
    expect(readArgv("/journal", q("ref=XTRM-1&tail=2001"))).toBeNull();
    expect(readArgv("/journal", q("ref=XTRM-1&before=0&limit=100"))).toBeNull();
    expect(readArgv("/journal", q("ref=XTRM-1&before=abc&limit=100"))).toBeNull();
    expect(readArgv("/journal", q("ref=XTRM-1&before=900&limit=2001"))).toBeNull();
    expect(readArgv("/journal", q("before=900&limit=100"))).toBeNull();
  });

  it("refuses an out-of-range limit and a malformed cursor on /query", () => {
    expect(readArgv("/query", q("project=prj_xtrm&limit=0"))).toBeNull();
    expect(readArgv("/query", q("project=prj_xtrm&limit=501"))).toBeNull();
    expect(readArgv("/query", q("project=prj_xtrm&limit=abc"))).toBeNull();
    expect(readArgv("/query", q("project=prj_xtrm&cursor=--help"))).toBeNull();
    expect(readArgv("/query", q("project=prj_x --all"))).toBeNull();
    expect(readArgv("/query", q(""))).toBeNull();
  });

  it("rejects unknown paths and injection-shaped input", () => {
    expect(readArgv("/close", q("ref=XTRM-1"))).toBeNull();
    expect(readArgv("/issues", q("project=prj_x --all"))).toBeNull();
    expect(readArgv("/issue", q("ref=--help"))).toBeNull();
    expect(readArgv("/journal", q("ref=XTRM-1&limit=99999"))).toBeNull();
  });
});

describe("substrate CLI bridge writes", () => {
  const base = { project: "prj_xtrm", ref: "XTRM-12" };

  it("builds an edit with optimistic concurrency", () => {
    expect(writeArgv("/edit", { ...base, expectedRevision: 3, title: "New title", priority: 1 })).toEqual([
      "issue", "edit", "XTRM-12", "--project", "prj_xtrm", "--expected-revision", "3", "--title", "New title", "--priority", "1",
    ]);
    const contract = { problem: "p", success: "s", scope: [], nonGoals: [], constraints: [], validation: [], output: [] };
    expect(writeArgv("/edit", { ...base, expectedRevision: 1, contract })?.slice(-2)).toEqual(["--contract", JSON.stringify(contract)]);
  });

  it("refuses edits without a revision, a project, or any change", () => {
    expect(writeArgv("/edit", { ...base, title: "x" })).toBeNull();
    expect(writeArgv("/edit", { ref: "XTRM-12", expectedRevision: 1, title: "x" })).toBeNull();
    expect(writeArgv("/edit", { ...base, expectedRevision: 1 })).toBeNull();
    expect(writeArgv("/edit", { ...base, expectedRevision: 1, priority: 9 })).toBeNull();
    expect(writeArgv("/edit", { ...base, expectedRevision: 1, scrutiny: "EXTREME" })).toBeNull();
  });

  it("does not let values turn into flags", () => {
    expect(writeArgv("/edit", { ...base, expectedRevision: 1, title: "--db=/tmp/x" })).toBeNull();
    expect(writeArgv("/note", { ...base, text: "--help" })).toBeNull();
  });

  it("validates lifecycle states and note kinds", () => {
    expect(writeArgv("/state", { ...base, state: "deferred" })).toEqual(["issue", "state", "XTRM-12", "deferred", "--project", "prj_xtrm"]);
    expect(writeArgv("/state", { ...base, state: "in_progress" })).toBeNull();
    expect(writeArgv("/note", { ...base, text: "hello", kind: "weird" })).toEqual(["issue", "note", "XTRM-12", "hello", "--kind", "note", "--project", "prj_xtrm"]);
  });
});
