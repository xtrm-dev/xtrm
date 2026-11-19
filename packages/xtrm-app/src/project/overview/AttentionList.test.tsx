import type { Answer, BoardRecord, FollowUp, ProjectHealth, Proposal, Question, Worker } from "../../adapters/status-board/types.ts";
import { describe, expect, it } from "vitest";
import { CLAIM_WINDOW_MS, attentionCounts, buildAttention, isDueToday, unansweredQuestions, workerAttention } from "./AttentionList.tsx";

const record = <T,>(path: string, doc: T): BoardRecord<T> => ({ path, id: path.split("/")[1] ?? null, createdAt: null, updatedAt: null, doc, gaps: [] });
const question = (ref: string, at: string, q = `question ${ref}`) => record<Question>(`questions/${ref}`, { ref, q, at, by: "operator" });
const worker = (name: string, doc: Partial<Worker>) => record<Worker>(`workers/${name}`, { name, ...doc });
const followUp = (ref: string, when?: string) => record<FollowUp>(`followups/${ref}`, { ref, title: `follow-up ${ref}`, when });
const proposal = (id: string, doc: Partial<Proposal>) => record<Proposal>(`proposals/${id}`, { id, ...doc });

const BASE = "/rep/acme/widget";
const iso = (ms: number) => new Date(ms).toISOString();
const localDay = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const DAY = 24 * 60 * 60 * 1000;

const emptyHealth: ProjectHealth = {
  configured: true,
  reason: null,
  lastSyncOkAt: iso(Date.now()),
  driftCount: 0,
  unitActive: true,
  unitActiveReason: null,
  timerUnit: "status-board.timer",
  scheduleActive: true,
  scheduleActiveReason: null,
  runInProgress: false,
  runInProgressReason: null,
  stale: false,
  checkedAt: iso(Date.now()),
};

describe("attention counts", () => {
  it("counts an answered question when `answers/<row.id>` names the question's own id", () => {
    const judged = (id: string, ref: string): BoardRecord<Question> => record<Question>(`questions/owner`, { id, ref, q: `question ${ref}` });
    const questions = [judged("q-104-surface-order", "MMD-4417"), judged("q-105-sync-health", "XTRM-811")];
    // The live board keys answers by the question row id, never by the ticket ref.
    const answers = [record<Answer>("answers/q-104-surface-order", { qid: "q-104-surface-order" })];
    expect(unansweredQuestions(questions, answers).map((entry) => entry.doc.id)).toEqual(["q-105-sync-health"]);
  });

  it("counts an answered question only when `answers/<qid>` names its ref", () => {
    const questions = [question("Q-1", iso(Date.now())), question("Q-2", iso(Date.now())), question("Q-3", iso(Date.now()))];
    const answers = [record<Answer>("answers/Q-1", { qid: "Q-1" }), record<Answer>("answers/Q-9", { qid: "Q-9" })];
    expect(unansweredQuestions(questions, answers).map((q) => q.doc.ref)).toEqual(["Q-2", "Q-3"]);
  });

  it("treats a question without a ref as unanswered, never silently answered", () => {
    const questions = [record<Question>("questions/lead", { q: "no ref", at: iso(Date.now()) })];
    expect(unansweredQuestions(questions, [record<Answer>("answers/lead", { qid: "lead" })])).toHaveLength(1);
  });

  it("counts a worker once when it is blocked and its claim is also inside two hours", () => {
    const now = Date.now();
    const workers = [worker("both", { status: "blocked", claimUntil: iso(now + 10 * 60_000) })];
    expect(workerAttention(workers, now)).toHaveLength(1);
  });

  it("uses the two-hour boundary inclusively and ignores a claim beyond it", () => {
    const now = Date.now();
    const inside = worker("inside", { status: "working", claimUntil: iso(now + CLAIM_WINDOW_MS - 1000) });
    const outside = worker("outside", { status: "working", claimUntil: iso(now + CLAIM_WINDOW_MS + 60_000) });
    const attention = workerAttention([inside, outside], now);
    expect(attention.map((a) => a.worker.doc.name)).toEqual(["inside"]);
  });

  it("keeps a blocked worker with no claim and an unparseable claimUntil as blocked only", () => {
    const workers = [worker("blocked", { status: "blocked" }), worker("broken", { status: "working", claimUntil: "soon" })];
    expect(workerAttention(workers, Date.now()).map((a) => a.worker.doc.name)).toEqual(["blocked"]);
  });
});

