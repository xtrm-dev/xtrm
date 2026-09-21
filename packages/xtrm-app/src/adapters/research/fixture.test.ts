import { describe, expect, it } from "vitest";
import { capturedChartRows, fixtureResearch } from "./fixture.ts";
import { researchAdapterFromEnv } from "./index.ts";
import { liveResearch } from "./live.ts";
import { isInvalidManifestRow, type RunListRow } from "./types.ts";
import fixture from "./__fixtures__/xtrm-research-fixture.json";

// The fixture adapter is what the UI runs against in tests and offline demos. It must
// serve exactly the shapes ResearchAdapter declares, or the UI is written against a lie.

describe("fixtureResearch serves the declared adapter shapes", () => {
  it("lists runs, including the invalid_manifest row, as the discriminated union", async () => {
    const rows: RunListRow[] = await fixtureResearch.listRuns();
    expect(rows.map((r) => r.id)).toEqual(["run-a", "run-b", "run-c"]);
    const invalid = rows.filter(isInvalidManifestRow);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.error).toContain("JSONDecodeError");
    for (const row of rows.filter((r) => !isInvalidManifestRow(r))) {
      expect(Object.keys(row).sort()).toEqual(
        ["evidenceStatus", "experiment", "id", "latestConclusion", "purpose", "status", "trigger", "variant"],
      );
    }
  });

  it("returns a lineage tree with camelCased run ids at every depth", async () => {
    const lineage = await fixtureResearch.getLineage("run-a");
    expect(lineage).toEqual({ runId: "run-a", children: [{ relation: "retry_of", runId: "run-b", children: [] }] });
  });

  it("returns a run show with manifest, status and annotations", async () => {
    const shown = await fixtureResearch.getRun("run-a");
    expect(shown.status).toBe("success");
    // The manifest is passed through untouched: still snake_case, still the CLI's own keys.
    expect(shown.manifest).toMatchObject({ run_id: "run-a", schema_version: expect.stringContaining("xtrm-research") });
    expect(shown.annotations[0]).toMatchObject({ kind: "conclusion" });
  });

  it("returns registry definitions for the ids the fixture carries", async () => {
    expect(await fixtureResearch.getExperiment("dup-detect-baseline")).toMatchObject({ id: "dup-detect-baseline" });
    expect(await fixtureResearch.getWorkload("dup-detect")).toMatchObject({ id: "dup-detect" });
  });

  it("returns a tail payload with a next offset and camelCased sample ids", async () => {
    const tail = await fixtureResearch.tail("run-a");
    expect(tail.nextOffset).toBe(2);
    expect(tail.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    for (const event of tail.events) expect(Object.keys(event).sort()).toEqual(["data", "kind", "sampleId", "seq", "ts", "usage"]);
  });

  it("returns metrics and a comparison keyed by run id", async () => {
    const summary = await fixtureResearch.getMetrics("run-a");
    expect(summary).toMatchObject({ sampleCount: 2, eventCount: 3 });
    expect(summary.metrics["exact-match::accuracy"]).toEqual({ value: 0.5, se: 0.5, ci95: [0, 1], n: 2, method: "binomial-proportion" });
    expect(summary.metrics["exact-match::latency_ms"]).toEqual({ value: 118.5, se: null, ci95: null, n: 1, method: "single-sample-no-variance" });
    const compared = await fixtureResearch.compare(["run-a", "run-b"]);
    expect(Object.keys(compared)).toEqual(["run-a", "run-b"]);
    expect(compared["run-b"]?.metrics).toEqual({});
  });

  it("lists registry experiments, including one with zero runs", async () => {
    expect(await fixtureResearch.listExperiments()).toEqual([
      { id: "dup-detect-baseline", version: "v1" },
      { id: "zero-run-baseline", version: "v1" },
    ]);
  });

  it("returns sample records, preserving an optional field's absence instead of inventing one", async () => {
    const samples = await fixtureResearch.getSamples("run-a");
    expect(samples.map((s) => s.sampleId)).toEqual(["s-0", "s-1"]);
    expect(samples[0]).toMatchObject({ index: 0, status: "ok", output: { duplicate: false }, candidate: { duplicate: false, confidence: 0.5 } });
    expect(samples[0]!.usage).toMatchObject({ inputTokens: 42, outputTokens: 7 });
    // s-1 carries no output/candidate: they stay absent rather than becoming null or {}.
    expect(samples[1]).not.toHaveProperty("output");
    expect(samples[1]).not.toHaveProperty("candidate");
    expect(samples[1]!.usage).toMatchObject({ inputTokens: null, nullReason: "not_exposed_by_provider" });
  });

  it("resolves a bare Experiment named-dataset id to the evaluator-namespaced metric, exactly as the CLI does", async () => {
    const rows = await fixtureResearch.getChartData(["run-a", "run-b"], "accuracy");
    // The fixture's metrics are stored namespaced (`exact-match::accuracy`); the bare dataset id
    // must still resolve, and the resolved rows must equal the captured `chart-data` envelope.
    expect(rows).toEqual(capturedChartRows);
    expect(rows[0]).toMatchObject({ runId: "run-a", state: "metric", value: 0.5, se: 0.5, ci95: [0, 1], n: 2, method: "binomial-proportion" });
    expect(rows[1]).toEqual({ runId: "run-b", state: "no_metric", reason: "run 'run-b' has no metric 'accuracy'" });
    // An exact namespaced key is accepted too, and an unrelated id stays unresolved.
    expect(await fixtureResearch.getChartData(["run-a"], "exact-match::accuracy")).toEqual(rows.slice(0, 1));
    expect(await fixtureResearch.getChartData(["run-a"], "unrelated")).toEqual([{ runId: "run-a", state: "no_metric", reason: "run 'run-a' has no metric 'unrelated'" }]);
  });

  it("fails loudly on an id the fixture does not carry", async () => {
    await expect(fixtureResearch.getRun("ghost")).rejects.toThrow("unknown run: ghost");
    await expect(fixtureResearch.getExperiment("ghost")).rejects.toThrow("unknown experiment: ghost");
    await expect(fixtureResearch.getSamples("ghost")).rejects.toThrow("unknown run: ghost");
    await expect(fixtureResearch.compare(["run-a", "ghost"])).rejects.toThrow("unknown run: ghost");
  });

  it("is selected by configuration, never by a component", () => {
    expect(researchAdapterFromEnv({ VITE_XTRM_RESEARCH: "fixture" })).toBe(fixtureResearch);
    expect(researchAdapterFromEnv({})).toBe(liveResearch);
    expect(fixtureResearch.source).toBe("fixture");
    expect(liveResearch.source).toBe("live");
  });
});

