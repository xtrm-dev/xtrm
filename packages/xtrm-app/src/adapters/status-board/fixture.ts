import { assemblePage, assembleSchedulePage, mapAnswer, mapBoardNext, mapFollowUp, mapProposal, mapQuestion, mapStatusRow, mapWorker, normaliseDoc, recordOf, type WireListBody, type WireRecord } from "./live.ts";
import type { BoardGap, BoardNext, BoardRecord, ProjectBinding, ProjectHealth, StatusBoardAdapter, UnboundReason } from "./types.ts";

// A small, realistic slice of the board for one repository (ADR-002 §3 shapes). Content is
// illustrative: fictional workers and issue refs, no operator answer, no credential-derived value.
// Every record goes through the same mappers as the live adapter, so a fixture cannot drift from
// the shapes a component sees against the bridge.

/** The repository the fixture treats as integrated; any other repository is honestly unbound. */
export const FIXTURE_BOARD_REPO = "mercury/market-data";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const iso = (now: () => number, offsetMs: number): string => new Date(now() + offsetMs).toISOString();

const dayKey = (now: () => number, offsetDays: number): string => new Date(now() + offsetDays * DAY).toISOString().slice(0, 10);

const record = (path: string, doc: unknown, updatedAt: string | null = null): WireRecord => ({ path, id: `rec-${path.replace("/", "-")}`, updatedAt, doc });

/**
 * The fixture board. One document is carried as a JSON string on purpose: the store's own shape,
 * and the reason `normaliseDoc` exists.
 */
