// @vitest-environment node
import { describe, expect, it } from "vitest";
import { argvFor } from "./substrate-cli.ts";

const q = (s: string) => new URLSearchParams(s);

describe("substrate CLI bridge allow-list", () => {
  it("maps supported reads to fixed read-only argv", () => {
    expect(argvFor("/projects", q(""))).toEqual(["project", "list", "--json"]);
    expect(argvFor("/issues", q("project=prj_xtrm"))).toEqual(["issue", "list", "--project", "prj_xtrm", "--json"]);
    expect(argvFor("/issue", q("ref=XTRM-94.2"))).toEqual(["issue", "show", "XTRM-94.2", "--json"]);
  });

  it("rejects unknown paths and injection-shaped input", () => {
    expect(argvFor("/close", q("ref=XTRM-1"))).toBeNull();
    expect(argvFor("/issues", q("project=prj_x --all"))).toBeNull();
    expect(argvFor("/issue", q("ref=--help"))).toBeNull();
    expect(argvFor("/issue", q("ref=XTRM-1;rm"))).toBeNull();
  });
});
