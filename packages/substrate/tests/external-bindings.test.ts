import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import {
  ExternalBindingConflictError,
  IntegrationService,
  PROJECT_BINDINGS_MAX_LIMIT,
  type BindExternalKeyInput,
} from "../src/service/integration-service.ts";
import { FLAG_ALLOWLIST, SCHEMA_VERSION, runCli } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

// XTRM-814: bounded external-binding read and the Jira bind verb. Both reuse
// external_bindings as it is; nothing here touches the network, the inbox or
// the outbox.

const SCOPE = "mercury.atlassian.net:MMD";

function jira(over: Partial<BindExternalKeyInput> = {}): BindExternalKeyInput {
  return {
    provider: "jira",
    remoteScope: SCOPE,
    remoteId: "10042",
    remoteKey: "MMD-42",
    url: "https://mercury.atlassian.net/browse/MMD-42",
    ...over,
  };
}

function scratch() {
  const dir = tempDir("substrate-external-bindings-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  svc.createProject({ id: "prj_oth", prefix: "OTH", name: "o" });
  const make = (projectId: string, title: string) =>
    svc.createIssue({ projectId, title, kind: "task", contract: contract({ problem: "p", success: "s" }), scrutiny: "LOW", authoredBy: "tester" });
  const a = make("prj_xtrm", "first");
  const b = make("prj_xtrm", "second");
  const other = make("prj_oth", "other project");
  return { dir, dbPath, db, svc, ix: new IntegrationService(db, svc), a, b, other };
}

type Scratch = ReturnType<typeof scratch>;

function bindingRows(s: Scratch): unknown[] {
  return s.db.prepare("SELECT * FROM external_bindings ORDER BY issue_id, provider, remote_scope, remote_id").all();
}

function sb(s: Scratch, argv: string[]) {
  return runCli(["--db", s.dbPath, "--json", ...argv]);
}

function sbOk(s: Scratch, argv: string[]): Record<string, unknown> {
  const res = sb(s, argv);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: Record<string, unknown> };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

describe("IntegrationService.bindExternalKey", () => {
  let s: Scratch;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("records a mirror_read, pending binding with id, key and url", () => {
    const res = s.ix.bindExternalKey(s.a.id, jira());
    assert.equal(res.status, "created");
    assert.equal(res.issueRef, s.a.humanRef);
    assert.equal(res.binding.provider, "jira");
    assert.equal(res.binding.mode, "mirror_read");
    assert.equal(res.binding.syncState, "pending");
    assert.equal(res.binding.remoteScope, SCOPE);
    assert.equal(res.binding.remoteId, "10042");
    assert.equal(res.binding.remoteKey, "MMD-42");
    assert.equal(res.binding.url, "https://mercury.atlassian.net/browse/MMD-42");
    // Intent only: nothing was read from Jira, so no remote version, push or hash exists.
    assert.equal(res.binding.lastSeenRemoteVersion, null);
    assert.equal(res.binding.lastPushedRevision, null);
    assert.equal(res.binding.mappedContentHash, null);
    assert.equal(s.ix.listBindings(s.a.id).length, 1);
  });

  it("records in_sync on request", () => {
    const res = s.ix.bindExternalKey(s.a.id, jira({ syncState: "in_sync" }));
    assert.equal(res.binding.syncState, "in_sync");
  });

  it("binding the same key twice is a no-op: one row, no second event", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    const before = bindingRows(s);
    const eventsBefore = s.svc.listEvents(s.a.id).length;
    const again = s.ix.bindExternalKey(s.a.id, jira());
    assert.equal(again.status, "noop");
    assert.deepEqual(bindingRows(s), before, "a no-op leaves the row byte-identical, updated_at included");
    assert.equal(s.svc.listEvents(s.a.id).length, eventsBefore);
  });

  it("a re-bind that names no state keeps drift instead of resetting it to pending", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    s.db.prepare("UPDATE external_bindings SET sync_state = 'drift' WHERE issue_id = ?").run(s.a.id);
    const again = s.ix.bindExternalKey(s.a.id, jira());
    assert.equal(again.status, "noop");
    assert.equal(again.binding.syncState, "drift");
  });

  it("a re-bind with another state or url updates the same row", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    const up = s.ix.bindExternalKey(s.a.id, jira({ syncState: "in_sync", url: "http://jira.internal/browse/MMD-42" }));
    assert.equal(up.status, "updated");
    assert.equal(up.binding.syncState, "in_sync");
    assert.equal(up.binding.url, "http://jira.internal/browse/MMD-42");
    assert.equal(s.ix.listBindings(s.a.id).length, 1);
  });

  it("refuses a key bound to another issue, names that issue, and writes nothing", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    const before = bindingRows(s);
    const events = s.svc.listEvents(s.b.id).length;
    assert.throws(
      () => s.ix.bindExternalKey(s.b.id, jira()),
      (err: unknown) => {
        assert.ok(err instanceof ExternalBindingConflictError);
        assert.equal(err.ownerRef, s.a.humanRef);
        assert.equal(err.ownerIssueId, s.a.id);
        assert.match(err.message, new RegExp(s.a.humanRef));
        assert.match(err.message, /MMD-42/);
        return true;
      },
    );
    assert.deepEqual(bindingRows(s), before);
    assert.equal(s.svc.listEvents(s.b.id).length, events);
  });

  it("names the owner when the other issue is in another project", () => {
    s.ix.bindExternalKey(s.other.id, jira());
    assert.throws(() => s.ix.bindExternalKey(s.a.id, jira()), (err: unknown) => err instanceof ExternalBindingConflictError && err.ownerRef === s.other.humanRef);
  });

  it("refuses the same numeric id or the same key alone when held by another issue", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    assert.throws(() => s.ix.bindExternalKey(s.b.id, jira({ remoteKey: "MMD-43", url: "https://mercury.atlassian.net/browse/MMD-43" })), ExternalBindingConflictError);
    assert.throws(() => s.ix.bindExternalKey(s.b.id, jira({ remoteId: "10043" })), ExternalBindingConflictError);
    assert.equal(bindingRows(s).length, 1);
  });

  it("refuses to record one id under a second key on the same issue", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    assert.throws(
      () => s.ix.bindExternalKey(s.a.id, jira({ remoteKey: "MMD-99", url: "https://mercury.atlassian.net/browse/MMD-99" })),
      (err: unknown) => err instanceof ExternalBindingConflictError && err.ownerRef === s.a.humanRef && /already records Jira id 10042 as MMD-42/.test(err.message),
    );
    assert.equal(bindingRows(s).length, 1);
  });

  it("the same id in another site scope is a different remote issue", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    const res = s.ix.bindExternalKey(s.b.id, jira({ remoteScope: "other.atlassian.net:MMD" }));
    assert.equal(res.status, "created");
  });

  it("one issue may carry more than one Jira key", () => {
    s.ix.bindExternalKey(s.a.id, jira());
    s.ix.bindExternalKey(s.a.id, jira({ remoteId: "10050", remoteKey: "MMD-50", url: "https://mercury.atlassian.net/browse/MMD-50" }));
    assert.equal(s.ix.listBindings(s.a.id).length, 2);
  });

  it("rejects malformed identity before any write", () => {
    const bad: Array<[Partial<BindExternalKeyInput>, RegExp]> = [
      [{ remoteScope: "MMD" }, /<site>:<projectKey>/],
      [{ remoteScope: "mercury.atlassian.net:mmd" }, /<site>:<projectKey>/],
      [{ remoteId: "MMD-42" }, /numeric/],
      [{ remoteId: "0" }, /numeric/],
      [{ remoteKey: "mmd-42" }, /KEY-123/],
      [{ remoteKey: "ABC-42", url: "https://mercury.atlassian.net/browse/ABC-42" }, /not in project MMD/],
      [{ url: "not a url" }, /browse URL/],
      [{ url: "https://mercury.atlassian.net/browse/MMD-43" }, /\/browse\/MMD-42/],
      [{ url: "ftp://mercury.atlassian.net/browse/MMD-42" }, /http\(s\)/],
      [{ syncState: "drift" as never }, /pending\|in_sync/],
      [{ provider: "github" as never }, /jira only/],
    ];
    for (const [over, pattern] of bad) assert.throws(() => s.ix.bindExternalKey(s.a.id, jira(over)), pattern, JSON.stringify(over));
    assert.equal(bindingRows(s).length, 0);
  });

  it("refuses an unknown issue", () => {
    assert.throws(() => s.ix.bindExternalKey("iss_missing", jira()));
    assert.equal(bindingRows(s).length, 0);
  });

  it("leaves the GitHub binding path as it was: in_sync, mode as given", () => {
    const gh = s.ix.bindExternal(s.a.id, { provider: "github", remoteScope: "x/y", remoteId: "7", mode: "projection" });
    assert.equal(gh.syncState, "in_sync");
    assert.equal(gh.mode, "projection");
  });

  it("provenance trace still returns the new row beside a GitHub row", () => {
    s.ix.bindExternal(s.a.id, { provider: "github", remoteScope: "x/y", remoteId: "7", mode: "projection" });
    s.ix.bindExternalKey(s.a.id, jira());
    const trace = new ProvenanceService(s.db, s.svc, new JournalService(s.db, s.svc)).trace(s.a.id);
    assert.deepEqual(trace.externalBindings.map((b) => b.provider), ["github", "jira"]);
    const j = trace.externalBindings.find((b) => b.provider === "jira");
    assert.deepEqual(j, { provider: "jira", scope: SCOPE, remoteId: "10042", remoteKey: "MMD-42", url: "https://mercury.atlassian.net/browse/MMD-42" });
  });
});

