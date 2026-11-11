// Import and repair are migration paths: they move historical rows to a
// terminal state without delivery evidence, so both must carry a named
// exemption or an enforced gate blocks a legitimate backfill (XTRM-729).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./helpers.ts";
import { importBeads } from "../src/compatibility/beads/import.ts";

const RECORD = {
  id: "bd-gate-1",
  title: "legacy closed bead",
  status: "closed",
  issue_type: "task",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  closed_at: "2026-01-02T00:00:00Z",
  close_reason: "done upstream",
};

function world() {
  const ctx = setup();
  return ctx;
}

describe("migration exemptions", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
    process.env["XTRM_LINK_GATE"] = "enforce";
  });
  afterEach(() => {
    delete process.env["XTRM_LINK_GATE"];
    w.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  });

  it("import lands a closed bead under enforce without the gate", () => {
    const imported = importBeads(w.svc, "prj_xtrm", [RECORD], []);
    assert.equal(imported.created.length, 1);
    const issue = w.svc.listIssues("prj_xtrm")[0]!;
    assert.equal(issue.lifecycleState, "done");
  });

  it("repair --apply lands the closure under enforce", () => {
    // Import it open, then repair it closed: the repair must perform the
    // terminal transition (else this test would not reach the gate).
    const imported = importBeads(w.svc, "prj_xtrm", [{ ...RECORD, status: "open", closed_at: undefined, close_reason: undefined }], []);
    const issue = w.svc.listIssues("prj_xtrm")[0]!;
    const source = join(w.dir, "export.jsonl");
    writeFileSync(source, `${JSON.stringify(RECORD)}\n`);
    execFileSync(
      process.execPath,
      ["scripts/repair-beads-import.ts", "--db", join(w.dir, "state.db"), "--project", "prj_xtrm", "--source", source, "--apply", "--json"],
      { cwd: process.cwd(), env: { ...process.env, XTRM_LINK_GATE: "enforce" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const closure = w.db
      .prepare("SELECT COUNT(*) AS n FROM issue_closures WHERE issue_id = ?")
      .get(issue.id) as { n: number };
    assert.equal(closure.n, 1);
  });
});