describe("tail resume contract over the captured fixture", () => {
  // `xtrm-research tail` filters on `seq > --after` and reports next_offset as the
  // highest seq returned (cli/main.py). Replaying from a recorded next_offset must
  // therefore neither repeat nor skip an event.
  const all = fixture.tailA.events;
  const page = (after: number) => {
    const events = all.filter((e) => e.seq > after);
    return { events, nextOffset: events.length ? Math.max(...events.map((e) => e.seq)) : after };
  };

  it("partitions the event stream exactly when replayed page by page", () => {
    const seen: number[] = [];
    let cursor = -1;
    for (let guard = 0; guard < 10; guard++) {
      const { events, nextOffset } = page(cursor);
      if (events.length === 0) break;
      seen.push(...events.map((e) => e.seq));
      cursor = nextOffset;
    }
    expect(seen).toEqual(all.map((e) => e.seq));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("returns nothing and holds the cursor once the stream is drained", async () => {
    const { nextOffset } = await fixtureResearch.tail("run-a");
    expect(page(nextOffset)).toEqual({ events: [], nextOffset });
  });

  it("drops exactly the acknowledged prefix when resuming mid-stream", () => {
    expect(page(0).events.map((e) => e.seq)).toEqual([1, 2]);
    expect(page(-1).events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });
});
