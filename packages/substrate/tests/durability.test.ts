import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSubstrate } from "../src/store/sqlite.ts";
import { mutateOnce, withTransaction } from "../src/store/transactions.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract, setup } from "./helpers.ts";

describe("durability + idempotency (PRD §§46-47)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    try {
      ctx.db.close();
    } catch {
      /* closed by test */
    }
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("committed transactions survive restart; uncertain effects persist as uncertain", () => {
    const i = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "r", kind: "task", contract: contract() });
    ctx.svc.appendEvent(i.id, "external.uncertain", { system: "github", note: "unknown if PATCH landed" });
    ctx.db.close();
    const db2 = openSubstrate(join(ctx.dir, "state.db"));
    try {
      const svc2 = new IssueService(db2);
      const back = svc2.getIssue(i.id);
      assert.equal(back.title, "r");
      const types = svc2.listEvents(i.id).map((e) => e.type);
      assert.ok(types.includes("issue.created"));
      const uncertain = svc2.listEvents(i.id).find((e) => e.type === "external.uncertain");
      assert.ok(uncertain);
      assert.equal((uncertain.payload as { system: string }).system, "github");
    } finally {
      db2.close();
    }
    ctx.db = new DatabaseSync(":memory:");
  });

  it("concurrent reference allocation is unique and monotonic", () => {
    const path = join(ctx.dir, "state.db");
    const dbB = openSubstrate(path);
    try {
      const svcB = new IssueService(dbB);
      const refs = new Set<string>();
      for (let n = 0; n < 10; n++) {
        refs.add(ctx.svc.createIssue({ projectId: "prj_xtrm", title: `a${n}`, kind: "task", contract: contract() }).humanRef);
        refs.add(svcB.createIssue({ projectId: "prj_xtrm", title: `b${n}`, kind: "task", contract: contract() }).humanRef);
      }
      assert.equal(refs.size, 20);
      const nums = [...refs].map((r) => Number(r.split("-")[1])).sort((x, y) => x - y);
      assert.deepEqual(nums, Array.from({ length: 20 }, (_, k) => k + 1));
    } finally {
      dbB.close();
    }
  });

  it("fail-closed: corrupt schema refuses startup", () => {
    ctx.db.exec("DROP TABLE issue_events");
    ctx.db.close();
    assert.throws(() => openSubstrate(join(ctx.dir, "state.db")), /fail-closed/);
    ctx.db = new DatabaseSync(":memory:");
  });

  it("fail-closed: unknown migration state refuses startup", () => {
    ctx.db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (999, 'bogus', 'x', ?)").run(Date.now());
    ctx.db.close();
    assert.throws(() => openSubstrate(join(ctx.dir, "state.db")), /unknown migration/);
    ctx.db = new DatabaseSync(":memory:");
  });

  it("fail-closed: tampered landed migration refuses startup", () => {
    ctx.db.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1").run();
    ctx.db.close();
    assert.throws(() => openSubstrate(join(ctx.dir, "state.db")), /landed migration/);
    ctx.db = new DatabaseSync(":memory:");
  });

  it("idempotency keys prevent duplicate mutations; namespaces never collide", () => {
    const mk = () => ({ projectId: "prj_xtrm", title: "idem", kind: "task" as const, contract: contract() });
    const first = ctx.svc.createIssue(mk(), { idempotencyKey: "k1" });
    const replay = ctx.svc.createIssue(mk(), { idempotencyKey: "k1" });
    assert.equal(replay.id, first.id);
    assert.equal(ctx.svc.listIssues("prj_xtrm").length, 1);
    // Same key string in another namespace is an independent key.
    const viaPlan = withTransaction(ctx.db, () => mutateOnce(ctx.db, "plan", "k1", () => ({ marker: 1 })));
    assert.deepEqual(viaPlan, { marker: 1 });
    assert.throws(() => withTransaction(ctx.db, () => mutateOnce(ctx.db, "bogus" as never, "k", () => 1)), /unknown idempotency namespace/);
  });
});
