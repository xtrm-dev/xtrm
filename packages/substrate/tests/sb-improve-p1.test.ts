// XTRM-670 (P1): the sb CLI rejects lossy input, confirms every write with
// ref/kind/actor/next, names the remedy in errors and teaches doctrine via
// `sb help contract|kinds|identity`. Scratch DBs only.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { runCli } from "../cli/sb.ts";
import { runUxCli } from "../cli/sb-ux.ts";
import { assessJournalEntry, JOURNAL_KINDS } from "../src/domain/journal.ts";
import { contractShapeHints } from "../src/domain/contract.ts";
import { feedbackForCommand, renderFeedback, stripAnsi } from "../src/presentation/terminal.ts";
import { contract } from "./helpers.ts";

const ENV_KEYS = ["SUBSTRATE_HOLDER", "XTRM_SESSION_ID", "SUBSTRATE_ACTIVATION_ID", "SUBSTRATE_PROJECT"];
const LONG_SUMMARY = "migrated the parser to the new schema, tests pass, next step is review";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-p1-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const mk = (title: string, opts: { attest?: boolean; contract?: ReturnType<typeof contract> } = {}) => {
    const i = svc.createIssue({ projectId: "prj_xtrm", title, kind: "task", contract: opts.contract ?? contract(), scrutiny: "LOW", authoredBy: "tester" });
    if (opts.attest !== false) svc.attestReadiness(i.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    return svc.getIssue(i.id);
  };
  const cli = (argv: string[]) => runCli(["--db", dbPath, "--project", "prj_xtrm", ...argv]);
  const json = (argv: string[]) => {
    // Read verbs and issue state take no --project flag.
    const noProject = /^(issue (show|validate)|journal (latest|since))\b/.test(argv.slice(0, 2).join(" "));
    const res = noProject ? runCli(["--db", dbPath, "--json", ...argv]) : cli(["--json", ...argv]);
    const env = JSON.parse(res.stdout) as { ok: boolean; data: Record<string, unknown>; error?: string };
    return { code: res.code, stderr: res.stderr, data: env.data, error: env.error ?? "" };
  };
  const ux = async (argv: string[]) => {
    const res = await runUxCli(["--db", dbPath, "--project", "prj_xtrm", "--plain", ...argv]);
    return { code: res.code, out: stripAnsi(res.stdout), err: stripAnsi(res.stderr) };
  };
  return { dir, dbPath, db, svc, mk, cli, json, ux };
}

