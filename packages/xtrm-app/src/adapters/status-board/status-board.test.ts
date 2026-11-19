import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptersFromEnv, fixtureAdapters } from "../index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter, fixtureStatusBoard } from "./fixture.ts";
import { RECORD_CACHE_MS, createStatusBoardLiveAdapter, mapBoardNext, mapFollowUp, mapProposal, mapScheduleDay, mapStatusRow, normaliseDoc } from "./live.ts";
import { StatusBoardError, type BoardGap } from "./types.ts";

// The bridge is the only reader of the board; these tests exercise the adapter boundary against
// wire shapes copied from server/status-board-api.ts, never against the network.

const REPO = "mercury/market-data";

type Reply = { status: number; body: unknown };

function responder(reply: (url: string) => Reply) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = reply(url);
    return { status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const listBody = (records: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  records,
  truncated: false,
  cachedAt: "2026-11-17T22:00:00.000Z",
  ...extra,
});

const wire = (path: string, doc: unknown, id = `rec-${path}`) => ({ path, id, updatedAt: "2026-11-17T21:00:00.000Z", doc });

/** A successful `/list` reply: HTTP status plus the bridge's page body. */
const okPage = (records: unknown[], extra: Record<string, unknown> = {}): Reply => ({ status: 200, body: listBody(records, extra) });

