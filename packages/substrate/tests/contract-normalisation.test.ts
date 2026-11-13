// XTRM-786: a prose entry where {check}/{artifact} belongs is a slight shape
// error, not a reason to lose the contract. Create/edit repair it, store the
// normalised contract and report what they repaired in one line; an entry that
// cannot be repaired unambiguously is refused with the field, the entry and the
// expected shape named. Readiness keeps its own verdict for contracts stored
// before this change — the schema and the readiness rules are unchanged.
//
// Scope: the domain normaliser, the CLI create/edit path (the service writes the
// normalised contract for every caller: CLI, MCP, Pi, Beads import) and the
// human notice. The stored-contract and readiness assertions run over a real
// SQLite store, so "stored" means stored.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli } from "../cli/sb.ts";
import {
  isStructurallyValid,
  normaliseContract,
  validateContractStructure,
  type WorkContract,
} from "../src/domain/contract.ts";
import { feedbackForCommand } from "../src/presentation/terminal.ts";
import { tempDir } from "./helpers.ts";

const ENV_KEYS = ["SUBSTRATE_DB", "SUBSTRATE_LOCAL_DB", "SUBSTRATE_PROJECT", "SUBSTRATE_ISSUE_REF", "SUBSTRATE_ISSUE", "SUBSTRATE_HOLDER", "SUBSTRATE_REMOTE", "SUBSTRATE_REMOTE_CONFIG"];

const prose = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  problem: "p",
  success: "s",
  scope: ["a"],
  nonGoals: ["b"],
  constraints: ["c"],
  validation: ["run the tests"],
  output: ["a merged PR"],
  ...overrides,
});

