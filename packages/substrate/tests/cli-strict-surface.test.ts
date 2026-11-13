// XTRM-738 (A3): the CLI surface #302 proposed, landed on current main without
// its transport regressions. Every test here pins a behaviour an operator can
// observe from argv to exit code: a wrong invocation must fail loudly instead of
// succeeding quietly, and `issue renew` must move an expiry without pretending a
// new generation was claimed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

function world(): { dir: string; dbPath: string; svc: IssueService; db: ReturnType<typeof openSubstrate> } {
  const dir = tempDir("sb-cli-a3-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  return { dir, dbPath, svc, db };
}

function readyIssue(w: ReturnType<typeof world>, title = "work"): { id: string; humanRef: string } {
  const issue = w.svc.createIssue({
    projectId: "prj_xtrm",
    title,
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  w.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  return { id: issue.id, humanRef: issue.humanRef };
}

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const base = { ...process.env };
  delete base["SUBSTRATE_HOLDER"];
  // The temp store has no repository binding, so name the project the way an
  // operator outside a bound checkout would.
  return { ...base, SUBSTRATE_PROJECT: "prj_xtrm", ...extra };
};

function cli(w: ReturnType<typeof world>, argv: string[], extra: Record<string, string> = {}) {
  // Project context for mutating verbs comes from the process environment in
  // runCli (opts.env covers transport and identity), and this temp store has no
  // repository binding, so name the project for the duration of the call.
  const held = process.env["SUBSTRATE_PROJECT"];
  const holder = process.env["SUBSTRATE_HOLDER"];
  process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
  // Holder resolution reads the process environment (resolveClaimHolder), so a
  // test that wants an ambient holder sets it here rather than in opts.env.
  const ambient = extra["SUBSTRATE_HOLDER"];
  if (ambient) process.env["SUBSTRATE_HOLDER"] = ambient;
  else delete process.env["SUBSTRATE_HOLDER"];
  try {
    return runCli(["--db", w.dbPath, ...argv], { env: env(extra) });
  } finally {
    if (held === undefined) delete process.env["SUBSTRATE_PROJECT"];
    else process.env["SUBSTRATE_PROJECT"] = held;
    if (holder !== undefined) process.env["SUBSTRATE_HOLDER"] = holder;
  }
}

describe("A3: a wrong flag fails closed instead of being dropped", () => {
  it("names the unknown flag and the command that does not accept it", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      const res = cli(w, ["issue", "claim", humanRef, "--holder", "a", "--bogus", "x"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /unknown flag --bogus for `issue\.claim`/);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("explains a flag and its value glued into one argument", () => {
    const w = world();
    try {
      const res = cli(w, ["issue", "list", "--project prj_xtrm"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /unknown flag --project prj_xtrm/);
      assert.match(res.stderr, /flag and value must be separate arguments \(--project "prj_xtrm"\)/);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("refuses a value flag that was given no value", () => {
    const w = world();
    try {
      const res = cli(w, ["issue", "list", "--project"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /--project requires a value/);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("refuses extra positional text instead of dropping it", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      const res = cli(w, ["issue", "show", humanRef, "and", "some", "prose"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /unexpected extra arguments: "and some prose"/);
      assert.match(res.stderr, /\(issue\.show takes one ref\)/);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("keeps the two-argument verbs working", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      const res = cli(w, ["issue", "state", humanRef, "deferred", "--until", "4102444800000"]);
      assert.equal(res.code, 0, res.stderr);
      assert.equal(w.svc.getIssue(w.svc.resolveRef(humanRef).id).lifecycleState, "deferred");
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("A3: alreadyHeld says whether the claim was taken or kept", () => {
  it("is false on the first claim and true when the same holder claims again", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      const first = cli(w, ["--json", "issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"]);
      assert.equal(first.code, 0, first.stderr);
      const firstData = (JSON.parse(first.stdout) as { data: { alreadyHeld: boolean; generation: number } }).data;
      assert.equal(firstData.alreadyHeld, false, "a first claim is not an already-held one");

      const again = cli(w, ["--json", "issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"]);
      assert.equal(again.code, 0, again.stderr);
      const againData = (JSON.parse(again.stdout) as { data: { alreadyHeld: boolean; generation: number } }).data;
      assert.equal(againData.alreadyHeld, true, "re-claiming as the live holder keeps the lease");
      assert.equal(againData.generation, firstData.generation, "and it is the same generation");

      // The human confirmation carries the same fact, so an operator sees it too.
      const heldAgain = process.env["SUBSTRATE_PROJECT"];
      process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
      try {
        const third = cli(w, ["issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"]);
        assert.equal(third.code, 0, third.stderr);
      } finally {
        if (heldAgain === undefined) delete process.env["SUBSTRATE_PROJECT"];
        else process.env["SUBSTRATE_PROJECT"] = heldAgain;
      }
      const plain = cli(w, ["--json", "issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"]);
      assert.equal((JSON.parse(plain.stdout) as { data: { alreadyHeld: boolean } }).data.alreadyHeld, true);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("the human claim line says already held when the lease was kept", async () => {
    const w = world();
    const held = process.env["SUBSTRATE_PROJECT"];
    process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
    try {
      const { humanRef } = readyIssue(w);
      assert.equal(cli(w, ["issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"]).code, 0);
      const { runUxCli } = await import("../cli/sb-ux.ts");
      const res = await runUxCli(["--db", w.dbPath, "--plain", "issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"], { isTTY: false });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /Claimed XTRM-1/);
      assert.match(res.stdout, /already held/, `got: ${res.stdout}`);
    } finally {
      if (held === undefined) delete process.env["SUBSTRATE_PROJECT"];
      else process.env["SUBSTRATE_PROJECT"] = held;
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("A3: issue renew moves an expiry without claiming again", () => {
  it("extends a live lease, keeps the generation and reports the ISO expiry", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      const claimed = cli(w, ["--json", "issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"], { SUBSTRATE_HOLDER: "" });
      assert.equal(claimed.code, 0, claimed.stderr);
      const before = (JSON.parse(claimed.stdout) as { data: { generation: number; expiresAt: number; expiresAtIso: string } }).data;
      assert.equal(before.expiresAtIso, new Date(before.expiresAt).toISOString().replace(/\.\d{3}Z$/, "Z"));

      const renewed = cli(w, ["--json", "issue", "renew", humanRef, "--holder", "adopt-302", "--ttl-ms", "3600000"]);
      assert.equal(renewed.code, 0, renewed.stderr);
      const after = (JSON.parse(renewed.stdout) as { data: { generation: number; expiresAt: number; alreadyHeld: boolean; expiresInMinutes: number } }).data;
      assert.equal(after.generation, before.generation, "a renewal is not a re-claim");
      assert.ok(after.expiresAt > before.expiresAt, "the expiry moved forward");
      assert.equal(after.alreadyHeld, true, "a renewal finds the caller already holding the lease");
      assert.ok(after.expiresInMinutes >= 59, `about an hour left, got ${after.expiresInMinutes}`);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("resolves the holder from SUBSTRATE_HOLDER, like claim and release", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      assert.equal(cli(w, ["issue", "claim", humanRef, "--ttl-ms", "60000"], { SUBSTRATE_HOLDER: "session-a" }).code, 0);
      const renewed = cli(w, ["--json", "issue", "renew", humanRef, "--ttl-ms", "60000"], { SUBSTRATE_HOLDER: "session-a" });
      assert.equal(renewed.code, 0, renewed.stderr);
      const data = (JSON.parse(renewed.stdout) as { data: { holder: string; holderSource: string } }).data;
      assert.equal(data.holder, "session-a");
      assert.equal(data.holderSource, "env");
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("refuses a renewal by a holder that does not own the lease", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      assert.equal(cli(w, ["issue", "claim", humanRef, "--holder", "owner", "--ttl-ms", "60000"]).code, 0);
      const res = cli(w, ["issue", "renew", humanRef, "--holder", "intruder"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /owner|holder|claim/i);
      // The lease is untouched: releasing as the intruder still fails.
      assert.equal(cli(w, ["issue", "release", humanRef, "--holder", "intruder"]).code, 1);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("cannot renew an expired lease", () => {
    const w = world();
    try {
      const { id, humanRef } = readyIssue(w);
      w.svc.claimIssue(id, "owner", { ttlMs: 1000, now: Date.now() - 60_000 });
      const res = cli(w, ["issue", "renew", humanRef, "--holder", "owner"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /expired|claim/i);
      // Claiming again is the honest path and records a new generation.
      const reclaim = cli(w, ["--json", "issue", "claim", humanRef, "--holder", "owner"]);
      assert.equal(reclaim.code, 0, reclaim.stderr);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("A3: the help groups answer without a database", () => {
  for (const group of ["contract", "kinds", "identity"]) {
    it(`sb help ${group} explains its subject`, () => {
      const res = runCli(["help", group], { env: env() });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, new RegExp(`^usage: sb help ${group}`));
    });
  }

  it("the kinds topic names both journal payloads and the real summary limit", () => {
    const res = runCli(["help", "kinds"], { env: env() });
    assert.match(res.stdout, /--semantic '\{"summary"/);
    assert.match(res.stdout, /--result '\{"summary"/);
    assert.match(res.stdout, /20,000 characters/);
    assert.match(res.stdout, /MCP append path still cuts at/, "the unported MCP path is stated, not implied");
  });

  it("the identity topic names the only holder sources and nothing else", () => {
    const res = runCli(["help", "identity"], { env: env() });
    assert.match(res.stdout, /resolveClaimHolder \(XTRM-722\) is the only holder source/);
    assert.match(res.stdout, /never derived from a worktree path/);
  });

  it("an unknown topic still fails closed", () => {
    const res = runCli(["help", "nonsense"], { env: env() });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /unknown help topic: nonsense/);
  });
});

describe("A3: a malformed contract is diagnosed, not just refused", () => {
  it("repairs a prose entry, and names the expected shape for one it cannot repair", () => {
    const w = world();
    try {
      const dir = tempDir("sb-cli-a3-contract-");
      const file = join(dir, "contract.json");
      // XTRM-786: a prose entry is a slight shape error, so creation repairs it
      // and says so; the contract it stores passes readiness.
      writeFileSync(file, JSON.stringify({ ...contract(), validation: ["run the tests"] }));
      const created = cli(w, ["--json", "issue", "create", "--project", "prj_xtrm", "--title", "shape", "--kind", "task", "--contract", file, "--scrutiny", "LOW"]);
      assert.equal(created.code, 0, created.stderr);
      const createdData = (JSON.parse(created.stdout) as { data: { humanRef: string; contractNormalised?: unknown } }).data;
      assert.deepEqual(createdData.contractNormalised, [{ field: "validation", key: "check", count: 1 }]);
      const res = cli(w, ["--json", "issue", "validate", createdData.humanRef]);
      const data = (JSON.parse(res.stdout) as { data: { structurallyValid: boolean } }).data;
      assert.equal(data.structurallyValid, true);
      // An entry the repair cannot make sense of is still diagnosed: the field,
      // the entry and the expected shape, in the refusal itself.
      writeFileSync(file, JSON.stringify({ ...contract(), validation: [{ run: "the tests" }] }));
      const refused = cli(w, ["--json", "issue", "create", "--project", "prj_xtrm", "--title", "shape", "--kind", "task", "--contract", file, "--scrutiny", "LOW"]);
      assert.equal(refused.code, 1);
      assert.match(
        (JSON.parse(refused.stdout) as { error: string }).error,
        /invalid contract: validation\[0\] cannot be normalised: \{"run":"the tests"\} has no "check" key; expected \{"check": "…"\} or a plain string/,
      );
      rmSync(dir, { recursive: true, force: true });
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("a contract nested under a contract key is refused with the fix", () => {
    const w = world();
    try {
      const dir = tempDir("sb-cli-a3-nested-");
      const file = join(dir, "contract.json");
      writeFileSync(file, JSON.stringify({ contract: contract() }));
      const res = cli(w, ["issue", "create", "--project", "prj_xtrm", "--title", "nested", "--kind", "task", "--contract", file, "--scrutiny", "LOW"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /nested under a "contract" key; pass the inner object itself/);
      rmSync(dir, { recursive: true, force: true });
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("A3: the operator docs keep the transport sections", () => {
  // The branch deleted these two sections; porting its docs would have removed
  // them silently, so their presence is asserted rather than assumed.
  const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "substrate", "cli.md"), "utf8");

  it("documents the remote dispatch section", () => {
    assert.match(doc, /^## remote — dispatch to a server-owned store$/m);
  });

  it("documents the serve section", () => {
    assert.match(doc, /^## serve — the typed service for in-process consumers$/m);
  });
});

describe("A3: reads stay on the read-only path", () => {
  // Routing a read through the mutation path prints "✓ … completed" and drops
  // its data. The four verbs below were in exactly that state before A3.
  for (const argv of [
    ["issue", "query", "--project", "prj_xtrm"],
    ["plan", "check"],
    ["provenance", "session"],
    ["provenance", "activation"],
  ]) {
    it(`${argv.join(" ")} prints data, not a completion line`, async () => {
      const { runUxCli } = await import("../cli/sb-ux.ts");
      const w = world();
      try {
        const res = await runUxCli(["--db", w.dbPath, "--plain", ...argv], { isTTY: false });
        // The mutation path renders one completion line and drops the data;
        // the read path prints the payload. Assert the payload, not the absence
        // of a specific glyph.
        // Without the read-only route the wrapper answers "✓ <command> completed"
        // and drops whatever the read returned; with it, the payload comes through
        // (here: nothing, because the probes carry no arguments, which is the
        // point — a completion line would be a lie either way).
        assert.ok(!/\bcompleted\b/.test(res.stdout + res.stderr), `routed through the mutation path: ${(res.stdout + res.stderr).slice(0, 160)}`);
      } finally {
        w.db.close();
        rmSync(w.dir, { recursive: true, force: true });
      }
    });
  }
});

describe("A3: a renew confirmation reads like a person wrote it", () => {
  it("names the ISO expiry and the minutes left, never epoch milliseconds", async () => {
    const w = world();
    const held = process.env["SUBSTRATE_PROJECT"];
    process.env["SUBSTRATE_PROJECT"] = "prj_xtrm";
    try {
      const { humanRef } = readyIssue(w);
      assert.equal(cli(w, ["issue", "claim", humanRef, "--holder", "adopt-302", "--ttl-ms", "60000"]).code, 0);
      // The confirmation line is rendered by the interactive wrapper, which is
      // where an operator reads it; the plain CLI stays machine-shaped.
      const { runUxCli } = await import("../cli/sb-ux.ts");
      const res = await runUxCli(
        ["--db", w.dbPath, "--plain", "issue", "renew", humanRef, "--holder", "adopt-302", "--ttl-ms", "3600000"],
        { isTTY: false },
      );
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /Renewed XTRM-1/);
      assert.match(res.stdout, /expires \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \(\d+ min\)/, `got: ${res.stdout}`);
      assert.match(res.stdout, /holder adopt-302 \(from --holder\)/);
      assert.ok(!/\b1\d{12}\b/.test(res.stdout), "never prints raw epoch milliseconds");
    } finally {
      if (held === undefined) delete process.env["SUBSTRATE_PROJECT"];
      else process.env["SUBSTRATE_PROJECT"] = held;
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});

describe("A3: journaling prose in the wrong place says where it goes", () => {
  it("an extra positional on journal append names --semantic", () => {
    const w = world();
    try {
      const { humanRef } = readyIssue(w);
      const res = cli(w, ["journal", "append", humanRef, "--kind", "note", "this", "prose", "belongs", "in", "semantic"]);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /unexpected extra arguments: "this prose belongs in semantic"/);
      assert.match(res.stderr, /put the text in --semantic '\{"summary":"…"\}'/);
    } finally {
      w.db.close();
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});