describe("XTRM-670 sb CLI messages", () => {
  const saved = new Map<string, string | undefined>();
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved.set(k, process.env[k]); delete process.env[k]; }
    s = scratch();
  });
  afterEach(() => {
    s.db.close();
    rmSync(s.dir, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  describe("1. lossy input is rejected", () => {
    it("journal append with extra positional text fails and names --semantic", () => {
      const issue = s.mk("work");
      const r = s.json(["journal", "append", issue.humanRef, "--kind", "note", "some", "loose", "text"]);
      assert.equal(r.code, 1);
      assert.match(r.error, /unexpected extra arguments: "some loose text"/);
      assert.match(r.error, /--semantic '\{"summary":"…"\}'/);
      assert.equal(new JournalService(s.db, s.svc).listEntries(issue.id).length, 0, "nothing persisted");
    });

    it("other single-ref verbs reject extra positionals", () => {
      const issue = s.mk("work");
      for (const argv of [["issue", "show", issue.humanRef, "oops"], ["issue", "validate", issue.humanRef, "oops"], ["journal", "latest", issue.humanRef, "oops"]]) {
        const r = s.json(argv);
        assert.equal(r.code, 1, argv.join(" "));
        assert.match(r.error, /unexpected extra argument: "oops"/);
      }
    });

    it("two-argument verbs still accept their second argument", () => {
      const issue = s.mk("work");
      assert.equal(s.json(["issue", "state", issue.humanRef, "deferred"]).code, 0);
      assert.equal(s.json(["journal", "since", issue.humanRef, "0"]).code, 0);
    });
  });

  describe("2. value flags need a value", () => {
    it("a value flag with no value errors", () => {
      const issue = s.mk("work");
      const r = s.json(["journal", "append", issue.humanRef, "--kind"]);
      assert.equal(r.code, 1);
      assert.equal(r.error, "--kind requires a value");
    });

    it("a flag and value merged into one token explain the fix", () => {
      const r = s.json(["issue", "create", "--parent XTRM-1"]);
      assert.equal(r.code, 1);
      assert.match(r.error, /unknown flag --parent XTRM-1/);
      assert.match(r.error, /flag and value must be separate arguments/);
    });
  });

  describe("3. empty and thin journal entries", () => {
    it("rejects an empty entry for each content kind in the CLI and the service", () => {
      const issue = s.mk("work");
      const journal = new JournalService(s.db, s.svc);
      for (const kind of ["note", "finding", "decision", "blocker", "milestone", "handoff"] as const) {
        const r = s.json(["journal", "append", issue.humanRef, "--kind", kind]);
        assert.equal(r.code, 1, kind);
        assert.match(r.error, /empty journal entry/);
        assert.throws(() => journal.appendEntry(issue.id, { kind }), /empty journal entry/, kind);
      }
      assert.equal(journal.listEntries(issue.id).length, 0);
    });

    it("assessJournalEntry is pure: thin summaries and placeholders warn, full ones do not", () => {
      const warn = (summary: string) => assessJournalEntry({ kind: "note", semantic: { summary } }).warnings;
      for (const p of ["done", "WIP", "ok", "todo", "tbd", "...", "-"]) {
        assert.match(warn(p)[0] ?? "", /placeholder.*what changed \/ evidence \/ next step/, p);
      }
      assert.match(warn("fixed the bug")[0] ?? "", /3 words \(under 8\).*what changed \/ evidence \/ next step/);
      assert.deepEqual(warn(LONG_SUMMARY), []);
      assert.deepEqual(assessJournalEntry({ kind: "checkpoint", mechanical: {} }).errors, []);
      assert.equal(assessJournalEntry({ kind: "note" }).errors.length, 1);
    });

    it("a thin summary succeeds with a warning in JSON data and on stderr", () => {
      const issue = s.mk("work");
      const args = ["journal", "append", issue.humanRef, "--kind", "note", "--semantic", '{"summary":"done"}'];
      const j = s.json(args);
      assert.equal(j.code, 0);
      assert.ok((j.data["warnings"] as string[]).some((w) => /what changed \/ evidence \/ next step/.test(w)));
      const plain = s.cli(args);
      assert.equal(plain.code, 0);
      assert.match(plain.stderr, /warning: summary "done" is a placeholder/);
    });
  });

  describe("4. write confirmations carry ref, kind, actor and next", () => {
    it("create: draft shows reasons and the validate hint", async () => {
      const bad = JSON.stringify({ ...contract(), validation: ["run the tests"] });
      const r = await s.ux(["issue", "create", "--title", "T", "--kind", "task", "--scrutiny", "LOW", "--contract", bad]);
      assert.equal(r.code, 0);
      assert.match(r.out, /Created XTRM-1/);
      assert.match(r.out, /draft: validation: validation must be a non-empty array of \{ check/);
      assert.match(r.out, /validation\[0\] is a plain string; expected validation: \[\{"check": "…"\}\]/);
      assert.match(r.out, /next: sb issue validate XTRM-1/);
    });

    it("create: complete contract points at the attest command", async () => {
      const r = await s.ux(["issue", "create", "--title", "T", "--kind", "task", "--scrutiny", "LOW", "--contract", JSON.stringify(contract())]);
      assert.match(r.out, /next: sb issue attest XTRM-1 --outcome ready --policy default --attested-by <you>/);
    });

    it("attest shows the resulting readiness, including a draft that stays draft", async () => {
      const issue = s.mk("tbd work", { attest: false, contract: contract({ problem: "TBD" }) });
      const r = await s.ux(["issue", "attest", issue.humanRef, "--outcome", "ready", "--policy", "default", "--attested-by", "me"]);
      assert.equal(r.code, 0);
      assert.match(r.out, /^! Attested XTRM-1 as ready, but it is still draft/);
      assert.match(r.out, /problem contains an unresolved marker/);
      assert.match(r.out, /next: sb issue validate XTRM-1/);
      const ready = s.mk("fine work", { attest: false });
      const ok = await s.ux(["issue", "attest", ready.humanRef, "--outcome", "ready", "--policy", "default", "--attested-by", "me"]);
      assert.match(ok.out, /✓ Attested XTRM-2 as ready/);
      assert.match(ok.out, /now ready/);
      assert.match(ok.out, /next: sb issue claim XTRM-2/);
    });

    it("claim, renew and release show expiry and the next step", async () => {
      const issue = s.mk("work");
      const c = await s.ux(["issue", "claim", issue.humanRef, "--holder", "w1"]);
      assert.match(c.out, /Claimed XTRM-1/);
      assert.match(c.out, /holder w1 · expires \d{4}-\d\d-\d\dT[\d:]+Z \(in 15 min\)/);
      assert.match(c.out, /next: sb issue release XTRM-1/);
      const again = await s.ux(["issue", "claim", issue.humanRef, "--holder", "w1"]);
      assert.match(again.out, /XTRM-1 already held by you; expires \S+ \(in 15 min\) — use sb issue renew XTRM-1 --ttl-ms <ms> to extend/);
      const r = await s.ux(["issue", "renew", issue.humanRef, "--holder", "w1", "--ttl-ms", "3600000"]);
      assert.match(r.out, /^✓ Renewed XTRM-1 · expires \d{4}-\d\d-\d\dT[\d:]+Z \(in 60 min\)/);
      const rel = await s.ux(["issue", "release", issue.humanRef, "--holder", "w1"]);
      assert.match(rel.out, /Released XTRM-1/);
      assert.match(rel.out, /next: sb issue ready/);
    });

    it("renew extends expiresAt and rejects a non-holder", () => {
      const issue = s.mk("work");
      const first = s.json(["issue", "claim", issue.humanRef, "--holder", "w1", "--ttl-ms", "60000"]);
      const renewed = s.json(["issue", "renew", issue.humanRef, "--holder", "w1", "--ttl-ms", "7200000"]);
      assert.equal(renewed.code, 0);
      assert.ok((renewed.data["expiresAt"] as number) > (first.data["expiresAt"] as number));
      assert.equal(first.data["alreadyHeld"], false);
      const stolen = s.json(["issue", "renew", issue.humanRef, "--holder", "w2"]);
      assert.equal(stolen.code, 1);
      assert.match(stolen.error, /^claim-held: XTRM-1 is live-held by w1/);
    });

    it("journal writes name ref, kind, actor and a kind-specific next", async () => {
      const issue = s.mk("work");
      const note = await s.ux(["journal", "append", issue.humanRef, "--kind", "finding", "--participant", "wed", "--semantic", JSON.stringify({ summary: LONG_SUMMARY })]);
      assert.match(note.out, /^✓ Recorded finding on XTRM-1\n  finding · seq 1 · by wed\n  next: sb journal timeline XTRM-1\n$/);
      const res = await s.ux(["journal", "append", issue.humanRef, "--kind", "result", "--participant", "wed", "--result", '{"summary":"shipped"}']);
      assert.match(res.out, /Recorded result on XTRM-1/);
      assert.match(res.out, /next: sb issue close XTRM-1 --outcome completed --reason … --result jrn_/);
      const viaNote = await s.ux(["issue", "note", issue.humanRef, "plain note body", "--kind", "decision"]);
      assert.match(viaNote.out, /Added decision on XTRM-1/);
    });

    it("a null participant shows (none recorded) and names SUBSTRATE_HOLDER", async () => {
      const issue = s.mk("work");
      const r = await s.ux(["journal", "append", issue.humanRef, "--kind", "note", "--semantic", JSON.stringify({ summary: LONG_SUMMARY })]);
      assert.match(r.out, /by \(none recorded\)/);
      assert.match(r.out, /! no participant recorded; export SUBSTRATE_HOLDER=<name>/);
    });

    it("close: completed without evidence warns; evidence and the legacy path are distinguished", async () => {
      const a = s.mk("a");
      const bare = await s.ux(["issue", "close", a.humanRef, "--outcome", "completed", "--reason", "done"]);
      assert.match(bare.out, /Closed XTRM-1/);
      assert.match(bare.out, /outcome completed · by \(none recorded\)/);
      assert.match(bare.out, /! closed as completed with no evidence/);
      assert.match(bare.out, /export SUBSTRATE_HOLDER=<name>/);
      assert.match(bare.out, /next: sb issue ready/);

      process.env["SUBSTRATE_HOLDER"] = "wed";
      const b = s.mk("b");
      const ev = await s.ux(["issue", "close", b.humanRef, "--outcome", "completed", "--reason", "done", "--validation", "tests-green"]);
      assert.match(ev.out, /by wed/);
      assert.doesNotMatch(ev.out, /no evidence/);
      assert.doesNotMatch(ev.out, /SUBSTRATE_HOLDER/);

      const c = s.mk("c");
      const legacy = await s.ux(["issue", "close", c.humanRef]);
      assert.match(legacy.out, /legacy close: no Closure row/);
      assert.match(legacy.out, /! legacy close: lifecycle changed but no Closure row was recorded/);
    });

    it("every write command has a next hint", () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ["issue.create", { humanRef: "XTRM-1", readinessState: "draft", reasons: ["x"] }],
        ["issue.edit", { humanRef: "XTRM-1", revisionCreated: true }],
        ["issue.note", { humanRef: "XTRM-1", ref: "XTRM-1", kind: "note", sequence: 1 }],
        ["issue.attest", { humanRef: "XTRM-1", outcome: "ready", readinessState: "ready" }],
        ["issue.claim", { humanRef: "XTRM-1", holder: "h", expiresAtIso: "2026-01-01T00:00:00Z" }],
        ["issue.renew", { humanRef: "XTRM-1", expiresAtIso: "2026-01-01T00:00:00Z" }],
        ["issue.release", { humanRef: "XTRM-1" }],
        ["issue.close", { humanRef: "XTRM-1" }],
        ["issue.reopen", { humanRef: "XTRM-1" }],
        ["issue.cancel", { humanRef: "XTRM-1" }],
        ["issue.archive", { humanRef: "XTRM-1" }],
        ["issue.defer", { humanRef: "XTRM-1" }],
        ["issue.relate", {}],
        ["issue.unrelate", {}],
        ["plan.apply", {}],
        ["journal.append", { ref: "XTRM-1", kind: "note", sequence: 2 }],
        ["journal.checkpoint", { ref: "XTRM-1", kind: "checkpoint", sequence: 3 }],
      ];
      for (const [command, data] of cases) {
        const fb = feedbackForCommand(command, [], data);
        assert.ok(fb.hint, `${command} needs a next hint`);
        assert.match(renderFeedback(fb, { color: false, width: 80 }), /next: /);
      }
    });
  });

  describe("5. errors name the remedy", () => {
    it("not-claimable: attest command when unattested, validate when structurally draft", () => {
      const unattested = s.mk("unattested", { attest: false });
      const r = s.json(["issue", "claim", unattested.humanRef, "--holder", "w"]);
      assert.equal(r.code, 1);
      assert.match(r.error, /^not-claimable: XTRM-1 is draft: /);
      assert.ok(r.error.includes("`sb issue attest XTRM-1 --outcome ready --policy default --attested-by <you>`"));
      assert.doesNotMatch(r.error, /iss_/);

      const draft = s.mk("draft", { attest: false, contract: contract({ problem: "TBD" }) });
      const d = s.json(["issue", "claim", draft.humanRef, "--holder", "w"]);
      assert.ok(d.error.endsWith("run `sb issue validate XTRM-2`"), d.error);
    });

    it("not-claimable blocked: human refs, deduplicated, points at the blocker", () => {
      const blocked = s.mk("blocked");
      const blocker = s.mk("blocker");
      s.svc.addEdge(blocker.id, blocked.id, "blocks");
      const r = s.json(["issue", "claim", blocked.humanRef, "--holder", "w"]);
      assert.match(r.error, /^not-claimable: XTRM-1 is blocked: unsatisfied blockers: XTRM-2; run `sb issue show XTRM-2`$/);
      assert.doesNotMatch(r.error, /iss_/);
    });

    it("claim-held shows the human ref, ISO time and a release remedy", () => {
      const issue = s.mk("work");
      s.json(["issue", "claim", issue.humanRef, "--holder", "w1"]);
      const r = s.json(["issue", "claim", issue.humanRef, "--holder", "w2"]);
      assert.match(r.error, /^claim-held: XTRM-1 is live-held by w1 until \d{4}-\d\d-\d\dT[\d:]+Z \(anti-steal\)/);
      assert.match(r.error, /sb issue release XTRM-1 --holder w1/);
      assert.doesNotMatch(r.error, /iss_|\b\d{13}\b/);
    });

    it("already terminal and revision conflict use human refs and remedies", () => {
      const issue = s.mk("work");
      assert.equal(s.json(["issue", "close", issue.humanRef, "--outcome", "completed", "--reason", "r"]).code, 0);
      const again = s.json(["issue", "close", issue.humanRef, "--outcome", "completed", "--reason", "r"]);
      assert.match(again.error, /^already terminal: XTRM-1 is done; run `sb issue reopen XTRM-1 --reason <why>`/);
      const other = s.mk("other");
      const conflict = s.json(["issue", "edit", other.humanRef, "--contract", JSON.stringify(contract({ problem: "P2" })), "--expected-revision", "9"]);
      assert.match(conflict.error, /^revision conflict on XTRM-2: expected 9, current 1; re-read with `sb issue show XTRM-2`/);
    });

    it("unknown journal kind lists the valid kinds; result without --result names the flag", () => {
      const issue = s.mk("work");
      const bad = s.json(["journal", "append", issue.humanRef, "--kind", "nope"]);
      for (const k of JOURNAL_KINDS) assert.ok(bad.error.includes(k), `lists ${k}`);
      const res = s.json(["journal", "append", issue.humanRef, "--kind", "result"]);
      assert.match(res.error, /requires a bounded result payload.*--result/);
    });

    it("a mistyped --contract path says file not found, not bad JSON", () => {
      const r = s.json(["issue", "create", "--title", "T", "--kind", "task", "--scrutiny", "LOW", "--contract", "/nope/contract.json"]);
      assert.equal(r.code, 1);
      assert.match(r.error, /file not found/);
    });

    it("a contract nested under a contract key is rejected naming the key", () => {
      const r = s.json(["issue", "create", "--title", "T", "--kind", "task", "--scrutiny", "LOW", "--contract", JSON.stringify({ contract: contract() })]);
      assert.equal(r.code, 1);
      assert.match(r.error, /nested under a "contract" key/);
    });

    it("contractShapeHints names the expected object shape", () => {
      assert.deepEqual(contractShapeHints({ validation: [{ check: "a" }], output: [{ artifact: "b" }] }), []);
      assert.equal(contractShapeHints({ validation: ["x"], output: ["y"] }).length, 2);
    });
  });

  describe("6. holder defaults", () => {
    it("claim defaults --holder to SUBSTRATE_HOLDER", () => {
      process.env["SUBSTRATE_HOLDER"] = "envy";
      const issue = s.mk("work");
      const r = s.json(["issue", "claim", issue.humanRef]);
      assert.equal(r.code, 0);
      assert.equal(r.data["holder"], "envy");
      assert.equal(r.stderr, "");
    });

    it("errors naming the variable when neither is set", () => {
      const issue = s.mk("work");
      const r = s.json(["issue", "claim", issue.humanRef]);
      assert.equal(r.code, 1);
      assert.match(r.error, /--holder is required \(or export SUBSTRATE_HOLDER=<name>/);
    });

    it("warns on stderr when --holder differs from SUBSTRATE_HOLDER", () => {
      process.env["SUBSTRATE_HOLDER"] = "envy";
      const issue = s.mk("work");
      const r = s.json(["issue", "claim", issue.humanRef, "--holder", "other"]);
      assert.equal(r.code, 0);
      assert.equal(r.stderr, 'warning: --holder "other" overrides SUBSTRATE_HOLDER "envy"\n');
    });

    it("journal and close take the participant from SUBSTRATE_HOLDER", () => {
      process.env["SUBSTRATE_HOLDER"] = "envy";
      const issue = s.mk("work");
      const j = s.json(["journal", "append", issue.humanRef, "--kind", "note", "--semantic", JSON.stringify({ summary: LONG_SUMMARY })]);
      assert.equal(j.data["participantId"], "envy");
      assert.deepEqual(j.data["warnings"], []);
      const c = s.json(["issue", "close", issue.humanRef, "--outcome", "completed", "--reason", "r", "--result", "jrn_x"]);
      const closure = c.data["closure"] as { executionContext: { participantId: string } };
      assert.equal(closure.executionContext.participantId, "envy");
    });
  });

  describe("7. help topics", () => {
    it("contract, kinds and identity print doctrine under 40 lines", () => {
      const expectations: Array<[string, RegExp[]]> = [
        ["contract", [/"validation":\s+\[\{"check"/, /"output":\s+\[\{"artifact"/, /nonGoals/, /scrutiny/]],
        ["kinds", [/handoff/, /--semantic/, /--result/, /checkpoint/, /compaction/]],
        ["identity", [/SUBSTRATE_HOLDER/, /--holder/, /--participant/]],
      ];
      for (const [topic, patterns] of expectations) {
        const r = runCli(["help", topic], { dbPath: join(s.dir, "never.db") });
        assert.equal(r.code, 0, topic);
        assert.match(r.stdout, /^usage: sb help /);
        assert.ok(r.stdout.trimEnd().split("\n").length <= 40, `${topic} stays short`);
        for (const p of patterns) assert.match(r.stdout, p, `${topic} ${p}`);
      }
    });
  });

  describe("--json stays backward compatible", () => {
    it("adds fields without removing the existing ones", () => {
      const issue = s.mk("work");
      const claim = s.json(["issue", "claim", issue.humanRef, "--holder", "w"]);
      for (const k of ["issueId", "holder", "expiresAt", "generation"]) assert.ok(k in claim.data, k);
      const j = s.json(["journal", "append", issue.humanRef, "--kind", "note", "--semantic", JSON.stringify({ summary: LONG_SUMMARY })]);
      for (const k of ["id", "sequence", "kind", "issueRevision", "participantId", "result"]) assert.ok(k in j.data, k);
    });
  });
});
