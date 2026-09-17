// @vitest-environment node
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readArgv, researchCliApi } from "./research-cli.ts";

const q = (s: string) => new URLSearchParams(s);

describe("research CLI bridge reads: happy paths", () => {
  afterEach(() => {
    delete process.env.XTRM_RESEARCH_REGISTRY_ROOT;
  });

  it("runs, with and without lineage", () => {
    expect(readArgv("/runs", q(""))).toEqual(["runs"]);
    expect(readArgv("/runs", q("lineage=run-0001"))).toEqual(["runs", "--lineage", "run-0001"]);
  });

  it("run show", () => {
    expect(readArgv("/run", q("id=run-0001"))).toEqual(["run", "show", "run-0001"]);
  });

  it("experiment show and workload show, with the registry root from server config", () => {
    process.env.XTRM_RESEARCH_REGISTRY_ROOT = "/srv/registry";
    expect(readArgv("/experiment", q("id=dup-detect-baseline"))).toEqual(["experiment", "show", "dup-detect-baseline", "--registry-root", "/srv/registry"]);
    expect(readArgv("/experiment", q("id=dup-detect-baseline&version=2"))).toEqual([
      "experiment", "show", "dup-detect-baseline", "--registry-root", "/srv/registry", "--version", "2",
    ]);
    expect(readArgv("/workload", q("id=dup-detect"))).toEqual(["workload", "show", "dup-detect", "--registry-root", "/srv/registry"]);
  });

  it("experiment/workload show refuse when the server has no registry root configured", () => {
    expect(readArgv("/experiment", q("id=dup-detect-baseline"))).toBeNull();
    expect(readArgv("/workload", q("id=dup-detect"))).toBeNull();
  });

  it("tail, with and without --after", () => {
    expect(readArgv("/tail", q("run=run-0001"))).toEqual(["tail", "run-0001"]);
    expect(readArgv("/tail", q("run=run-0001&after=0"))).toEqual(["tail", "run-0001", "--after", "0"]);
  });

  it("metrics", () => {
    expect(readArgv("/metrics", q("run=run-0001"))).toEqual(["metrics", "run-0001"]);
  });

  it("compare, one or several runs", () => {
    expect(readArgv("/compare", q("run=run-0001"))).toEqual(["compare", "run-0001"]);
    expect(readArgv("/compare", q("run=run-0001&run=run-0002"))).toEqual(["compare", "run-0001", "run-0002"]);
  });
});

describe("research CLI bridge reads: injection and validation boundary", () => {
  afterEach(() => {
    delete process.env.XTRM_RESEARCH_REGISTRY_ROOT;
  });

  it("rejects shell metacharacters in a run id", () => {
    expect(readArgv("/run", q("id=" + encodeURIComponent("run; rm -rf /")))).toBeNull();
    expect(readArgv("/metrics", q("run=" + encodeURIComponent("run$(whoami)")))).toBeNull();
  });

  it("rejects a leading dash so a value can never become a flag", () => {
    expect(readArgv("/run", q("id=--json"))).toBeNull();
    expect(readArgv("/tail", q("run=" + encodeURIComponent("-1")))).toBeNull();
  });

  it("rejects path traversal in an id", () => {
    expect(readArgv("/run", q("id=" + encodeURIComponent("../../etc/passwd")))).toBeNull();
  });

  it("rejects an embedded flag riding along inside an id", () => {
    expect(readArgv("/run", q("id=" + encodeURIComponent("r1 --root /etc")))).toBeNull();
  });

  it("rejects an over-long id", () => {
    expect(readArgv("/run", q("id=" + "a".repeat(129)))).toBeNull();
    expect(readArgv("/run", q("id=" + "a".repeat(128)))).toEqual(["run", "show", "a".repeat(128)]);
  });

  it("rejects a non-integer offset", () => {
    expect(readArgv("/tail", q("run=run-0001&after=1.5"))).toBeNull();
    expect(readArgv("/tail", q("run=run-0001&after=abc"))).toBeNull();
  });

  it("rejects a negative offset", () => {
    expect(readArgv("/tail", q("run=run-0001&after=" + encodeURIComponent("-1")))).toBeNull();
  });

  it("rejects an offset outside the safe integer bound", () => {
    expect(readArgv("/tail", q("run=run-0001&after=99999999999999999999"))).toBeNull();
  });

  it("rejects a compare request over the run-id cap", () => {
    const runs = Array.from({ length: 20 }, (_, i) => `run-${i}`);
    expect(readArgv("/compare", q(runs.map((r) => `run=${r}`).join("&")))).toEqual(["compare", ...runs]);
    const tooMany = q([...runs, "run-20"].map((r) => `run=${r}`).join("&"));
    expect(readArgv("/compare", tooMany)).toBeNull();
  });

  it("rejects an unknown path", () => {
    expect(readArgv("/run/annotate", q("id=run-0001"))).toBeNull();
    expect(readArgv("/unknown", q(""))).toBeNull();
  });
});

// The raw character is embedded in an id, not percent-encoded.
const idWith = (ch: string) => readArgv("/run", new URLSearchParams([["id", "run" + ch + "a"]]));

