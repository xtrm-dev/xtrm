// CORE-2595 R1 regression: fixed rerank, project boost, snippets, filters,
// freshness, and fail-open on missing, corrupt and locked indexes.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildRecallIndex } from "../src/recall/indexer.ts";
import { parseSince, queryTokens, recall } from "../src/recall/query.ts";
import { readIndexStatus } from "../src/recall/schema.ts";
import { BASE_TS, createFixtureStore, type FixtureStore } from "./recall-fixtures.ts";
import { SNIPPET_MAX_CHARS, STALE_AFTER_MS } from "../src/recall/constants.ts";

const DAY = 86_400_000;

function build(store: FixtureStore, now = BASE_TS + 30 * DAY): void {
  buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0, now });
}

describe("recall query: ranking and result shape", () => {
  let store: FixtureStore;
  beforeEach(() => {
    store = createFixtureStore([
      { ref: "CORE-1", seq: 1, kind: "decision", ts: BASE_TS, semantic: { summary: "harbour lantern protocol alpha" } },
      { ref: "CORE-2", seq: 1, kind: "note", ts: BASE_TS, semantic: { summary: "harbour lantern protocol alpha" } },
      { ref: "MMD-3", seq: 1, kind: "note", ts: BASE_TS + 10 * DAY, semantic: { summary: "harbour lantern protocol alpha" } },
      { ref: "CORE-4", seq: 1, kind: "note", ts: BASE_TS, semantic: { summary: "harbour lantern protocol alpha" } },
      { ref: "CORE-5", seq: 1, kind: "note", ts: BASE_TS, semantic: { summary: "harbour lantern protocol alpha" } },
    ]);
  });
  afterEach(() => store.cleanup());

  it("ranks a decision above a note with the same text and time", () => {
    build(store);
    const result = recall({ terms: "harbour lantern", indexPath: store.indexPath, limit: 5, now: BASE_TS + 30 * DAY });
    const order = result.hits.map((hit) => hit.ref);
    assert.ok(order.indexOf("CORE-1") < order.indexOf("CORE-2"), `decision must outrank note: ${order}`);
  });

  it("ranks a newer note above an older note with the same text", () => {
    build(store);
    const result = recall({ terms: "harbour lantern", indexPath: store.indexPath, limit: 5, now: BASE_TS + 30 * DAY });
    const order = result.hits.map((hit) => hit.ref);
    assert.ok(order.indexOf("MMD-3") < order.indexOf("CORE-2"), `newer must outrank older: ${order}`);
  });

  it("boosts the current project at equal authority and recency", () => {
    build(store);
    const result = recall({
      terms: "harbour lantern",
      indexPath: store.indexPath,
      limit: 5,
      now: BASE_TS + 30 * DAY,
      projectId: "prj_mmd",
    });
    assert.equal(result.hits[0]?.ref, "MMD-3");
    assert.equal(result.hits[0]?.project, "mmd");
    assert.equal(result.hits[0]?.projectPrefix, "MMD");
  });

  it("returns at most the requested limit, default three", () => {
    build(store);
    assert.equal(recall({ terms: "harbour lantern", indexPath: store.indexPath, now: BASE_TS + 30 * DAY }).hits.length, 3);
    assert.equal(recall({ terms: "harbour lantern", indexPath: store.indexPath, limit: 5, now: BASE_TS + 30 * DAY }).hits.length, 5);
  });

  it("caps every snippet at 240 characters and cites ref#seq", () => {
    store.cleanup();
    store = createFixtureStore([
      { ref: "CORE-77", seq: 9, kind: "finding", semantic: { summary: `${"long sentence about the sentinel. ".repeat(60)}` } },
    ]);
    build(store);
    const hit = recall({ terms: "sentinel", indexPath: store.indexPath, now: BASE_TS + 30 * DAY }).hits[0];
    assert.ok(hit, "expected a hit");
    assert.equal(hit.ref, "CORE-77");
    assert.equal(hit.seq, 9);
    assert.ok([...hit.snippet].length <= SNIPPET_MAX_CHARS, `snippet ${[...hit.snippet].length} chars`);
    assert.equal(hit.superseded, false);
    assert.match(hit.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("filters by source and by since", () => {
    build(store);
    const onlyOther = recall({ terms: "harbour lantern", source: "jira", indexPath: store.indexPath });
    assert.equal(onlyOther.hits.length, 0);
    const onlyJournal = recall({ terms: "harbour lantern", source: "substrate-journal", indexPath: store.indexPath, limit: 5, now: BASE_TS + 30 * DAY });
    assert.equal(onlyJournal.hits.length, 5);
    const recent = recall({ terms: "harbour lantern", since: BASE_TS + 5 * DAY, indexPath: store.indexPath, limit: 5, now: BASE_TS + 30 * DAY });
    assert.deepEqual(recent.hits.map((hit) => hit.ref), ["MMD-3"]);
  });

  it("reports index age and flags a stale index", () => {
    build(store, BASE_TS + 30 * DAY);
    const fresh = recall({ terms: "harbour lantern", indexPath: store.indexPath, now: BASE_TS + 30 * DAY + 60_000 });
    assert.equal(fresh.index.stale, false);
    assert.ok(fresh.index.ageMs !== null && fresh.index.ageMs >= 60_000);
    const stale = recall({ terms: "harbour lantern", indexPath: store.indexPath, now: BASE_TS + 30 * DAY + STALE_AFTER_MS + 1 });
    assert.equal(stale.index.stale, true);
    assert.equal(stale.index.watermarkAgeMs !== null, true);
  });

  it("parses query tokens and --since forms", () => {
    assert.deepEqual(queryTokens("what did the researcher conclude on ISSUE-577"), ["researcher", "conclude", "ISSUE-577"]);
    assert.deepEqual(queryTokens("the a an"), []);
    assert.equal(parseSince("2026-11-01"), Date.UTC(2026, 10, 1));
    assert.equal(parseSince("7d", BASE_TS + 7 * DAY), BASE_TS);
    assert.throws(() => parseSince("not-a-date"), /invalid --since/);
  });
});

describe("recall query: fail-open", () => {
  let store: FixtureStore;
  beforeEach(() => {
    store = createFixtureStore([{ ref: "CORE-1", seq: 1, kind: "note", semantic: { summary: "sentinel field mismatch" } }]);
  });
  afterEach(() => store.cleanup());

  it("returns no hits for a missing index", () => {
    const result = recall({ terms: "sentinel", indexPath: store.indexPath });
    assert.deepEqual(result.hits, []);
    assert.match(result.note ?? "", /not built/);
    assert.equal(result.index.exists, false);
  });

  it("returns no hits for a corrupt index", () => {
    build(store);
    writeFileSync(store.indexPath, "this is not a sqlite database");
    const result = recall({ terms: "sentinel", indexPath: store.indexPath });
    assert.deepEqual(result.hits, []);
    assert.ok(result.note !== null);
    assert.equal(result.index.compatible, false);
    // Reading status must also survive the same file.
    assert.equal(readIndexStatus(store.indexPath).exists, true);
  });

  it("returns no hits for a locked index", () => {
    build(store);
    const writer = new DatabaseSync(store.indexPath);
    writer.exec("PRAGMA busy_timeout = 0");
    writer.exec("BEGIN EXCLUSIVE");
    try {
      writer.prepare("INSERT INTO meta (doc_id, source, ref, seq, kind, ts, authority, scrub_version) VALUES (999, 'x', 'X-1', 1, 'note', 0, 1, 'x')").run();
      const result = recall({ terms: "sentinel", indexPath: store.indexPath });
      assert.deepEqual(result.hits, []);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });

  it("returns no hits when the query has no searchable terms", () => {
    build(store);
    const result = recall({ terms: "the a an", indexPath: store.indexPath });
    assert.deepEqual(result.hits, []);
    assert.match(result.note ?? "", /no searchable terms/);
  });
});
