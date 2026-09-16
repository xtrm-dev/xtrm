// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readArgv, writeArgv } from "./substrate-cli.ts";

const q = (s: string) => new URLSearchParams(s);

describe("substrate CLI bridge reads", () => {
  it("maps supported reads to fixed argv", () => {
    expect(readArgv("/projects", q(""))).toEqual(["project", "list"]);
    expect(readArgv("/issues", q("project=prj_xtrm"))).toEqual(["issue", "list", "--project", "prj_xtrm"]);
    expect(readArgv("/export", q("project=prj_xtrm"))).toEqual(["export", "project", "--project", "prj_xtrm"]);
    expect(readArgv("/issue", q("ref=XTRM-94.2"))).toEqual(["issue", "show", "XTRM-94.2"]);
    expect(readArgv("/journal", q("ref=XTRM-1&limit=20"))).toEqual(["journal", "show", "XTRM-1", "--limit", "20"]);
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
