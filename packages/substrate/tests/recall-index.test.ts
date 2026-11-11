// CORE-2595 R1 regression: incremental indexer, single-writer lock, load gate,
// scrub-revision invalidation, and a read-only source.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildRecallIndex } from "../src/recall/indexer.ts";
import { recall } from "../src/recall/query.ts";
import { readIndexStatus } from "../src/recall/schema.ts";
import { SCRUB_VERSION } from "../src/recall/scrub.ts";
import { appendFixtureEntry, createFixtureStore, type FixtureStore } from "./recall-fixtures.ts";

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("recall indexer: build, watermark, lock, load gate", () => {
  let store: FixtureStore;
  beforeEach(() => {
    store = createFixtureStore([
      { ref: "CORE-100", seq: 1, kind: "decision", semantic: { summary: "ship the journal index with FTS5" } },
      { ref: "CORE-100", seq: 2, kind: "note", semantic: { summary: "the timer is a oneshot, not a daemon" } },
      { ref: "MMD-200", seq: 1, kind: "finding", semantic: { summary: "the SCID sentinel field mismatch caused the doc error" } },
    ]);
  });
  afterEach(() => store.cleanup());

  it("scrubs secrets under JSON keys before flattening and never writes them", () => {
    const secrets = ["correct-horse-battery-staple", "nested-token-value-123", "array-secret-value-456"];
    appendFixtureEntry(store, {
      ref: "CORE-101",
      seq: 1,
      kind: "result",
      semantic: {
        password: secrets[0]!,
        nested: { token: secrets[1]! },
        list: [{ secret: secrets[2]! }],
      },
      result: { summary: "credentials handling verified" },
    });
    const build = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(build.status, "built");
    const db = new DatabaseSync(store.indexPath, { readOnly: true });
    const body = String(
      db.prepare("SELECT d.body FROM docs d JOIN meta m ON m.doc_id = d.rowid WHERE m.ref = ? AND m.seq = ?").get("CORE-101", 1)?.["body"] ?? "",
    );
    db.close();
    for (const secret of secrets) assert.equal(body.includes(secret), false, `body leaked ${secret}`);
    assert.match(body, /\[REDACTED:value\]/);
    const bytes = readFileSync(store.indexPath).toString("latin1");
    for (const secret of secrets) assert.equal(bytes.includes(secret), false, `index bytes leaked ${secret}`);
  });

  it("builds every journal row and records the watermark", () => {
    const build = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(build.status, "built");
    assert.equal(build.docsIndexed, 3);
    assert.equal(build.docsTotal, 3);
    const status = readIndexStatus(store.indexPath);
    assert.equal(status.compatible, true);
    assert.equal(status.docCount, 3);
    assert.equal(status.watermark, build.watermark);
    assert.equal(status.scrubVersion, SCRUB_VERSION);
  });

  it("is incremental by watermark and idempotent", () => {
    const first = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    appendFixtureEntry(store, { ref: "CORE-100", seq: 3, kind: "result", result: { summary: "index p95 measured at 11 ms" } });
    const second = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    // Inclusive watermark: the new row plus the boundary row at the old mark.
    assert.ok(second.docsIndexed >= 1 && second.docsIndexed <= 2, `indexed ${second.docsIndexed}`);
    assert.equal(second.docsTotal, 4);
    assert.ok(second.watermark >= first.watermark);
    const third = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    // A watermark read is inclusive, so the boundary row may be re-upserted;
    // it is idempotent and the document count never changes.
    assert.ok(third.docsIndexed <= 1, `idle cycle re-indexed ${third.docsIndexed} rows`);
    assert.equal(third.docsTotal, 4);
  });

  it("defers above the load gate without creating an index", () => {
    const build = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0.0001 });
    assert.equal(build.status, "deferred");
    assert.match(build.reason ?? "", /load gate/);
    assert.equal(existsSync(store.indexPath), false);
  });

  it("skips while a fresh writer lock exists and recovers a stale lock", () => {
    const lockPath = `${store.indexPath}.lock`;
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const skipped = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(skipped.status, "skipped");
    assert.match(skipped.reason ?? "", /locked/);
    assert.equal(existsSync(store.indexPath), false);

    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lockPath, old, old);
    const built = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(built.status, "built");
    assert.equal(existsSync(lockPath), false, "a completed run releases its lock");
  });

  it("opens the source read-only and leaves it byte-identical", () => {
    const before = fileHash(store.storePath);
    const walBefore = existsSync(`${store.storePath}-wal`);
    buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(fileHash(store.storePath), before);
    assert.equal(existsSync(`${store.storePath}-wal`), walBefore);
  });

  it("refuses an index built with another scrub revision until it rebuilds", () => {
    buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    const db = new DatabaseSync(store.indexPath);
    try {
      db.prepare("UPDATE index_state SET scrub_version = 'scrub-old' WHERE id = 1").run();
    } finally {
      db.close();
    }
    const refused = recall({ terms: "sentinel", indexPath: store.indexPath });
    assert.equal(refused.hits.length, 0);
    assert.match(refused.note ?? "", /needs a rebuild/);

    const rebuilt = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(rebuilt.docsIndexed, 3, "an incompatible index is rebuilt from source, not trusted");
    const after = recall({ terms: "sentinel", indexPath: store.indexPath });
    assert.ok(after.hits.length > 0);
    assert.equal(after.note, null);
  });

  it("rebuilds atomically and replaces stale rows", () => {
    buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    const rebuilt = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0, rebuild: true });
    assert.equal(rebuilt.status, "built");
    assert.equal(rebuilt.docsTotal, 3);
    assert.equal(readIndexStatus(store.indexPath).docCount, 3);
  });

  it("fails loudly when the source store is missing", () => {
    assert.throws(
      () => buildRecallIndex({ storePath: `${store.dir}/absent.db`, indexPath: store.indexPath, loadGate: 0 }),
      /unable to open|no such file|cannot open/i,
    );
    assert.equal(existsSync(`${store.indexPath}.lock`), false, "a failed build releases its lock");
  });
});
