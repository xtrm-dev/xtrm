// CORE-2595 R1 regression: `sb recall` / `sb recall-build` surface, help text,
// eval harness weights gate, and the systemd timer contract.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../cli/sb.ts";
import { evaluateReplay, metricsFor, verifyFrozenWeights } from "../src/recall/eval.ts";
import { buildRecallIndex } from "../src/recall/indexer.ts";
import { rankingWeights, weightsHash, SNIPPET_MAX_CHARS } from "../src/recall/constants.ts";
import { createFixtureStore, type FixtureStore } from "./recall-fixtures.ts";
import type { ReplaySet } from "../src/recall/types.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PACKAGE = join(HERE, "..");

interface Envelope {
  schema: string;
  command: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

function json(result: { stdout: string }): Envelope {
  return JSON.parse(result.stdout) as Envelope;
}

describe("sb recall: CLI surface", () => {
  let store: FixtureStore;
  beforeEach(() => {
    store = createFixtureStore([
      { ref: "CORE-2595", seq: 4, kind: "decision", semantic: { summary: "the journal index stores a head field with ref, kind and the first 240 characters" } },
      { ref: "MMD-3190", seq: 3, kind: "result", semantic: { summary: "the ISSUE-577 researcher concluded that the sentinel field mismatched" } },
    ]);
    buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
  });
  afterEach(() => store.cleanup());

  it("opens no state.db and returns cited JSON", () => {
    const dbPath = join(store.dir, "never-created.db");
    const result = runCli(["recall", "ISSUE-577", "--db", dbPath, "--index", store.indexPath, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const envelope = json(result);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, "recall");
    assert.equal(existsSync(dbPath), false, "sb recall must not create state.db");
    const data = envelope.data as { hits: Array<Record<string, unknown>>; index: Record<string, unknown> };
    assert.ok(data.hits.length > 0);
    const hit = data.hits[0]!;
    for (const key of ["source", "ref", "seq", "date", "kind", "authority", "superseded", "snippet"]) {
      assert.ok(key in hit, `hit is missing ${key}`);
    }
    assert.ok([...String(hit["snippet"])].length <= SNIPPET_MAX_CHARS);
    assert.equal(typeof data.index["stale"], "boolean");
    assert.equal(typeof data.index["ageMs"], "number");
  });

  it("renders a human citation and the index line", () => {
    const result = runCli(["recall", "sentinel field", "--index", store.indexPath]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /MMD-3190#3/);
    assert.match(result.stdout, /・|·/);
    assert.match(result.stdout, /^index: \d+ docs · built /m);
  });

  it("rejects a limit outside 1..5 and an empty query", () => {
    const tooMany = runCli(["recall", "sentinel", "--limit", "6", "--index", store.indexPath]);
    assert.equal(tooMany.code, 1);
    assert.match(tooMany.stderr, /--limit must be an integer from 1 to 5/);
    const empty = runCli(["recall", "--index", store.indexPath]);
    assert.equal(empty.code, 1);
    assert.match(empty.stderr, /usage: sb recall/);
  });

  it("fails open on a missing and on a corrupt index with exit code 0", () => {
    const missing = runCli(["recall", "sentinel", "--index", join(store.dir, "absent.sqlite"), "--json"]);
    assert.equal(missing.code, 0);
    const missingData = json(missing).data as { hits: unknown[]; note: string };
    assert.deepEqual(missingData.hits, []);
    assert.match(missingData.note, /not built/);

    const corruptPath = join(store.dir, "corrupt.sqlite");
    writeFileSync(corruptPath, "not sqlite");
    const corrupt = runCli(["recall", "sentinel", "--index", corruptPath, "--json"]);
    assert.equal(corrupt.code, 0);
    assert.deepEqual((json(corrupt).data as { hits: unknown[] }).hits, []);
  });

  it("recall-build builds once and reports JSON", () => {
    const target = join(store.dir, "built.sqlite");
    const result = runCli(["recall-build", "--db", store.storePath, "--index", target, "--load-gate", "0", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const envelope = json(result);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data?.["status"], "built");
    assert.equal(envelope.data?.["docsTotal"], 2);
    assert.ok(existsSync(target));
  });

  it("serves the agent-facing help through both help routes", () => {
    for (const argv of [["recall", "--help"], ["help", "recall"], ["recall-build", "--help"], ["help", "recall-build"]]) {
      const result = runCli(argv);
      assert.equal(result.code, 0, `${argv.join(" ")}: ${result.stderr}`);
      assert.match(result.stdout, /usage:/);
    }
    const help = runCli(["recall", "--help"]).stdout;
    for (const marker of ["When to call it", "What it returns", "Limits:", "Fail-open", "cited", "ref#seq", "index.stale"]) {
      assert.ok(help.includes(marker), `recall help is missing ${marker}`);
    }
  });
});

describe("recall eval harness: fixed weights and held-out gate", () => {
  const weights = rankingWeights();
  const set: ReplaySet = {
    version: 1,
    created: "2026-11-11",
    weights,
    weightsHash: weightsHash(weights),
    cases: [
      { id: 1, name: "hit one", query: "sentinel field", expected: [{ ref: "CORE-1", seq: 1 }], split: "tuning" },
      { id: 2, name: "hit two", query: "sentinel field", expected: [{ ref: "CORE-2", seq: 1 }], split: "tuning" },
      { id: 3, name: "hit three", query: "sentinel field", expected: [{ ref: "CORE-3", seq: 1 }], split: "heldout" },
      { id: 4, name: "hit four", query: "sentinel field", expected: [{ ref: "CORE-4", seq: 1 }], split: "heldout" },
    ],
  };
  let store: FixtureStore;
  beforeEach(() => {
    store = createFixtureStore([
      { ref: "CORE-1", seq: 1, kind: "finding", semantic: { summary: "sentinel field alpha" } },
      { ref: "CORE-2", seq: 1, kind: "finding", semantic: { summary: "sentinel field beta" } },
      { ref: "CORE-3", seq: 1, kind: "finding", semantic: { summary: "sentinel field gamma" } },
      { ref: "CORE-4", seq: 1, kind: "finding", semantic: { summary: "sentinel field delta" } },
    ]);
    buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
  });
  afterEach(() => store.cleanup());

  it("measures the held-out half against the frozen weights", () => {
    const report = evaluateReplay(set, { indexPath: store.indexPath });
    assert.equal(report.heldout.cases, 2);
    assert.equal(report.heldout.hitAt5, 1);
    assert.equal(report.heldout.hitAt10, 1);
    assert.equal(report.heldoutMeetsThreshold, true);
  });

  it("refuses a held-out run after the weights change", () => {
    const changed = { ...set, weights: { ...weights, recency: 0.99 } };
    assert.throws(() => verifyFrozenWeights(changed), /weights changed/);
    assert.doesNotThrow(() => verifyFrozenWeights(changed, true));
  });

  it("refuses a set with no frozen weights", () => {
    assert.throws(() => verifyFrozenWeights({ ...set, weights: undefined }), /no fixed weights/);
  });

  it("computes hit@k and MRR from ranks", () => {
    const metrics = metricsFor([
      { id: 1, name: "a", split: "heldout", rank: 1, expected: [] },
      { id: 2, name: "b", split: "heldout", rank: 4, expected: [] },
      { id: 3, name: "c", split: "heldout", rank: 11, expected: [] },
      { id: 4, name: "d", split: "heldout", rank: null, expected: [] },
    ]);
    assert.equal(metrics.hitAt1, 0.25);
    assert.equal(metrics.hitAt5, 0.5);
    assert.equal(metrics.hitAt10, 0.5);
    assert.equal(metrics.misses, 1);
    assert.equal(metrics.mrr, (1 + 1 / 4 + 1 / 11) / 4);
  });
});

describe("recall systemd contract", () => {
  it("ships a oneshot service with nice, memory cap and no daemon", () => {
    const service = readFileSync(join(PACKAGE, "contrib", "systemd", "substrate-recall-index.service"), "utf8");
    assert.match(service, /Type=oneshot/);
    assert.match(service, /Nice=10/);
    assert.match(service, /MemoryMax=150M/);
    assert.match(service, /recall-build --load-gate/);
    assert.doesNotMatch(service, /Restart=/);
    assert.doesNotMatch(service, /Type=simple/);
  });

  it("ships a five-minute timer", () => {
    const timer = readFileSync(join(PACKAGE, "contrib", "systemd", "substrate-recall-index.timer"), "utf8");
    assert.match(timer, /OnUnitActiveSec=5min/);
    assert.match(timer, /WantedBy=timers.target/);
  });

  it("ships an executable installer", () => {
    const path = join(PACKAGE, "scripts", "install-recall-timer.sh");
    assert.ok(existsSync(path));
    const mode = statSync(path).mode;
    assert.ok((mode & 0o111) !== 0, "installer must be executable");
    assert.match(readFileSync(path, "utf8"), /systemctl --user enable --now substrate-recall-index\.timer/);
  });
});
