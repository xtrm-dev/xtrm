import { assemblePage, assembleQuestionPage, assembleSchedulePage, mapAnswer, mapBoardNext, mapFollowUp, mapProposal, mapStatusRow, mapWorker, normaliseDoc, recordOf, type WireListBody, type WireRecord } from "./live.ts";
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
  // `schedule/<day>`: the store writes `events` as an id-keyed MAP, two fields in snake_case, and
  // either `label` or `title` on an event. All of that is reproduced, so the fixture cannot pass
  // against a shape the deployed board does not use.
  const schedule: WireRecord[] = [
    record(`schedule/${yesterday}`, {
      date: yesterday,
      events: {
        "e_0900_XTRM-416": { at: iso(now, -DAY + 9 * 60 * MINUTE), kind: "window", label: "Deploy window", status: "done", ref: "XTRM-416", created_by: "manager" },
        "e_1400_XTRM-417": { at: iso(now, -DAY + 14 * 60 * MINUTE), kind: "report", title: "Daily close-out", status: "done", created_by: "lead" },
      },
      updatedAt: iso(now, -DAY),
      updatedBy: "sync",
    }),
    record(
      `schedule/${today}`,
      JSON.stringify({
        date: today,
        events: {
          "e_0830_XTRM-816": { at: iso(now, -60 * MINUTE), kind: "handover", label: "Shift handover", status: "done", created_by: "manager" },
          "e_0945_XTRM-816": {
            at: iso(now, 45 * MINUTE),
            end: iso(now, 75 * MINUTE),
            kind: "pr",
            label: "Project is a repository section",
            status: "ready",
            ref: "XTRM-816",
            note: "45 minutes of review time, then the merge window",
            note_src: "45 minutes of review time",
            url: "https://github.com/xtrm-dev/xtrm/pull/417",
            created_by: "console-lead",
          },
        },
        updatedAt: iso(now, -2 * MINUTE),
        updatedBy: "sync",
      }),
    ),
    record(`schedule/${tomorrow}`, {
      date: tomorrow,
      events: {
        "e_0800_XTRM-811": { at: iso(now, DAY + 8 * 60 * MINUTE), kind: "incident", label: "Board sync review", status: "planned", created_by: "sre-ops" },
      },
      updatedAt: iso(now, -DAY),
      updatedBy: "sync",
    }),
  ];

  // The board files one document per owner; each document's `rows[]` carries the questions
  // (pm_question.py). The long texts and the MMD-style owner names reproduce the operator's board.
  const questions = [
    record("questions/MMD-4417-engine-lead", {
      from: "MMD-4417-engine-lead",
      rows: [
        {
          id: "q-104-surface-order",
          ref: "XTRM-817",
          by: "operator",
          q: "Should the Project Overview ship before the Jira read path, or can both land in one tranche without holding the attention list for a week?",
          rec: "Overview first; Jira in its own issue",
          why: "the attention list is the operator's daily read, and Jira carries the longest dependency chain in the surface",
          at: iso(now, -6 * 60 * MINUTE),
        },
        {
          id: "q-104-board-pressure",
          ref: "XTRM-820",
          by: "operator",
          q: "Does the console show board pressure per repository, or one fleet-wide number?",
          rec: "Per repository",
          why: "each repository binds its own board, so one fleet-wide number would mix two boards",
          at: iso(now, -2 * 60 * MINUTE),
        },
      ],
      updatedAt: added,
      updatedBy: "pm-question",
    }),
    record("questions/sre-ops", {
      from: "sre-ops",
      rows: [{ id: "q-105-sync-health", ref: "XTRM-811", by: "operator", q: "Is the board sync healthy?", at: iso(now, -45 * MINUTE) }],
      updatedAt: added,
      updatedBy: "pm-question",
    }),
    // An owner with no open question: the document exists, its `rows` are empty.
    record("questions/quant-lead", { from: "quant-lead", rows: [], updatedAt: iso(now, -DAY), updatedBy: "pm-question" }),
  ];
  // Answers are keyed by the question's own id (`answers/<qid>`); the third answers a question the
  // board no longer carries, which is what the live board looks like after a close.
  const answers = [
    record("answers/q-104-surface-order", { qid: "q-104-surface-order", answer: "Overview first", comment: "XTRM-817", at: iso(now, -30 * MINUTE), by: "console-lead" }),
    record("answers/q-105-sync-health", { qid: "q-105-sync-health", answer: "Healthy; drift per repository", at: iso(now, -20 * MINUTE), by: "sre-ops" }),
    record("answers/q-999-retired", { qid: "q-999-retired", answer: "yes", at: iso(now, -2 * DAY), by: "manager" }),
  ];
  const followups = [
    record("followups/XTRM-820", { ref: "XTRM-820", title: "Jira chips on issue pages", plain: "show the linked Jira issue", status: "open", priority: "P2", area: "console", owner: "quant-reviewer", when: "after XTRM-815", refs: ["XTRM-815", "XTRM-317"] }),
    record("followups/XTRM-821", { ref: "XTRM-821", title: "Answer writing", plain: "answer a board question from the app", status: "deferred", priority: "P3", area: "console", owner: "operator", refs: ["XTRM-820", "XTRM-816"], note: "held until the read-only tranche closes; answers still go through the board UI", at: iso(now, -90 * MINUTE) }),
  ];
  // `status/<session>`: `{from, at, now, next, links}` — the long prose the operator reads.
  const status = [
    record("status/board-worker", {
      from: "board-worker",
      at: iso(now, -4 * MINUTE),
      now: "Composing the Overview from the attention list; the question count is the only number still open.",
      next: "Wire the proposal slips once the adapter reads the real proposals shape.",
      links: [{ label: "Project Overview", url: "https://github.com/xtrm-dev/xtrm/issues" }, { label: "XTRM-817" }],
    }),
    record("status/sre-ops", { from: "sre-ops", at: iso(now, -9 * MINUTE), now: "Board sync green; drift checked at the last pass." }),
  ];
  // `board/next`: one document whose `rows[]` carry the pointer, each with its own key and reason.
  const board = [
    record("board/next", {
      rows: [
        { key: "XTRM-817", title: "Project Overview lands on the fixture first", status: "Working", why: "the operator's daily read depends on it" },
        { key: "XTRM-820", title: "Jira read path", status: "Blocked", why: "waiting for the reference resolution", start: iso(now, -5 * MINUTE) },
        { key: "XTRM-821", title: "Answer writing", status: "Deferred", why: "after the read-only tranche" },
      ],
      updatedAt: iso(now, -5 * MINUTE),
      updatedBy: "manager",
    }),
  ];
  // `proposals/<date>`: title/why/deadline/open/slips, the store's own proposal shape.
  const proposals = [
    record("proposals/2026-11-17", {
      title: "Project is a repository section",
      why: "one console for the board, the workers and the questions that wait on the operator",
      deadline: "Scadenza rigida: 2026-11-21",
      open: ["Should answering land before the Jira read path?", "Does the attention list show every repository?"],
      slips: [{ ref: "XTRM-820", to: "2026-11-20", why: "the Jira client lands one tranche later" }],
      updatedAt: iso(now, -3 * 60 * MINUTE),
      updatedBy: "operator",
    }),
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
  /**
   * Test seam: replace the fixture documents wholesale, so a test can prove both sources map the
   * very same odd document the same way (the fixture is otherwise fixed content).
   */
  records?: WireRecord[];
}

export function createStatusBoardFixtureAdapter(opts: FixtureStatusBoardOptions = {}): StatusBoardAdapter {
  const integrated = (opts.repository ?? FIXTURE_BOARD_REPO).toLowerCase();
  const now = opts.now ?? Date.now;
  const docs = (): WireRecord[] => opts.records ?? documents(now);
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
    listQuestions: (repository) => {
      if (!boundFor(repository)) return Promise.resolve(assembleQuestionPage(page([])));
      return Promise.resolve(assembleQuestionPage(page(byPrefix(docs(), "questions"), iso(now, -4 * MINUTE))));
    },
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