const gapsFor = (gaps: BoardGap[], field: string) => gaps.filter((g) => g.field === field);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("statusBoard live adapter: page assembly", () => {
  it("normalises a string doc and an object doc to the same record", async () => {
    const doc = { name: "board-worker", status: "working", claimUntil: "2026-11-17T23:30:00.000Z", ctxPct: 42 };
    const { fetchImpl, calls } = responder(() => okPage([wire("workers/board-worker", doc), wire("workers/board-worker-string", JSON.stringify({ ...doc, name: "board-worker" }))]));
    const adapter = createStatusBoardLiveAdapter({ fetchImpl });

    const page = await adapter.listWorkers(REPO);

    expect(page.records).toHaveLength(2);
    expect(page.records[0]!.doc).toEqual(page.records[1]!.doc);
    expect(page.records[0]!.doc).toEqual(doc);
    expect(page.gaps).toEqual([]);
    expect(page.truncated).toBe(false);
    expect(page.cachedAt).toBe("2026-11-17T22:00:00.000Z");
    expect(calls[0]).toContain("/xtrm-api/status-board/list?");
    expect(calls[0]).toContain("prefix=workers");
    expect(calls[0]).toContain("repo=mercury%2Fmarket-data");
  });

  it("surfaces the bridge's truncation instead of pretending the list is complete", async () => {
    const { fetchImpl, calls } = responder(() => okPage([wire("workers/a", { status: "idle" })], { truncated: true }));
    // The bound is 1000 records: the answers collection passed the old 200-record ceiling.
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listWorkers(REPO, { limit: 5000 });
    expect(page.truncated).toBe(true);
    expect(calls[0]).toContain("limit=1000");
  });

  it("clamps a limit below the bridge minimum", async () => {
    const { fetchImpl, calls } = responder(() => okPage([]));
    await createStatusBoardLiveAdapter({ fetchImpl }).listWorkers(REPO, { limit: 0 });
    expect(calls[0]).toContain("limit=1");
  });

  it("flags an unusable declared field instead of coercing it to text", async () => {
    const { fetchImpl } = responder(() => okPage([wire("workers/odd", { status: 7, claimUntil: { at: "soon" } })]));
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listWorkers(REPO);
    const worker = page.records[0]!.doc;
    expect(worker.status).toBeUndefined();
    expect(worker.claimUntil).toBeUndefined();
    expect(gapsFor(page.gaps, "status").map((g) => g.value)).toEqual(["7"]);
  });

  it("keeps missing optional fields absent rather than empty", async () => {
    const { fetchImpl } = responder(() => okPage([wire("workers/sre-ops", { status: "idle" })]));
    const worker = (await createStatusBoardLiveAdapter({ fetchImpl }).listWorkers(REPO)).records[0]!.doc;
    expect(worker.name).toBe("sre-ops");
    expect("where" in worker).toBe(false);
    expect("claimUntil" in worker).toBe(false);
    expect("ctxPct" in worker).toBe(false);
  });

  it("assembles day documents into one day-tagged event list and flags unknown kinds", async () => {
    const { fetchImpl } = responder(() =>
      okPage([
        wire("schedule/2026-11-17", { date: "2026-11-17", events: [{ id: "evt-1", kind: "window", at: "2026-11-17T09:00:00.000Z" }] }),
        wire("schedule/2026-11-18", [{ kind: "mystery", label: "unknown kind" }, { label: "no kind" }]),
        wire("schedule/2026-11-19", { id: "evt-3", kind: "pr", ref: "XTRM-816" }),
      ]),
    );
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listSchedule(REPO);

    expect(page.records.map((r) => r.doc.day)).toEqual(["2026-11-17", "2026-11-18", "2026-11-18", "2026-11-19"]);
    expect(page.records[1]!.doc.kind).toBe("mystery");
    expect(page.records[2]!.doc.kind).toBeUndefined();
    expect(page.records[3]!.doc).toMatchObject({ id: "evt-3", kind: "pr", ref: "XTRM-816" });
    const gaps = gapsFor(page.gaps, "kind");
    expect(gaps.map((g) => g.value)).toEqual(["mystery", "<absent>"]);
  });

  it("fans a questions/<owner> document's rows out to one question per row, and keeps a flat document whole", async () => {
    const { fetchImpl } = responder(() =>
      okPage([
        wire("questions/MMD-4417-engine-lead", {
          from: "MMD-4417-engine-lead",
          rows: [
            { id: "q-1", ref: "MMD-2331", by: "operator", q: "keep the tick folder?", rec: "yes", why: "archival", at: "2026-11-17T20:00:00.000Z" },
            { id: "q-2", ref: "MMD-2332", q: "restart the engine?" },
          ],
        }),
        // An owner document with no open question contributes nothing and no gap.
        wire("questions/quant-lead", { from: "quant-lead", rows: [] }),
        // A document written before the rows shape still maps as one question keyed by its path.
        wire("questions/legacy-owner", { ref: "MMD-2300", q: "flat question", owner: "legacy-owner" }),
      ]),
    );
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listQuestions(REPO);

    expect(page.records).toHaveLength(3);
    expect(page.records.map((r) => r.doc.id)).toEqual(["q-1", "q-2", "legacy-owner"]);
    // The owner document is the grouping key even when a row omits an owner of its own.
    expect(page.records.map((r) => r.doc.owner)).toEqual(["MMD-4417-engine-lead", "MMD-4417-engine-lead", "legacy-owner"]);
    expect(page.records[0]!.doc).toEqual({ id: "q-1", owner: "MMD-4417-engine-lead", ref: "MMD-2331", by: "operator", q: "keep the tick folder?", rec: "yes", why: "archival", at: "2026-11-17T20:00:00.000Z" });
    expect(page.gaps).toEqual([]);
  });

  it("reports a questions document whose rows are not an array, and a row that is not an object", async () => {
    const { fetchImpl } = responder(() =>
      okPage([wire("questions/broken", { rows: { id: "q-1" } }), wire("questions/partial", { rows: [{ id: "q-2" }, "not a row"] })]),
    );
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listQuestions(REPO);

    expect(page.records.map((r) => r.doc.id)).toEqual(["q-2"]);
    expect(gapsFor(page.gaps, "rows").map((g) => g.value)).toEqual([JSON.stringify({ id: "q-1" })]);
    expect(gapsFor(page.gaps, "rows[1]").map((g) => g.value)).toEqual(["not a row"]);
  });

  it("reports a row without a usable id as a gap instead of inventing one", async () => {
    const { fetchImpl } = responder(() =>
      okPage([wire("questions/odd", { rows: [{ q: "no id at all" }, { id: 7, q: "numeric id" }, { id: "q-good", q: "fine" }] })]),
    );
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listQuestions(REPO);
    // The id is the answer key, so an unusable one cannot be answered: the row is a gap, not a
    // synthetic `owner#index` id that no `answers/<qid>` record could ever match.
    expect(page.records.map((record) => record.doc.id)).toEqual(["q-good"]);
    expect(gapsFor(page.gaps, "id").map((gap) => gap.value)).toEqual(["<absent>", "7"]);
  });

  it("reports an unparseable document as a gap instead of an empty record", () => {
    const { doc, gap } = normaliseDoc("workers/broken", "{not json");
    expect(doc).toEqual({});
    expect(gap).toEqual({ path: "workers/broken", field: "doc", value: "unparseable json" });
    expect(mapScheduleDay(wire("schedule/2026-11-17", "}{")).gaps).toHaveLength(1);
  });
});

