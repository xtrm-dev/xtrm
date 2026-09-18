import { describe, expect, it } from "vitest";
import { readAccounting, readLineage, readVersionRef } from "./manifest.ts";
import fixture from "./__fixtures__/xtrm-research-fixture.json";

describe("manifest readers over the captured fixture", () => {
  const manifest = fixture.runShowA.manifest as Record<string, unknown>;

  it("reads the version ref recorded for the experiment", () => {
    expect(readVersionRef(manifest.experiment)).toEqual({ id: "dup-detect-baseline", version: expect.any(String), contentHash: expect.stringContaining("sha256:") });
  });

  it("reads accounting provenance, never a money figure", () => {
    expect(readAccounting(manifest.accounting)).toEqual({ priceTableVersion: "v1", telemetrySchemaVersion: "v1", otelSemconvRef: "gen_ai/v1.28" });
  });

  it("reads run-b's retry_of lineage entry", () => {
    const manifestB = fixture.runShowB.manifest as Record<string, unknown>;
    expect(readLineage(manifestB.lineage)).toEqual([{ relation: "retry_of", runId: "run-a" }]);
    expect(readLineage(manifest.lineage)).toEqual([]);
  });

  it("returns an explicit null rather than throwing on a malformed or missing block", () => {
    expect(readAccounting(undefined)).toBeNull();
    expect(readAccounting({ price_table_version: "v1" })).toBeNull();
    expect(readVersionRef(null)).toBeNull();
    expect(readLineage(undefined)).toEqual([]);
  });
});

// The readers take `unknown` straight off a passthrough `Record<string, unknown>`, so the
// hostile cases below are reachable in production from a hand-edited or partially-upgraded
// manifest, not only from a test. Contract for all of them (rev 10 item 3): return an explicit
// absent state, never throw, and never a partially populated object that reads as real data.
describe("manifest readers under hostile input", () => {
  const notObjects = [undefined, null, "manifest", 42, true, [], [1, 2]];

  it("returns null for every reader when the value is not an object at all", () => {
    for (const v of notObjects) {
      expect(readVersionRef(v)).toBeNull();
      expect(readAccounting(v)).toBeNull();
    }
  });

  it("returns an empty list for the lineage reader when the value is not an array", () => {
    for (const v of [undefined, null, "lineage", 42, {}, { 0: "x", length: 1 }]) {
      expect(readLineage(v)).toEqual([]);
    }
  });

  it("rejects an accounting block of the wrong type rather than reading a partial one", () => {
    expect(readAccounting([])).toBeNull();
    expect(readAccounting(["v1", "v1", "gen_ai/v1.28"])).toBeNull();
    // Right keys, wrong value types: no field is coerced into a string.
    expect(readAccounting({ price_table_version: 1, telemetry_schema_version: "v1", otel_semconv_ref: "gen_ai/v1.28" })).toBeNull();
    expect(readAccounting({ price_table_version: "v1", telemetry_schema_version: null, otel_semconv_ref: "gen_ai/v1.28" })).toBeNull();
    // The empty string is as absent as null: an empty version identifier is not provenance.
    expect(readAccounting({ price_table_version: "", telemetry_schema_version: "v1", otel_semconv_ref: "gen_ai/v1.28" })).toBeNull();
  });

  it("drops a lineage entry missing its run id, keeping the well-formed entries", () => {
    const lineage = [{ relation: "retry_of" }, { run_id: "run-a" }, { relation: "retry_of", run_id: "run-a" }, null, "retry_of:run-a", { relation: "branch_of", run_id: 7 }];
    expect(readLineage(lineage)).toEqual([{ relation: "retry_of", runId: "run-a" }]);
    // Nothing half-read survives: every returned entry carries both fields as strings.
    for (const entry of readLineage(lineage)) {
      expect(typeof entry.relation).toBe("string");
      expect(typeof entry.runId).toBe("string");
    }
  });

  it("reads through deeply nested nulls without throwing and without half-populating", () => {
    expect(readVersionRef({ id: null, version: null, content_hash: null })).toBeNull();
    expect(readVersionRef({ id: "dup-detect", version: { major: null }, content_hash: "sha256:abc" })).toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    const readers = [readVersionRef, readAccounting, readLineage];
    const hostile = [...notObjects, { toString: null }, Object.create(null), new Date(), Symbol("x"), () => {}];
    for (const read of readers) for (const value of hostile) expect(() => read(value as unknown)).not.toThrow();
  });
});