describe("IntegrationService.listProjectBindings", () => {
  let s: Scratch;
  beforeEach(() => {
    s = scratch();
    s.ix.bindExternalKey(s.a.id, jira());
    s.ix.bindExternalKey(s.b.id, jira({ remoteId: "10043", remoteKey: "MMD-43", url: "https://mercury.atlassian.net/browse/MMD-43" }));
    s.ix.bindExternalKey(s.b.id, jira({ remoteScope: "mercury.atlassian.net:PRG", remoteId: "20001", remoteKey: "PRG-1", url: "https://mercury.atlassian.net/browse/PRG-1" }));
    s.ix.bindExternal(s.a.id, { provider: "github", remoteScope: "x/y", remoteId: "7", mode: "projection" });
    // A binding in another project that shares provider and scope with the rows above.
    s.ix.bindExternalKey(s.other.id, jira({ remoteId: "10099", remoteKey: "MMD-99", url: "https://mercury.atlassian.net/browse/MMD-99" }));
  });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("scopes to the project", () => {
    const page = s.ix.listProjectBindings({ projectId: "prj_xtrm" });
    assert.equal(page.bindings.length, 4);
    assert.ok(page.bindings.every((b) => b.issueRef.startsWith("XTRM-")));
    assert.ok(!page.bindings.some((b) => b.remoteKey === "MMD-99"), "another project's binding never appears");
    assert.deepEqual(s.ix.listProjectBindings({ projectId: "prj_oth" }).bindings.map((b) => b.remoteKey), ["MMD-99"]);
    assert.equal(s.ix.listProjectBindings({ projectId: "prj_none" }).bindings.length, 0);
  });

  it("narrows by provider and by remote scope", () => {
    const jiraOnly = s.ix.listProjectBindings({ projectId: "prj_xtrm", provider: "jira" });
    assert.deepEqual(jiraOnly.bindings.map((b) => b.remoteKey), ["MMD-42", "MMD-43", "PRG-1"]);
    const scoped = s.ix.listProjectBindings({ projectId: "prj_xtrm", provider: "jira", remoteScope: SCOPE });
    assert.deepEqual(scoped.bindings.map((b) => [b.issueRef, b.remoteKey]), [[s.a.humanRef, "MMD-42"], [s.b.humanRef, "MMD-43"]]);
    const gh = s.ix.listProjectBindings({ projectId: "prj_xtrm", provider: "github" });
    assert.deepEqual(gh.bindings.map((b) => b.remoteScope), ["x/y"]);
    assert.equal(s.ix.listProjectBindings({ projectId: "prj_xtrm", remoteScope: "nowhere:ZZZ" }).bindings.length, 0);
  });

  it("is bounded: limit cuts the page and truncated says so", () => {
    const cut = s.ix.listProjectBindings({ projectId: "prj_xtrm", limit: 2 });
    assert.equal(cut.bindings.length, 2);
    assert.equal(cut.truncated, true);
    assert.equal(cut.limit, 2);
    const exact = s.ix.listProjectBindings({ projectId: "prj_xtrm", limit: 4 });
    assert.equal(exact.bindings.length, 4);
    assert.equal(exact.truncated, false);
    assert.equal(s.ix.listProjectBindings({ projectId: "prj_xtrm" }).limit, 100);
  });

  it("rejects an unbounded or malformed request", () => {
    for (const limit of [0, -1, 1.5, PROJECT_BINDINGS_MAX_LIMIT + 1, Number.NaN]) {
      assert.throws(() => s.ix.listProjectBindings({ projectId: "prj_xtrm", limit }), /limit must be an integer/, String(limit));
    }
    assert.throws(() => s.ix.listProjectBindings({ projectId: "prj_xtrm", provider: "gitlab" as never }), /unknown provider/);
    assert.throws(() => s.ix.listProjectBindings({ projectId: "prj_xtrm", remoteScope: "  " }), /remoteScope/);
  });
});

