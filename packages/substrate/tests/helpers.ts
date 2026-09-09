import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import type { WorkContract } from "../src/domain/contract.ts";

export function contract(overrides: Partial<WorkContract> = {}): WorkContract {
  return {
    problem: "P",
    success: "S",
    scope: ["a"],
    nonGoals: ["b"],
    constraints: ["c"],
    validation: [{ check: "v" }],
    output: [{ artifact: "o" }],
    ...overrides,
  };
}

export function setup() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-"));
  const db = openSubstrate(join(dir, "state.db"));
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  return { dir, db, svc };
}