function documents(now: () => number): WireRecord[] {
  const added = iso(now, -2 * MINUTE);
  const workers: WireRecord[] = [
    record("workers/board-worker", {
      name: "board-worker",
      kind: "worker",
      where: "xtrm-sp-worker-817",
      runtime: "pi",
      issue: "XTRM-817",
      task: "Project Overview and attention list",
      status: "working",
      milestone: "overview",
      milestoneAt: iso(now, 35 * MINUTE),
      ctxPct: 42,
      claimUntil: iso(now, 90 * MINUTE),
      reportsTo: "console-lead",
      note: "implements the first composed Project surface",
    }),
    record("workers/test-engineer", {
      name: "test-engineer",
      kind: "worker",
      where: "xtrm-sp-worker-813",
      runtime: "pi",
      issue: "XTRM-813",
      task: "statusBoard adapter tests",
      status: "idle",
      milestone: "adapter tests",
    }),
    record("workers/quant-reviewer", {
      name: "quant-reviewer",
      kind: "specialist",
      where: "xtrm-sp-quant",
      runtime: "claude",
      issue: "XTRM-820",
      task: "Jira reference resolution",
      status: "blocked",
      milestone: "jira read path",
      claimUntil: iso(now, 25 * MINUTE),
      reportsTo: "console-lead",
      note: "waiting for XTRM-815",
    }),
    record("workers/pr-reviewer", {
      name: "pr-reviewer",
      kind: "specialist",
      where: "xtrm-sp-review",
      runtime: "claude",
      issue: "XTRM-816",
      task: "review PR #417",
      status: "working",
      milestone: "review",
      milestoneAt: iso(now, 10 * MINUTE),
    }),
    // Deliberately sparse: the board omits fields it never set, and so does the fixture.
    record("workers/sre-ops", { status: "idle" }),
  ];

  const today = dayKey(now, 0);
  const tomorrow = dayKey(now, 1);
  const yesterday = dayKey(now, -1);
  const schedule: WireRecord[] = [
    record(`schedule/${yesterday}`, {
      date: yesterday,
      events: [
        { id: "evt-1", at: iso(now, -DAY + 9 * 60 * MINUTE), kind: "window", label: "Deploy window", status: "done", ref: "XTRM-416", createdBy: "manager" },
        { id: "evt-2", at: iso(now, -DAY + 14 * 60 * MINUTE), kind: "report", label: "Daily close-out", status: "done", createdBy: "lead" },
      ],
    }),
    record(
      `schedule/${today}`,
      JSON.stringify({
        date: today,
        events: [
          { id: "evt-3", at: iso(now, -60 * MINUTE), kind: "handover", label: "Shift handover", status: "done", createdBy: "manager" },
          { id: "evt-4", at: iso(now, 45 * MINUTE), end: iso(now, 75 * MINUTE), kind: "pr", label: "Project is a repository section", status: "ready", ref: "XTRM-816", url: "https://github.com/xtrm-dev/xtrm/pull/417", createdBy: "console-lead" },
        ],
      }),
    ),
    record(`schedule/${tomorrow}`, {
      date: tomorrow,
      events: [
        { id: "evt-5", at: iso(now, DAY + 8 * 60 * MINUTE), kind: "incident", label: "Board sync review", status: "planned", createdBy: "sre-ops" },
      ],
    }),
  ];

  const questions = [
    record("questions/console-lead", { ref: "Q-104", by: "operator", q: "Which surface ships first?", rec: "Overview", why: "it unblocks the rest", at: added, owner: "console-lead" }),
    record("questions/sre-ops", { ref: "Q-105", by: "operator", q: "Is the board sync healthy?", at: added, owner: "sre-ops" }),
  ];
  const answers = [
    record("answers/Q-104", { qid: "Q-104", answer: "Overview", comment: "XTRM-817", at: iso(now, -30 * MINUTE), by: "console-lead" }),
    record("answers/Q-103", { qid: "Q-103", answer: "yes", at: iso(now, -2 * DAY), by: "manager" }),
  ];
  const followups = [
    record("followups/XTRM-820", { ref: "XTRM-820", title: "Jira chips on issue pages", plain: "show the linked Jira issue", status: "open", priority: "P2", area: "console", owner: "quant-reviewer", when: "after XTRM-815", refs: ["XTRM-815"] }),
    record("followups/XTRM-821", { ref: "XTRM-821", title: "Answer writing", plain: "answer a board question from the app", status: "deferred", priority: "P3", area: "console", owner: "operator", refs: ["XTRM-820", "XTRM-816"] }),
  ];
  const status = [
    record("status/board-worker", { state: "working", status: "working", issue: "XTRM-817", at: iso(now, -4 * MINUTE), note: "composing Overview" }),
    record("status/sre-ops", { state: "idle", status: "idle", at: iso(now, -9 * MINUTE) }),
  ];
  const board = [record("board/next", { title: "Project Overview lands on the fixture first", owner: "board-worker", ref: "XTRM-817", at: iso(now, -5 * MINUTE) })];
  const proposals = [
    record("proposals/2026-11-17", { at: iso(now, -3 * 60 * MINUTE), title: "Project is a repository section", status: "accepted", owner: "operator", refs: ["XTRM-816"], note: "ADR-002 D1" }),
  ];

  return [...workers, ...schedule, ...questions, ...answers, ...followups, ...status, ...board, ...proposals];
}

function page(records: WireRecord[], cachedAt: string | null = null): WireListBody {
  return { ok: true, records, truncated: false, cachedAt };
}

const byPrefix = (records: WireRecord[], collection: string): WireRecord[] => records.filter((r) => r.path.startsWith(`${collection}/`));

export interface FixtureStatusBoardOptions {
  /** The integrated repository. Defaults to `FIXTURE_BOARD_REPO`. */
  repository?: string;
  now?: () => number;
}