describe("due follow-ups", () => {
  it("accepts today's ISO day and the word today, and nothing else", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const today = localDay(now);
    expect(isDueToday(today, now)).toBe(true);
    expect(isDueToday(`${today}T09:00:00Z`, now)).toBe(true);
    expect(isDueToday("today", now)).toBe(true);
    expect(isDueToday(localDay(now + 2 * DAY), now)).toBe(false);
    expect(isDueToday("after XTRM-815", now)).toBe(false);
    expect(isDueToday(undefined, now)).toBe(false);
  });
});

describe("ranking", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const today = localDay(now);
  const input = {
    questions: [question("Q-2", iso(now - 60 * 60_000)), question("Q-1", iso(now - 2 * DAY)), question("Q-answered", iso(now - 3 * DAY))],
    answers: [record<Answer>("answers/Q-answered", { qid: "Q-answered" })],
    workers: [
      worker("worker-b", { status: "blocked", issue: "XTRM-910", milestoneAt: iso(now - 30 * 60_000) }),
      worker("worker-e", { status: "working", issue: "XTRM-911", claimUntil: iso(now + 90 * 60_000) }),
      worker("worker-far", { status: "working", claimUntil: iso(now + 5 * 60 * 60_000) }),
      worker("worker-d", { status: "blocked", claimUntil: iso(now + 10 * 60_000) }),
    ],
    followUps: [followUp("XTRM-912", today), followUp("XTRM-913", "after XTRM-815")],
    proposals: [
      proposal("2026-11-18", { title: "pending with a ref", status: "open", refs: ["XTRM-914"] }),
      proposal("2026-11-17", { title: "pending without a ref", status: "open" }),
      proposal("2026-11-16", { title: "settled", status: "accepted", refs: ["XTRM-915"] }),
    ],
    health: { ...emptyHealth, driftCount: 2 },
    repoBase: BASE,
  };

  it("orders questions oldest first, then blocked, claims, due follow-ups, then awareness", () => {
    const items = buildAttention(input, now);
    expect(items.map((i) => `${i.reason}:${i.subject}`)).toEqual([
      "Question:question Q-1",
      "Question:question Q-2",
      "Blocked:worker-b is blocked",
      "Blocked:worker-d is blocked",
      "Claim expiring:worker-e's claim expires",
      "Follow-up due:follow-up XTRM-912",
      "Drift:2 records have drifted from the board",
      "Proposal:pending with a ref",
    ]);
  });

  it("dedupes a blocked worker's expiring claim into its blocked row", () => {
    const items = buildAttention(input, now);
    expect(items.filter((i) => i.subject.startsWith("worker-d"))).toHaveLength(1);
  });

  it("skips a proposal without a Substrate ref and a follow-up with no due date", () => {
    const items = buildAttention(input, now);
    expect(items.some((i) => i.subject === "pending without a ref")).toBe(false);
    expect(items.some((i) => i.subject === "follow-up XTRM-913")).toBe(false);
    expect(items.some((i) => i.subject === "settled")).toBe(false);
  });

  it("links every row to a surface or a Substrate issue", () => {
    for (const item of buildAttention(input, now)) {
      expect(item.href).toMatch(/^\/rep\/acme\/widget\/(project\/(questions|workers|followups|settings)|work\/issues\/XTRM-\d+)$/);
    }
  });

  it("prints a countdown for an expiring claim, not a negative age", () => {
    const expiring = buildAttention(input, now).find((i) => i.reason === "Claim expiring");
    expect(expiring?.ageLabel).toBe("in 1h 30m");
  });

  it("reports per-reason counts that sum to the list length", () => {
    const items = buildAttention(input, now);
    const counts = attentionCounts(items);
    expect(counts).toMatchObject({ Question: 2, Blocked: 2, "Claim expiring": 1, "Follow-up due": 1, Drift: 1, Proposal: 1, total: 8 });
  });
});
