import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchReadError, liveResearch, mapRunRow, mapTail, unwrap } from "./live.ts";
import type { TailCursor } from "./types.ts";
import fixture from "./__fixtures__/xtrm-research-fixture.json";

// A `TailCursor` can only legitimately come from a prior `TailResult.nextOffset` (mapTail);
// this cast is the test-only escape hatch for exercising the wire format at a chosen value.
const cursorOf = (n: number) => n as unknown as TailCursor;

describe("research envelope unwrap", () => {
  it("rejects a foreign schema", () => {
    expect(() => unwrap({ schema: "other/v9", command: "runs", ok: true, data: [] }, "runs")).toThrow(ResearchReadError);
  });

  it("rejects ok: false with the CLI's error message", () => {
    expect(() => unwrap({ schema: "xtrm-research-cli/v1", command: "run show", ok: false, error: "no such run: 'ghost'" }, "run show")).toThrow("no such run: 'ghost'");
  });

  it("unwraps a healthy envelope", () => {
    expect(unwrap({ schema: "xtrm-research-cli/v1", command: "runs", ok: true, data: ["ok"] }, "runs")).toEqual(["ok"]);
  });
});

describe("mapRunRow: invalid_manifest surfaces as an error row", () => {
  it("maps the captured runs listing, including the corrupted row", () => {
    const rows = fixture.runs.map(mapRunRow);
    expect(rows).toHaveLength(3);
    const [healthy, retried, invalid] = rows;
    expect(healthy).toMatchObject({ id: "run-a", status: "success", experiment: "dup-detect-baseline" });
    expect(retried).toMatchObject({ id: "run-b", status: "error", trigger: "retry" });
    expect(invalid).toEqual({ id: "run-c", status: "invalid_manifest", error: expect.stringContaining("JSONDecodeError") });
    // An invalid_manifest row must not carry the healthy row's fields (no accidental widening).
    expect(invalid).not.toHaveProperty("experiment");
    expect(invalid).not.toHaveProperty("purpose");
  });
});

describe("tail payload round-trip", () => {
  it("maps events and next_offset from the captured tail output", () => {
    const result = mapTail(fixture.tailA);
    expect(result.nextOffset).toBe(2);
    expect(result.events).toEqual([
      { seq: 0, ts: "2026-09-17T12:00:00+00:00", kind: "started", sampleId: null, data: undefined, usage: null },
      {
        seq: 1,
        ts: "2026-09-17T12:00:00+00:00",
        kind: "sample_completed",
        sampleId: "s-0",
        data: undefined,
        usage: { source: "provider_api", inputTokens: 42, outputTokens: 7, requestModel: "always-no-1", responseModel: "always-no-1", latencyMs: 118.5, nullReason: null },
      },
      {
        seq: 2,
        ts: "2026-09-17T12:00:00+00:00",
        kind: "sample_completed",
        sampleId: "s-1",
        data: undefined,
        usage: { source: "unknown", inputTokens: null, outputTokens: null, requestModel: null, responseModel: null, latencyMs: null, nullReason: "usage telemetry unavailable for this backend" },
      },
    ]);
  });

  it("preserves a null sample_id and passes data through untouched", () => {
    const result = mapTail({ events: [{ seq: 5, ts: "2026-01-01T00:00:00Z", kind: "sample", sample_id: "s-1", data: { ok: true } }], next_offset: 5 });
    expect(result.events[0]).toEqual({ seq: 5, ts: "2026-01-01T00:00:00Z", kind: "sample", sampleId: "s-1", data: { ok: true }, usage: null });
  });
});

describe("research envelope unwrap: gaps a consumer would notice", () => {
  it("treats `data: null` as a protocol error naming the command, not as the payload", () => {
    // Fixed: `data: null` can't be a real payload for any verb (all are objects or arrays),
    // so it is rejected the same way a missing `data` is, instead of reaching liveResearch's
    // callers typed as e.g. WireRunRow[] and blowing up on .map with a raw TypeError.
    expect(() => unwrap({ schema: "xtrm-research-cli/v1", command: "runs", ok: true, data: null }, "runs")).toThrow(ResearchReadError);
    expect(() => unwrap({ schema: "xtrm-research-cli/v1", command: "runs", ok: true, data: null }, "runs")).toThrow("runs failed");
  });

  it("rejects a reply for a different verb than the one requested", () => {
    // Fixed: the bridge builds `command`, so a reply naming a different verb than the one
    // the caller asked for is a real protocol error, not something the caller mistyped.
    expect(() => unwrap({ schema: "xtrm-research-cli/v1", command: "metrics", ok: true, data: ["from another verb"] }, "runs")).toThrow(ResearchReadError);
    expect(() => unwrap({ schema: "xtrm-research-cli/v1", command: "metrics", ok: true, data: ["from another verb"] }, "runs")).toThrow(/expected "runs", got "metrics"/);
  });

  it("reports `ok: false` without an error message using the command name", () => {
    expect(() => unwrap({ schema: "xtrm-research-cli/v1", command: "compare", ok: false }, "compare")).toThrow("compare failed");
  });
});

describe("liveResearch read path: non-envelope responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (impl: () => Promise<unknown>) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, json: impl }) as unknown as Response));

  it("turns a non-JSON body into a ResearchReadError naming the status", async () => {
    stubFetch(async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    });
    await expect(liveResearch.listRuns()).rejects.toThrow(ResearchReadError);
    await expect(liveResearch.listRuns()).rejects.toThrow("research bridge returned 502");
  });

  it("surfaces the bridge's own 400 body, which carries no envelope schema", async () => {
    stubFetch(async () => ({ ok: false, error: "unsupported research read" }));
    await expect(liveResearch.getRun("run-a")).rejects.toThrow("unsupported research read");
  });

  it("requests the documented query shape for tail and compare", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const isTail = url.startsWith("/xtrm-api/research/tail");
      const data = isTail ? { events: [], next_offset: 7 } : {};
      const command = isTail ? "tail" : "compare";
      return { status: 200, json: async () => ({ schema: "xtrm-research-cli/v1", command, ok: true, data }) } as unknown as Response;
    }));
    // A cursor of 0 must reach the wire; only omitting `after` entirely means "no offset".
    await liveResearch.tail("run-a", cursorOf(0));
    await liveResearch.tail("run-a");
    await liveResearch.compare(["run-a", "run-b"]);
    expect(calls).toEqual([
      "/xtrm-api/research/tail?run=run-a&after=0",
      "/xtrm-api/research/tail?run=run-a",
      "/xtrm-api/research/compare?run=run-a&run=run-b",
    ]);
  });

  it("a fresh read omits `after` entirely rather than sending a cursor of 0", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return { status: 200, json: async () => ({ schema: "xtrm-research-cli/v1", command: "tail", ok: true, data: { events: [], next_offset: 0 } }) } as unknown as Response;
    }));
    // No cursor argument at all — not a literal 0, which the TailCursor type would reject anyway.
    await liveResearch.tail("run-a");
    expect(calls).toEqual(["/xtrm-api/research/tail?run=run-a"]);
  });
});