export function createStatusBoardFixtureAdapter(opts: FixtureStatusBoardOptions = {}): StatusBoardAdapter {
  const integrated = (opts.repository ?? FIXTURE_BOARD_REPO).toLowerCase();
  const now = opts.now ?? Date.now;
  const docs = (): WireRecord[] => documents(now);
  const boundFor = (repository: string): boolean => repository.toLowerCase() === integrated;

  const binding = (repository: string): ProjectBinding => {
    const configured = boundFor(repository);
    return {
      repository,
      configured,
      reason: configured ? null : ("repo_not_bound" as UnboundReason),
      resolvedBy: configured ? "repo_slug" : "none",
      pmProject: configured ? "market-data" : null,
      substrateProject: configured ? "market-data" : null,
      statusBoard: configured
        ? {
            site: "fixture-board.here.now",
            stateDir: "/home/operator/.xtrm/product/market-data",
            timezone: "UTC",
            keyFile: "/home/operator/.herenow/credentials",
            keyPresent: true,
          }
        : null,
      jira: configured ? { site: "https://example.atlassian.net", project: "ISSUE" } : null,
    };
  };

  const health = (repository: string): ProjectHealth => {
    if (!boundFor(repository)) {
      return {
        configured: false,
        reason: "repo_not_bound",
        lastSyncOkAt: null,
        driftCount: null,
        unitActive: null,
        unitActiveReason: null,
        timerUnit: null,
        scheduleActive: null,
        scheduleActiveReason: null,
        runInProgress: null,
        runInProgressReason: null,
        // Unbound: no sync was read, so freshness is unknown rather than "not stale".
        stale: null,
        checkedAt: iso(now, 0),
      };
    }
    return {
      configured: true,
      reason: null,
      lastSyncOkAt: iso(now, -4 * MINUTE),
      driftCount: 0,
      unitActive: true,
      unitActiveReason: null,
      timerUnit: "status-board-sync.timer",
      scheduleActive: true,
      scheduleActiveReason: null,
      runInProgress: false,
      runInProgressReason: null,
      stale: false,
      checkedAt: iso(now, 0),
    };
  };

  const lookup = (repository: string, path: string): WireRecord | null => {
    if (!boundFor(repository)) return null;
    const wire = docs().find((r) => r.path === path);
    if (!wire) return null;
    return { ...wire, doc: normaliseDoc(wire.path, wire.doc).doc };
  };

  const record = <T>(repository: string, path: string): Promise<BoardRecord<T> | null> => {
    const wire = lookup(repository, path);
    if (!wire) return Promise.resolve(null);
    const { doc, gap } = normaliseDoc(wire.path, wire.doc);
    return Promise.resolve(recordOf(wire, doc as T, gap ? [gap] : []));
  };

  const list = <T>(repository: string, collection: string, map: (wire: WireRecord) => { value: T; gaps: BoardGap[] }) => {
    const records = boundFor(repository) ? byPrefix(docs(), collection) : [];
    return Promise.resolve(assemblePage(page(records, boundFor(repository) ? iso(now, -4 * MINUTE) : null), map));
  };

  return {
    source: "fixture",
    binding: (repository) => Promise.resolve(binding(repository)),
    health: (repository) => Promise.resolve(health(repository)),
    record,
    listWorkers: (repository) => list(repository, "workers", mapWorker),
    listSchedule: (repository) => {
      if (!boundFor(repository)) return Promise.resolve(assembleSchedulePage(page([])));
      return Promise.resolve(assembleSchedulePage(page(byPrefix(docs(), "schedule"), iso(now, -4 * MINUTE))));
    },
    listQuestions: (repository) => list(repository, "questions", mapQuestion),
    listAnswers: (repository) => list(repository, "answers", mapAnswer),
    listFollowUps: (repository) => list(repository, "followups", mapFollowUp),
    listStatus: (repository) => list(repository, "status", mapStatusRow),
    listProposals: (repository) => list(repository, "proposals", mapProposal),
    async boardNext(repository) {
      const wire = lookup(repository, "board/next");
      if (!wire) return null;
      const mapped: BoardNext = mapBoardNext(wire).value;
      return recordOf(wire, mapped, mapBoardNext(wire).gaps);
    },
  };
}

export const fixtureStatusBoard: StatusBoardAdapter = createStatusBoardFixtureAdapter();