describe("sb external", () => {
  let s: Scratch;
  const bindArgs = (ref: string, extra: string[] = []) => [
    "external", "bind", ref, "--project", "prj_xtrm", "--provider", "jira", "--scope", SCOPE, "--id", "10042", "--key", "MMD-42",
    "--url", "https://mercury.atlassian.net/browse/MMD-42", ...extra,
  ];
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("bind twice reports created then noop with one row", () => {
    const first = sbOk(s, bindArgs(s.a.humanRef));
    assert.equal(first["status"], "created");
    assert.equal(first["issue"], s.a.humanRef);
    assert.equal(first["mode"], "mirror_read");
    assert.equal(first["syncState"], "pending");
    const second = sbOk(s, bindArgs(s.a.humanRef));
    assert.equal(second["status"], "noop");
    assert.equal(bindingRows(s).length, 1);
  });

  it("a conflicting bind exits non-zero, names the owner and changes nothing", () => {
    sbOk(s, bindArgs(s.a.humanRef));
    const before = bindingRows(s);
    const res = sb(s, bindArgs(s.b.humanRef));
    assert.notEqual(res.code, 0);
    const env = JSON.parse(res.stdout) as { ok: boolean; error: string };
    assert.equal(env.ok, false);
    assert.match(env.error, new RegExp(`already bound to ${s.a.humanRef}`));
    assert.deepEqual(bindingRows(s), before);
  });

  it("bind with --state in_sync, then list reads it back", () => {
    sbOk(s, bindArgs(s.a.humanRef, ["--state", "in_sync"]));
    const data = sbOk(s, ["external", "list", "--project", "prj_xtrm", "--provider", "jira", "--scope", SCOPE]);
    assert.deepEqual(data["bindings"], [
      {
        issue: s.a.humanRef,
        provider: "jira",
        remoteScope: SCOPE,
        remoteId: "10042",
        remoteKey: "MMD-42",
        url: "https://mercury.atlassian.net/browse/MMD-42",
        mode: "mirror_read",
        syncState: "in_sync",
      },
    ]);
    assert.equal(data["truncated"], false);
  });

  it("list honours --limit and the project scope", () => {
    sbOk(s, bindArgs(s.a.humanRef));
    sbOk(s, ["external", "bind", s.b.humanRef, "--project", "prj_xtrm", "--provider", "jira", "--scope", SCOPE, "--id", "10043", "--key", "MMD-43", "--url", "https://mercury.atlassian.net/browse/MMD-43"]);
    const cut = sbOk(s, ["external", "list", "--project", "prj_xtrm", "--limit", "1"]);
    assert.equal((cut["bindings"] as unknown[]).length, 1);
    assert.equal(cut["truncated"], true);
    const none = sbOk(s, ["external", "list", "--project", "prj_oth"]);
    assert.deepEqual(none["bindings"], []);
    assert.equal(sb(s, ["external", "list", "--project", "prj_xtrm", "--limit", "0"]).code, 1);
  });

  it("provenance trace --json lists the Jira binding", () => {
    sbOk(s, bindArgs(s.a.humanRef));
    const trace = sbOk(s, ["provenance", "trace", s.a.humanRef]);
    assert.deepEqual(trace["externalBindings"], [
      { provider: "jira", scope: SCOPE, remoteId: "10042", remoteKey: "MMD-42", url: "https://mercury.atlassian.net/browse/MMD-42" },
    ]);
  });

  it("refuses a non-jira provider, a missing field, a bad state and extra arguments", () => {
    const noProvider = sb(s, ["external", "bind", s.a.humanRef, "--project", "prj_xtrm", "--scope", SCOPE]);
    assert.notEqual(noProvider.code, 0);
    assert.match(noProvider.stdout, /only jira can be bound/);
    const github = sb(s, bindArgs(s.a.humanRef).map((x) => (x === "jira" ? "github" : x)));
    assert.notEqual(github.code, 0);
    const missing = sb(s, ["external", "bind", s.a.humanRef, "--project", "prj_xtrm", "--provider", "jira", "--scope", SCOPE]);
    assert.match(missing.stdout, /--id is required/);
    assert.notEqual(sb(s, bindArgs(s.a.humanRef, ["--state", "drift"])).code, 0);
    const extra = sb(s, ["external", "list", "--project", "prj_xtrm", "stray"]);
    assert.notEqual(extra.code, 0);
    assert.match(extra.stdout, /unexpected extra argument/);
    const unknownFlag = sb(s, ["external", "list", "--project", "prj_xtrm", "--remote-id", "1"]);
    assert.match(unknownFlag.stdout, /unknown flag --remote-id/);
    assert.equal(bindingRows(s).length, 0);
  });

  it("help documents both verbs and every flag the strict allowlist accepts", () => {
    for (const verb of ["bind", "list"] as const) {
      const allowed = FLAG_ALLOWLIST[`external.${verb}`];
      assert.ok(allowed !== undefined && allowed.length > 0, `no allowlist entry for external.${verb}`);
      const res = runCli(["--db", s.dbPath, "external", verb, "--help"]);
      assert.equal(res.code, 0, res.stderr);
      for (const flag of allowed) assert.match(res.stdout, new RegExp(`--${flag}(?![a-z-])`), `sb external ${verb} --help omits --${flag}`);
    }
    const group = runCli(["--db", s.dbPath, "help", "external"]);
    assert.equal(group.code, 0);
    assert.match(group.stdout, /bind/);
    assert.match(group.stdout, /list/);
    assert.match(runCli(["--db", s.dbPath, "--help"]).stdout, /external\s+bind\|list/);
  });
});