describe("statusBoard live adapter: binding and health", () => {
  it("reports an unbound repository rather than throwing", async () => {
    const { fetchImpl } = responder(() => ({ status: 404, body: { ok: false, configured: false, reason: "repo_not_bound", repository: REPO, resolvedBy: "none" } }));
    const adapter = createStatusBoardLiveAdapter({ fetchImpl });

    const binding = await adapter.binding(REPO);
    expect(binding).toMatchObject({ repository: REPO, configured: false, reason: "repo_not_bound", resolvedBy: "none", statusBoard: null, jira: null });

    const health = await adapter.health(REPO);
    expect(health.configured).toBe(false);
    expect(health.reason).toBe("repo_not_bound");
    expect(health.lastSyncOkAt).toBeNull();
    expect(health.unitActive).toBeNull();
    expect(health.checkedAt).toBeTruthy();
  });

  it("maps a configured binding without a credential value", async () => {
    const { fetchImpl } = responder(() => ({
      status: 200,
      body: {
        ok: true,
        binding: {
          repository: REPO,
          configured: true,
          resolvedBy: "repo_slug",
          pmProject: "market-data",
          substrateProjectId: "market-data",
          configPresent: true,
          site: "board.here.now",
          stateDir: "/home/operator/.xtrm/product/market-data",
          keyFile: "/home/operator/.herenow/credentials",
          keyPresent: true,
          unit: "status-board-sync.service",
          timezone: "Europe/Lisbon",
          jira: { site: "https://example.atlassian.net", project: "ISSUE", boardId: "7", tokenFile: "/home/operator/.config/jira" },
        },
      },
    }));
    const binding = await createStatusBoardLiveAdapter({ fetchImpl }).binding(REPO);
    expect(binding.configured).toBe(true);
    expect(binding.statusBoard).toMatchObject({ site: "board.here.now", timezone: "Europe/Lisbon", keyFile: "/home/operator/.herenow/credentials", keyPresent: true });
    expect(binding.jira).toEqual({ site: "https://example.atlassian.net", project: "ISSUE" });
    expect(JSON.stringify(binding)).not.toContain("Bearer");
  });

  it("keeps an unverified sync unverified, with its reason", async () => {
    const { fetchImpl } = responder(() => ({
      status: 200,
      body: {
        ok: true,
        health: {
          configured: true,
          reason: null,
          site: "board.here.now",
          stateDir: "/tmp/state",
          scheduleActive: null,
          scheduleActiveReason: "probe_timeout",
          runInProgress: false,
          runInProgressReason: null,
          timerUnit: "status-board-sync.timer",
          unitActive: null,
          unitActiveReason: "probe_timeout",
          lastSyncOkAt: "2026-11-17T21:56:00.000Z",
          driftCount: 2,
          stale: false,
          checkedAt: "2026-11-17T22:00:00.000Z",
        },
      },
    }));
    const health = await createStatusBoardLiveAdapter({ fetchImpl }).health(REPO);
    expect(health.unitActive).toBeNull();
    expect(health.unitActiveReason).toBe("probe_timeout");
    expect(health.scheduleActive).toBeNull();
    expect(health.scheduleActiveReason).toBe("probe_timeout");
    expect(health.runInProgress).toBe(false);
    expect(health.driftCount).toBe(2);
  });
});