describe("XTRM-786 contract normalisation on create/edit", () => {
  let dir = "";
  let dbPath = "";
  let prior: Record<string, string | undefined> = {};

  beforeEach(() => {
    prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    dir = tempDir("substrate-normalise-");
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    try {
      new IssueService(db).createProject({ id: "prj_norm", prefix: "NORM", name: "normalise" });
    } finally {
      db.close();
    }
    process.env["SUBSTRATE_PROJECT"] = "prj_norm";
    process.env["SUBSTRATE_HOLDER"] = "normalise-probe";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const cli = (argv: string[]) => runCli(["--db", dbPath, ...argv]);
  const json = (argv: string[]): { ok: boolean; data: Record<string, unknown>; error?: string } =>
    JSON.parse(cli(["--json", ...argv]).stdout) as { ok: boolean; data: Record<string, unknown>; error?: string };

  const create = (contract: unknown, extra: string[] = []) =>
    cli([
      "issue",
      "create",
      "--kind",
      "task",
      "--scrutiny",
      "MEDIUM",
      "--title",
      "normalise probe",
      "--contract",
      JSON.stringify(contract),
      ...extra,
    ]);

  function storedContract(ref: string): WorkContract {
    const payload = json(["issue", "show", ref]);
    assert.equal(payload.ok, true);
    return payload.data["contract"] as WorkContract;
  }

  it("repairs a prose validation entry on create and stores {check}", () => {
    const r = create(prose({ validation: ["run the tests", "a second check"] }));
    assert.equal(r.code, 0, r.stderr);
    const stored = storedContract("NORM-1");
    assert.deepEqual(stored.validation, [{ check: "run the tests" }, { check: "a second check" }]);
    assert.deepEqual(stored.output, [{ artifact: "a merged PR" }]);
  });

  it("repairs a prose output entry on create and stores {artifact}", () => {
    const r = create(prose({ output: ["a merged PR", "help text"] }));
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(storedContract("NORM-1").output, [{ artifact: "a merged PR" }, { artifact: "help text" }]);
  });

  it("keeps well-shaped entries byte-identical, extra keys included, in a mixed array", () => {
    const r = create(
      prose({
        validation: [{ check: "fine", note: "keep me" }, "prose check"],
        output: [{ artifact: "o", extra: 1 }],
      }),
    );
    assert.equal(r.code, 0, r.stderr);
    const stored = storedContract("NORM-1");
    assert.deepEqual(stored.validation, [{ check: "fine", note: "keep me" }, { check: "prose check" }]);
    assert.deepEqual(stored.output, [{ artifact: "o", extra: 1 }]);
  });

  it("reports the repair in one line, naming each field and its count", () => {
    const payload = (() => {
      const res = cli([
        "--json",
        "issue",
        "create",
        "--kind",
        "task",
        "--scrutiny",
        "MEDIUM",
        "--title",
        "notice probe",
        "--contract",
        JSON.stringify(prose({ validation: ["one", "two"], output: ["art"] })),
      ]);
      return JSON.parse(res.stdout) as { ok: boolean; data: Record<string, unknown> };
    })();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data["contractNormalised"], [
      { field: "validation", key: "check", count: 2 },
      { field: "output", key: "artifact", count: 1 },
    ]);
    // The human surface renders exactly that as the detail line of the one
    // success message, not as an extra warning block.
    const feedback = feedbackForCommand("issue.create", ["issue", "create", "NORM-1"], {
      humanRef: "NORM-1",
      contractNormalised: payload.data["contractNormalised"],
    });
    assert.equal(feedback.level, "success");
    assert.match(feedback.detail ?? "", /validation: 2 entries normalised to \{check\}/);
    assert.match(feedback.detail ?? "", /output: 1 entry normalised to \{artifact\}/);
  });

  it("says nothing when nothing was repaired", () => {
    const payload = json(["issue", "create", "--kind", "task", "--scrutiny", "MEDIUM", "--title", "clean", "--contract", JSON.stringify(prose({ validation: [{ check: "v" }], output: [{ artifact: "o" }] }))]);
    assert.equal(payload.ok, true);
    assert.equal(payload.data["contractNormalised"], undefined);
    assert.equal(feedbackForCommand("issue.create", [], { humanRef: "NORM-1" }).detail, undefined);
  });

  it("refuses an entry it cannot repair, naming the field, the entry and the expected shape", () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ foo: "bar" }, /invalid contract: validation\[0\] cannot be normalised: \{"foo":"bar"\} has no "check" string; expected \{"check": "…"\} or a plain string/],
      [7, /validation\[0\] cannot be normalised: the entry is number \(7\); expected \{"check": "…"\}/],
      [["nested"], /validation\[0\] cannot be normalised: the entry is an array; expected \{"check": "…"\}/],
      [null, /validation\[0\] cannot be normalised: the entry is null; expected \{"check": "…"\}/],
      ["   ", /validation\[0\] is an empty string; expected \{"check": "…"\}/],
      [{ check: "" }, /validation\[0\] cannot be normalised: \{"check":""\} has no "check" string/],
    ];
    for (const [entry, expected] of cases) {
      const r = create(prose({ validation: [entry] }));
      assert.notEqual(r.code, 0, `entry ${JSON.stringify(entry)} must be refused`);
      assert.match(r.stderr, expected);
    }
    const badOutput = create(prose({ output: [{ artefact: "typo" }] }));
    assert.notEqual(badOutput.code, 0);
    assert.match(badOutput.stderr, /invalid contract: output\[0\] cannot be normalised: \{"artefact":"typo"\} has no "artifact" string; expected \{"artifact": "…"\}/);
  });

  it("repairs prose entries on edit, and readiness agrees with the stored contract", () => {
    assert.equal(create(prose()).code, 0);
    const edit = cli([
      "issue",
      "edit",
      "NORM-1",
      "--contract",
      JSON.stringify(prose({ problem: "p2", validation: ["edited check"], output: ["edited artifact"] })),
    ]);
    assert.equal(edit.code, 0, edit.stderr);
    const stored = storedContract("NORM-1");
    assert.deepEqual(stored.validation, [{ check: "edited check" }]);
    assert.deepEqual(stored.output, [{ artifact: "edited artifact" }]);
    const readiness = json(["issue", "validate", "NORM-1"]);
    assert.equal(readiness.ok, true);
    assert.equal(readiness.data["structurallyValid"], true);
    assert.deepEqual(readiness.data["reasons"], ["no current semantic attestation for this revision + contract hash"]);
    assert.equal(readiness.data["shapeHints"], undefined, "nothing left for the read-side hint to explain");
  });

  it("refuses an unrepairable entry on edit before any revision is written", () => {
    assert.equal(create(prose()).code, 0);
    const before = json(["issue", "show", "NORM-1"]).data["revision"];
    const edit = cli(["issue", "edit", "NORM-1", "--contract", JSON.stringify(prose({ validation: [{ nope: 1 }] }))]);
    assert.notEqual(edit.code, 0);
    assert.match(edit.stderr, /invalid contract: validation\[0\] cannot be normalised/);
    assert.equal(json(["issue", "show", "NORM-1"]).data["revision"], before, "no revision was created");
  });

  it("keeps readiness unchanged for a contract stored before this change", () => {
    // A contract written by an older sb stays prose on disk and still reads back
    // verbatim: normalisation is a write-path repair, never a migration.
    assert.equal(create(prose({ validation: [{ check: "v" }], output: [{ artifact: "o" }] })).code, 0);
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      const issue = svc.resolveRef("NORM-1");
      db.prepare("UPDATE issue_revisions SET contract_json = ? WHERE issue_id = ? AND revision = ?").run(
        JSON.stringify(prose()),
        issue.id,
        issue.currentRevision,
      );
    } finally {
      db.close();
    }
    const shown = json(["issue", "show", "NORM-1"]);
    assert.deepEqual((shown.data["contract"] as WorkContract).validation, ["run the tests"]);
    const readiness = json(["issue", "validate", "NORM-1"]);
    assert.equal(readiness.data["structurallyValid"], false);
    assert.deepEqual(readiness.data["reasons"], [
      "validation: validation must be a non-empty array of { check: non-empty string }",
      "output: output must be a non-empty array of { artifact: non-empty string }",
    ]);
    assert.match((readiness.data["shapeHints"] as string[])[0] ?? "", /validation\[0\] is a plain string/);
  });

  it("normalises idempotently and reports no repair the second time", () => {
    const once = normaliseContract(prose());
    assert.deepEqual(once.repairs, [
      { field: "validation", key: "check", count: 1 },
      { field: "output", key: "artifact", count: 1 },
    ]);
    const twice = normaliseContract(once.contract);
    assert.deepEqual(twice.repairs, []);
    assert.deepEqual(twice.contract, once.contract);
  });

  it("normalises below the CLI, so a service caller stores the same contract", () => {
    // The MCP, Pi and Beads-import paths never pass through cli/sb.ts; the
    // repair lives in the service write, so they get it too.
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      const issue = svc.createIssue({
        projectId: "prj_norm",
        title: "service caller",
        kind: "task",
        contract: prose() as unknown as WorkContract,
        scrutiny: "MEDIUM",
        authoredBy: "test",
      });
      const revision = svc.getRevision(issue.id, issue.currentRevision);
      const stored = revision.contract as WorkContract;
      assert.deepEqual(stored.validation, [{ check: "run the tests" }]);
      assert.deepEqual(stored.output, [{ artifact: "a merged PR" }]);
      const subject = { contract: revision.contract, scrutiny: "MEDIUM" };
      assert.equal(isStructurallyValid(subject), true);
      // And an unrepairable entry is refused here as well.
      assert.throws(
        () =>
          svc.createIssue({
            projectId: "prj_norm",
            title: "service caller 2",
            kind: "task",
            contract: prose({ validation: [{ nope: 1 }] }) as unknown as WorkContract,
            scrutiny: "MEDIUM",
            authoredBy: "test",
          }),
        /validation\[0\] cannot be normalised/,
      );
    } finally {
      db.close();
    }
  });

  it("leaves the readiness rules themselves untouched", () => {
    // Non-goal guard: the structural validator still rejects a prose entry, so a
    // stored pre-XTRM-786 contract keeps its old verdict.
    const findings = validateContractStructure({ contract: prose(), scrutiny: "MEDIUM" });
    assert.deepEqual(
      findings.map((f) => f.field),
      ["validation", "output"],
    );
    assert.deepEqual(validateContractStructure({ contract: normaliseContract(prose()).contract, scrutiny: "MEDIUM" }), []);
  });
});