describe("research CLI bridge reads: encoding and duplicate parameters", () => {
  // Percent-encodings and control characters are decoded by URLSearchParams before
  // readArgv sees them, so every case below is asserted on the decoded value.
  afterEach(() => {
    delete process.env.XTRM_RESEARCH_REGISTRY_ROOT;
  });

  it("rejects control characters smuggled into an id", () => {
    expect(readArgv("/run", q("id=run%00"))).toBeNull();
    expect(readArgv("/run", q("id=run%0Aid"))).toBeNull();
    // A trailing newline: JS `$` anchors at end of input (unlike Python's `$`), so this is refused.
    expect(readArgv("/run", q("id=run-a%0A"))).toBeNull();
    expect(readArgv("/metrics", q("run=run-a%09b"))).toBeNull();
    expect(idWith(String.fromCharCode(0))).toBeNull();
    expect(idWith(String.fromCharCode(10))).toBeNull();
  });

  it("rejects a right-to-left override in an id", () => {
    expect(readArgv("/run", q("id=run%E2%80%AEa"))).toBeNull();
  });

  it("rejects percent-encoded traversal, single and double encoded", () => {
    // %2e%2e%2f decodes to "../"; %252e%252e%252f stays the literal "%2e%2e%2f".
    expect(readArgv("/run", q("id=%2e%2e%2fetc%2fpasswd"))).toBeNull();
    expect(readArgv("/run", q("id=%252e%252e%252f"))).toBeNull();
  });

  it("rejects full-width lookalike characters", () => {
    // U+FF52 U+FF55 U+FF4E render as "run" but are not ASCII.
    expect(readArgv("/run", q("id=%EF%BD%92%EF%BD%95%EF%BD%8E-a"))).toBeNull();
  });

  it("takes the first value when a scalar parameter is repeated", () => {
    // URLSearchParams.get returns the first occurrence. A later value cannot override
    // a validated earlier one, and each candidate is validated on its own anyway.
    expect(readArgv("/run", q("id=run-0001&id=" + encodeURIComponent("../etc")))).toEqual(["run", "show", "run-0001"]);
    expect(readArgv("/run", q("id=" + encodeURIComponent("../etc") + "&id=run-0001"))).toBeNull();
    expect(readArgv("/tail", q("run=run-0001&after=5&after=9"))).toEqual(["tail", "run-0001", "--after", "5"]);
    expect(readArgv("/tail", q("run=run-0001&after=x&after=5"))).toBeNull();
  });

  it("uses every repeated run on /compare, where repetition is the interface", () => {
    expect(readArgv("/compare", q("run=run-0001&run=run-0001"))).toEqual(["compare", "run-0001", "run-0001"]);
  });

  it("refuses an empty lineage rather than listing every run", () => {
    // `?lineage=` is present-but-empty: not the same as omitting it, and not a valid id.
    expect(readArgv("/runs", q("lineage="))).toBeNull();
    expect(readArgv("/runs", q(""))).toEqual(["runs"]);
  });

  it("refuses an empty version rather than falling back to latest", () => {
    process.env.XTRM_RESEARCH_REGISTRY_ROOT = "/srv/registry";
    expect(readArgv("/experiment", q("id=dup-detect-baseline&version="))).toBeNull();
  });

  it("treats after=0 as a real offset, never as absent", () => {
    expect(readArgv("/tail", q("run=run-0001&after=0"))).toEqual(["tail", "run-0001", "--after", "0"]);
    expect(readArgv("/tail", q("run=run-0001&after="))).toBeNull();
  });
});

// The plugin only exposes its middleware through `configureServer`; capture it the same
// way Vite would, then call it directly with minimal fake req/res objects.
function mountMiddleware(opts: Parameters<typeof researchCliApi>[0]) {
  const plugin = researchCliApi(opts);
  let handle!: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const server = { middlewares: { use: (fn: typeof handle) => (handle = fn) } };
  (plugin.configureServer as (s: typeof server) => void)(server);
  return handle;
}

function fakeReq(url: string, method: string) {
  return { url, method } as unknown as IncomingMessage;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    ended: false,
    body: undefined as string | undefined,
    setHeader: () => undefined,
    end: (b?: string) => {
      res.ended = true;
      res.body = b;
    },
  };
  return res;
}

describe("research CLI bridge: middleware runtime branches", () => {
  it("refuses a non-GET request with 405 before any argv is built", async () => {
    const handle = mountMiddleware({ bin: "true" });
    const res = fakeRes();
    const next = vi.fn();
    await handle(fakeReq("/xtrm-api/research/runs", "POST"), res as unknown as ServerResponse, next);
    expect(res.statusCode).toBe(405);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 with the error body for an unsupported path", async () => {
    const handle = mountMiddleware({ bin: "true" });
    const res = fakeRes();
    await handle(fakeReq("/xtrm-api/research/unknown", "GET"), res as unknown as ServerResponse, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({ ok: false, error: "unsupported research read" });
  });

  it("returns 502 when the spawned command prints no JSON, and never caches a non-200 result", async () => {
    // `true` would satisfy "prints nothing", but proving the TTL cache is skipped needs a
    // side effect: this script also prints nothing on stdout, but counts its own invocations.
    const dir = mkdtempSync(join(tmpdir(), "xtrm-research-bridge-"));
    const counter = join(dir, "count");
    const silentBin = join(dir, "silent.sh");
    writeFileSync(silentBin, `#!/bin/sh\nprintf '.' >> "${counter}"\n`);
    chmodSync(silentBin, 0o755);

    const handle = mountMiddleware({ bin: silentBin });
    const first = fakeRes();
    await handle(fakeReq("/xtrm-api/research/runs", "GET"), first as unknown as ServerResponse, vi.fn());
    expect(first.statusCode).toBe(502);
    expect(JSON.parse(first.body!).ok).toBe(false);
    expect(readFileSync(counter, "utf8")).toBe(".");

    // Same argv, same TTL window: a cached 200 would short-circuit the second spawn.
    const second = fakeRes();
    await handle(fakeReq("/xtrm-api/research/runs", "GET"), second as unknown as ServerResponse, vi.fn());
    expect(second.statusCode).toBe(502);
    expect(readFileSync(counter, "utf8")).toBe("..");
  });
});