describe("statusBoard live adapter: error mapping", () => {
  // An unbound repository is not in this table: binding()/health() report it and the data reads
  // answer an empty page / null (MEDIUM 3), so it is covered by the review-fix tests instead.
  const cases: Array<{ name: string; status: number; body: unknown; kind: string }> = [
    { name: "bad request", status: 400, body: { ok: false, error: "unknown collection" }, kind: "bad_request" },
    { name: "credential", status: 503, body: { ok: false, error: "status board credential unavailable" }, kind: "credential" },
    { name: "upstream", status: 502, body: { ok: false, error: "status board read failed" }, kind: "upstream" },
    { name: "inconclusive read", status: 502, body: { ok: false, reason: "inconclusive" }, kind: "upstream" },
  ];

  for (const c of cases) {
    it(`maps ${c.name} to a typed error`, async () => {
      const { fetchImpl } = responder(() => ({ status: c.status, body: c.body }));
      const error = await createStatusBoardLiveAdapter({ fetchImpl })
        .listWorkers(REPO)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StatusBoardError);
      expect((error as StatusBoardError).kind).toBe(c.kind);
      expect((error as StatusBoardError).status).toBe(c.status);
    });
  }

  it("returns null for an absent record and refuses to call an inconclusive read absent", async () => {
    let reply: Reply = { status: 404, body: { ok: false, error: "record not found" } };
    const { fetchImpl } = responder(() => reply);
    const adapter = createStatusBoardLiveAdapter({ fetchImpl });
    expect(await adapter.record(REPO, "workers/nobody")).toBeNull();

    reply = { status: 502, body: { ok: false, reason: "inconclusive" } };
    await expect(adapter.record(REPO, "workers/nobody-2")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("maps a non-JSON bridge body to a malformed error", async () => {
    const fetchImpl = (async () => ({ status: 200, json: async () => Promise.reject(new Error("not json")) })) as unknown as typeof fetch;
    await expect(createStatusBoardLiveAdapter({ fetchImpl }).health(REPO)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("maps an unreachable bridge to an upstream error", async () => {
    const fetchImpl = (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    await expect(createStatusBoardLiveAdapter({ fetchImpl }).listWorkers(REPO)).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("statusBoard live adapter: bounded record cache", () => {
  it("caches a record by path and re-reads after the window", async () => {
    let clock = 1_000;
    const { fetchImpl, calls } = responder(() => ({ status: 200, body: { ok: true, record: wire("board/next", { title: "Overview" }), cachedAt: "2026-11-17T22:00:00.000Z" } }));
    const adapter = createStatusBoardLiveAdapter({ fetchImpl, now: () => clock, cacheMs: RECORD_CACHE_MS });

    const first = await adapter.boardNext(REPO);
    const second = await adapter.boardNext(REPO);
    expect(first?.doc).toEqual({ title: "Overview" });
    expect(second?.doc).toEqual(first?.doc);
    expect(calls).toHaveLength(1);

    clock += RECORD_CACHE_MS + 1;
    await adapter.boardNext(REPO);
    expect(calls).toHaveLength(2);
  });
});


describe("statusBoard mappers: the shapes the deployed store writes", () => {
  // Every document below is copied from a read-only sweep of mercury/market-data (XTRM-906). Each
  // test fails against the previous mapper, which expected one flat document per record.
  it("maps schedule/<day> `events` as the id-keyed map the store writes", () => {
    const mapped = mapScheduleDay(
      wire("schedule/2026-11-25", {
        date: "2026-11-25",
        events: {
          "e_2200_ISSUE-711": {
            at: "2026-11-25T22:00Z",
            end: "2026-11-25T22:59Z",
            ref: "ISSUE-711",
            label: "MMD window: Gate-2 report",
            status: "scheduled",
            note: "22:00-22:59Z",
            note_src: "22:40Z move",
            kind: "window",
            created_by: "sync-jira",
            url: "https://mercuryintel.atlassian.net/browse/ISSUE-711",
          },
          "e_2300_ISSUE-712": { at: "2026-11-25T23:00Z", kind: "pr", title: "Rebuild day", status: "planned" },
        },
      }),
    );
    expect(mapped.value.map((event) => event.id)).toEqual(["e_2200_ISSUE-711", "e_2300_ISSUE-712"]);
    expect(mapped.value[0]).toMatchObject({ day: "2026-11-25", ref: "ISSUE-711", kind: "window", noteSrc: "22:40Z move", createdBy: "sync-jira" });
    // `title` stays its own field; a renderer falls back to it, the mapper never renames it.
    expect(mapped.value[1]).toMatchObject({ title: "Rebuild day" });
    expect(mapped.value[1]!.label).toBeUndefined();
    expect(mapped.gaps).toEqual([]);
  });

  it("keeps a map entry that is not an object as a gap, and maps a flat event document", () => {
    const broken = mapScheduleDay(wire("schedule/2026-11-26", { events: { e_1: "22:00" } }));
    expect(broken.value).toEqual([]);
    expect(broken.gaps).toEqual([{ path: "schedule/2026-11-26", field: "events.e_1", value: "22:00" }]);

    // The pre-map shape (one event per document) still maps.
    const flat = mapScheduleDay(wire("schedule/2026-11-27", { id: "evt-9", kind: "report", label: "Daily close-out" }));
    expect(flat.value).toHaveLength(1);
    expect(flat.value[0]).toMatchObject({ id: "evt-9", kind: "report", day: "2026-11-27" });
  });

  it("maps board/next `rows[]` with key, title, why, window and status", () => {
    const mapped = mapBoardNext(
      wire("board/next", {
        rows: [
          { key: "ISSUE-499", title: "Migrazione", start: "2026-10-29T15:37Z", end: "2026-10-29T16:22Z", why: "Riprogrammata.", status: "Waiting Production" },
          { key: "ISSUE-419", title: "Passata a Waiting Production" },
        ],
      }),
    );
    expect(mapped.value.rows?.map((row) => row.key)).toEqual(["ISSUE-499", "ISSUE-419"]);
    expect(mapped.value.rows?.[0]).toMatchObject({ start: "2026-10-29T15:37Z", end: "2026-10-29T16:22Z", why: "Riprogrammata.", status: "Waiting Production" });
    expect(mapped.gaps).toEqual([]);

    const flat = mapBoardNext(wire("board/next", { title: "Overview", ref: "XTRM-817" }));
    expect(flat.value).toMatchObject({ title: "Overview", ref: "XTRM-817" });
    expect(flat.value.rows).toBeUndefined();
  });

  it("maps status/<session> from/now/next/links, and keeps the flat form", () => {
    // The live board writes each link as a `{label, url}` document; a bare string is the older shape.
    const mapped = mapStatusRow(
      wire("status/wed11-coord", {
        from: "wed11-coord",
        at: "2026-11-14T00:30Z",
        now: "PRD e MAPPA",
        next: "merge the map PR",
        links: [{ label: "Risposta ISSUE-711", url: "https://mercuryintel.atlassian.net/browse/ISSUE-711" }, "ISSUE-906"],
      }),
    );
    expect(mapped.value).toMatchObject({ session: "wed11-coord", from: "wed11-coord", now: "PRD e MAPPA", next: "merge the map PR" });
    expect(mapped.value.links).toEqual([{ label: "Risposta ISSUE-711", url: "https://mercuryintel.atlassian.net/browse/ISSUE-711" }, { label: "ISSUE-906" }]);
    expect(mapped.gaps).toEqual([]);

    expect(mapStatusRow(wire("status/sre-ops", { state: "idle", status: "idle" })).value).toMatchObject({ state: "idle", status: "idle" });
  });

  it("maps proposals/<date> why/deadline/open/slips", () => {
    const mapped = mapProposal(
      wire("proposals/2026-10-29", {
        title: "Piano del 29-10",
        why: "Stato dei prossimi giorni.",
        deadline: "Scadenza rigida: 2026-11-05.",
        open: ["PR #940 e #1117 in attesa.", "ISSUE-564: nessuno slot."],
        slips: [{ ref: "ISSUE-561", to: "2026-10-30 14:22Z", why: "apply fermato" }, { ref: "ISSUE-499", to: "2026-10-29 15:37Z" }],
      }),
    );
    expect(mapped.value).toMatchObject({ why: "Stato dei prossimi giorni.", deadline: "Scadenza rigida: 2026-11-05." });
    expect(mapped.value.open).toHaveLength(2);
    expect(mapped.value.slips).toEqual([
      { ref: "ISSUE-561", to: "2026-10-30 14:22Z", why: "apply fermato" },
      { ref: "ISSUE-499", to: "2026-10-29 15:37Z" },
    ]);
    expect(mapped.gaps).toEqual([]);

    const broken = mapProposal(wire("proposals/2026-10-30", { slips: ["ISSUE-561"] }));
    expect(broken.value.slips).toEqual([]);
    expect(broken.gaps).toEqual([{ path: "proposals/2026-10-30", field: "slips[0]", value: "ISSUE-561" }]);
  });

  it("keeps a follow-up's note and at, which the board writes for held commitments", () => {
    const mapped = mapFollowUp(wire("followups/opencode-go-quota", { note: "weekly limit hit 2026-10-29T23:01Z", at: "2026-10-29T22:15Z", when: "next week" }));
    expect(mapped.value).toMatchObject({ ref: "opencode-go-quota", note: "weekly limit hit 2026-10-29T23:01Z", at: "2026-10-29T22:15Z", when: "next week" });
    expect(mapped.gaps).toEqual([]);
  });
});

describe("statusBoard fixture adapter", () => {
  it("serves a realistic slice through the same mappers as the live adapter", async () => {
    const workers = await fixtureStatusBoard.listWorkers(FIXTURE_BOARD_REPO);
    expect(workers.records).toHaveLength(5);
    expect(workers.truncated).toBe(false);
    expect(workers.gaps).toEqual([]);
    expect(workers.records.some((r) => r.doc.claimUntil != null)).toBe(true);
    expect(workers.records.map((r) => r.doc.name)).toContain("board-worker");
    expect(workers.records.some((r) => r.doc.name === "sre-ops" && r.doc.status === "idle")).toBe(true);

    const schedule = await fixtureStatusBoard.listSchedule(FIXTURE_BOARD_REPO);
    const days = new Set(schedule.records.map((r) => r.doc.day));
    expect(days.size).toBe(3);
    expect(schedule.gaps).toEqual([]);
    expect(new Set(schedule.records.map((r) => r.doc.kind))).toEqual(new Set(["window", "report", "handover", "pr", "incident"]));

    const questions = await fixtureStatusBoard.listQuestions(FIXTURE_BOARD_REPO);
    // One record per question row, not per owner document: 3 rows across 2 owners, the empty owner none.
    expect(questions.records).toHaveLength(3);
    expect(questions.records.map((r) => r.doc.owner)).toEqual(["MMD-4417-engine-lead", "MMD-4417-engine-lead", "sre-ops"]);
    expect(questions.records.every((r) => r.doc.id && r.doc.ref && r.doc.q)).toBe(true);
    expect(questions.gaps).toEqual([]);
    expect((await fixtureStatusBoard.listFollowUps(FIXTURE_BOARD_REPO)).records).toHaveLength(2);
    expect((await fixtureStatusBoard.listFollowUps(FIXTURE_BOARD_REPO)).records[0]!.doc.refs).toEqual(["XTRM-815", "XTRM-317"]);
    expect((await fixtureStatusBoard.listAnswers(FIXTURE_BOARD_REPO)).records).toHaveLength(3);
    expect((await fixtureStatusBoard.listStatus(FIXTURE_BOARD_REPO)).records).toHaveLength(2);
    expect((await fixtureStatusBoard.listProposals(FIXTURE_BOARD_REPO)).records).toHaveLength(1);
    // board/next is the store's `rows[]` document, not one flat pointer.
    const next = await fixtureStatusBoard.boardNext(FIXTURE_BOARD_REPO);
    expect(next?.doc.rows?.map((row) => row.key)).toEqual(["XTRM-817", "XTRM-820", "XTRM-821"]);
    expect(next?.doc.rows?.[1]).toMatchObject({ status: "Blocked", why: "waiting for the reference resolution" });

    const record = await fixtureStatusBoard.record(FIXTURE_BOARD_REPO, "workers/board-worker");
    expect(record?.doc).toMatchObject({ status: "working", ctxPct: 42 });
    expect(await fixtureStatusBoard.record(FIXTURE_BOARD_REPO, "workers/nobody")).toBeNull();
  });

  it("reports a repository without a binding as unbound", async () => {
    const adapter = createStatusBoardFixtureAdapter({ repository: FIXTURE_BOARD_REPO });
    const other = "xtrm-dev/xtrm";

    expect(await adapter.binding(other)).toMatchObject({ configured: false, reason: "repo_not_bound", statusBoard: null });
    expect((await adapter.health(other)).configured).toBe(false);
    expect((await adapter.listWorkers(other)).records).toEqual([]);
    expect(await adapter.boardNext(other)).toBeNull();
    expect((await adapter.binding(FIXTURE_BOARD_REPO.toUpperCase())).configured).toBe(true);
  });

  it("makes no network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const adapter = createStatusBoardFixtureAdapter({ now: () => Date.parse("2026-11-17T22:00:00.000Z") });
    await adapter.health(FIXTURE_BOARD_REPO);
    await adapter.listWorkers(FIXTURE_BOARD_REPO);
    await adapter.listSchedule(FIXTURE_BOARD_REPO);
    await adapter.binding(FIXTURE_BOARD_REPO);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("statusBoard registration", () => {
  it("is selected by configuration, defaulting to the fixture", () => {
    expect(adaptersFromEnv({}).statusBoard.source).toBe("fixture");
    expect(adaptersFromEnv({ VITE_XTRM_STATUS_BOARD: "live" }).statusBoard.source).toBe("live");
    expect(fixtureAdapters.statusBoard.source).toBe("fixture");
  });
});

describe("statusBoard review fixes (#419)", () => {
  it("surfaces an unparseable record document as a gap instead of an empty doc (MEDIUM 1)", async () => {
    const { fetchImpl } = responder(() => ({ status: 200, body: { ok: true, record: wire("board/next", "}{") } }));
    const adapter = createStatusBoardLiveAdapter({ fetchImpl });

    const record = await adapter.record(REPO, "board/next");
    expect(record?.doc).toEqual({});
    expect(record?.gaps).toEqual([{ path: "board/next", field: "doc", value: "unparseable json" }]);

    // boardNext maps the same document and must keep carrying that gap.
    const next = await adapter.boardNext(REPO);
    expect(next?.gaps).toEqual([{ path: "board/next", field: "doc", value: "unparseable json" }]);
  });

  it("flags every declared field carried in the wrong type (MEDIUM 2)", async () => {
    const { fetchImpl } = responder(() => okPage([wire("workers/odd", { claimUntil: 1_730_000_000, milestoneAt: 1_730_000_001, ctxPct: "42" })]));
    const page = await createStatusBoardLiveAdapter({ fetchImpl }).listWorkers(REPO);

    expect(page.records[0]!.doc.claimUntil).toBeUndefined();
    expect(page.records[0]!.doc.milestoneAt).toBeUndefined();
    expect(page.records[0]!.doc.ctxPct).toBeUndefined();
    expect(gapsFor(page.gaps, "claimUntil")).toHaveLength(1);
    expect(gapsFor(page.gaps, "milestoneAt")).toHaveLength(1);
    expect(gapsFor(page.gaps, "ctxPct")[0]!.value).toBe("42");

    const schedule = responder(() => okPage([wire("schedule/2026-11-17", { events: [{ id: "e", kind: "pr", at: 1_730_000_000, end: null }] })]));
    const events = await createStatusBoardLiveAdapter({ fetchImpl: schedule.fetchImpl }).listSchedule(REPO);
    expect(gapsFor(events.gaps, "at")).toHaveLength(1);
    expect(events.records[0]!.doc.at).toBeUndefined();
  });

  it("live and fixture agree for an unbound repository, with no network call (MEDIUM 3)", async () => {
    const unbound = { status: 404, body: { ok: false, configured: false, reason: "repo_not_bound", repository: "xtrm-dev/xtrm", resolvedBy: "none" } };
    const { fetchImpl } = responder(() => unbound);
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const adapters = [createStatusBoardLiveAdapter({ fetchImpl }), createStatusBoardFixtureAdapter()];
    const repo = "xtrm-dev/xtrm";

    for (const adapter of adapters) {
      const binding = await adapter.binding(repo);
      expect(binding.configured).toBe(false);
      expect(binding.reason).toBe("repo_not_bound");
      expect(await adapter.health(repo)).toMatchObject({ configured: false, stale: null, lastSyncOkAt: null });
      expect(await adapter.listWorkers(repo)).toEqual({ records: [], truncated: false, gaps: [], cachedAt: null });
      expect((await adapter.listSchedule(repo)).records).toEqual([]);
      expect(await adapter.record(repo, "workers/board-worker")).toBeNull();
      expect(await adapter.boardNext(repo)).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("caps the record cache and evicts the oldest entry (MEDIUM 4)", async () => {
    let clock = 1_000;
    const { fetchImpl, calls } = responder((url) => ({ status: 200, body: { ok: true, record: wire(new URL(url, "http://local").searchParams.get("path")!, { title: "x" }) } }));
    const adapter = createStatusBoardLiveAdapter({ fetchImpl, cacheMs: 1_000_000, now: () => clock });

    for (let i = 0; i < 501; i += 1) await adapter.record(REPO, `workers/w${i}`);
    expect(calls).toHaveLength(501);

    // The first path was evicted; the newest is still cached.
    await adapter.record(REPO, "workers/w0");
    expect(calls).toHaveLength(502);
    await adapter.record(REPO, "workers/w500");
    expect(calls).toHaveLength(502);
    clock += 1;
  });

  it("turns a binding or health reply without its payload into a typed error (LOW 6)", async () => {
    const binding = responder(() => ({ status: 200, body: { ok: true } }));
    await expect(createStatusBoardLiveAdapter({ fetchImpl: binding.fetchImpl }).binding(REPO)).rejects.toMatchObject({ kind: "malformed" });

    const health = responder(() => ({ status: 200, body: { ok: true } }));
    await expect(createStatusBoardLiveAdapter({ fetchImpl: health.fetchImpl }).health(REPO)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("does not read a missing stale flag as fresh (LOW 7)", async () => {
    const { fetchImpl } = responder(() => ({
      status: 200,
      body: {
        ok: true,
        health: {
          configured: true,
          reason: null,
          site: "board.here.now",
          stateDir: null,
          scheduleActive: true,
          scheduleActiveReason: null,
          runInProgress: false,
          runInProgressReason: null,
          timerUnit: null,
          unitActive: true,
          unitActiveReason: null,
          lastSyncOkAt: null,
          driftCount: 0,
          checkedAt: "2026-11-17T22:00:00.000Z",
        },
      },
    }));
    const health = await createStatusBoardLiveAdapter({ fetchImpl }).health(REPO);
    expect(health.stale).toBeNull();
  });

  it("treats only the bridge's record_not_found as absent (LOW 8)", async () => {
    let reply: Reply = { status: 404, body: { ok: false, error: "record not found" } };
    const { fetchImpl } = responder(() => reply);
    const adapter = createStatusBoardLiveAdapter({ fetchImpl });

    expect(await adapter.record(REPO, "workers/x")).toBeNull();

    reply = { status: 404, body: { ok: false, error: "some other failure" } };
    await expect(adapter.record(REPO, "workers/y")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("keeps the fixture free of the retired vocabulary (LOW 5)", async () => {
    const page = await fixtureStatusBoard.listSchedule(FIXTURE_BOARD_REPO);
    expect(JSON.stringify(page)).not.toContain("Program");
  });
});

describe("statusBoard delta review fixes (#419 delta)", () => {
  it("keeps the board/next field gaps the mapper reports, in both sources", async () => {
    // One wrong-typed declared field: the live adapter used to return the record's parse gap only,
    // so `gaps: []` read like a document that never carried a title.
    const odd = wire("board/next", { title: 5, owner: "board-worker" });
    const { fetchImpl } = responder(() => ({ status: 200, body: { ok: true, record: odd } }));

    const next = await createStatusBoardLiveAdapter({ fetchImpl }).boardNext(REPO);
    expect(next?.doc).toEqual({ owner: "board-worker" });
    expect(gapsFor(next?.gaps ?? [], "title")).toEqual([{ path: "board/next", field: "title", value: "5" }]);

    // The fixture source maps the same document through the same mapper (parity, not a second rule).
    const fromFixture = await createStatusBoardFixtureAdapter({ repository: REPO, records: [odd] }).boardNext(REPO);
    expect(fromFixture?.doc).toEqual(next?.doc);
    expect(fromFixture?.gaps).toEqual(next?.gaps);
  });

  it("rejects a health reply whose checkedAt is missing or is not an ISO instant", async () => {
    const base: Record<string, unknown> = {
      configured: true,
      reason: null,
      scheduleActive: true,
      scheduleActiveReason: null,
      runInProgress: false,
      runInProgressReason: null,
      timerUnit: "status-board-sync.timer",
      unitActive: true,
      unitActiveReason: null,
      lastSyncOkAt: "2026-11-17T21:56:00.000Z",
      driftCount: 0,
      stale: false,
    };

    for (const checkedAt of [undefined, "yesterday", 1_730_000_000, "2026-13-45T00:00:00.000Z"]) {
      const health = checkedAt === undefined ? { ...base } : { ...base, checkedAt };
      const { fetchImpl } = responder(() => ({ status: 200, body: { ok: true, health } }));
      await expect(createStatusBoardLiveAdapter({ fetchImpl }).health(REPO)).rejects.toMatchObject({ kind: "malformed", status: 200 });
    }

    // A real instant with an offset is an ISO instant too: the check is not "must end in Z".
    const { fetchImpl } = responder(() => ({ status: 200, body: { ok: true, health: { ...base, checkedAt: "2026-11-17T23:00:00+01:00" } } }));
    expect((await createStatusBoardLiveAdapter({ fetchImpl }).health(REPO)).checkedAt).toBe("2026-11-17T23:00:00+01:00");
  });
});
