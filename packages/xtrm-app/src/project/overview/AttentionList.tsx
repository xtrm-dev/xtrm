import { useNavigate } from "@tanstack/react-router";
import type { Answer, BoardRecord, FollowUp, ProjectHealth, Proposal, Question, Worker } from "../../adapters/status-board/types.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { Row, ago } from "../../ui/primitives.tsx";

/**
 * The attention list (§5 Project): one ranked list of things that need the
 * operator, not a dashboard. The rank order is fixed: an unanswered question,
 * a blocked worker, a claim expiring within two hours, a follow-up due today,
 * then awareness rows (pending proposals, integration drift). Every row links
 * to the surface that owns the record; a row without a live destination is
 * not rendered.
 */

export const CLAIM_WINDOW_MS = 2 * 60 * 60 * 1000;

export type AttentionReason = "Question" | "Blocked" | "Claim expiring" | "Follow-up due" | "Proposal" | "Drift";

export interface AttentionItem {
  id: string;
  reason: AttentionReason;
  /** The line the operator reads: who and what needs a decision. */
  subject: string;
  /** Secondary context, dimmed and truncated. */
  detail: string | null;
  /** Substrate refs carried by the source record, printed as mono keys. */
  refs: string[];
  /** Sort key of the source record (epoch ms); null when the record has no time. */
  at: number | null;
  /** Right-aligned age or countdown word. */
  ageLabel: string;
  href: string;
  /** The destination word after the arrow ("Questions", "Workers", …). */
  section: string;
  tone: BadgeTone;
}

export interface AttentionInput {
  questions: ReadonlyArray<BoardRecord<Question>>;
  answers: ReadonlyArray<BoardRecord<Answer>>;
  workers: ReadonlyArray<BoardRecord<Worker>>;
  followUps: ReadonlyArray<BoardRecord<FollowUp>>;
  proposals: ReadonlyArray<BoardRecord<Proposal>>;
  health: ProjectHealth | null;
  /** `/rep/:owner/:repo`, the base every Project link is relative to. */
  repoBase: string;
}

export type AttentionCounts = Record<AttentionReason, number> & { total: number };

/** The answers path segment is the question ref (`answers/<qid>`), so a question is answered by `ref`. */
export function answeredQids(answers: ReadonlyArray<BoardRecord<Answer>>): Set<string> {
  const qids = new Set<string>();
  for (const answer of answers) if (answer.doc.qid) qids.add(answer.doc.qid);
  return qids;
}

/** `questions/*` rows with no matching `answers/<qid>`. */
export function unansweredQuestions(
  questions: ReadonlyArray<BoardRecord<Question>>,
  answers: ReadonlyArray<BoardRecord<Answer>>,
): BoardRecord<Question>[] {
  const answered = answeredQids(answers);
  return questions.filter((question) => {
    const qid = question.doc.ref;
    return !qid || !answered.has(qid);
  });
}

export interface WorkerAttention {
  worker: BoardRecord<Worker>;
  blocked: boolean;
  /** Parsed `claimUntil`, or null when the worker holds no claim. */
  claimUntil: number | null;
}

/** Workers whose status is `blocked` or whose claim ends within two hours of `now`. */
export function workerAttention(workers: ReadonlyArray<BoardRecord<Worker>>, now: number): WorkerAttention[] {
  const attention: WorkerAttention[] = [];
  for (const worker of workers) {
    const blocked = worker.doc.status === "blocked";
    const parsed = worker.doc.claimUntil ? Date.parse(worker.doc.claimUntil) : Number.NaN;
    const claimUntil = Number.isFinite(parsed) ? parsed : null;
    const expiring = claimUntil !== null && claimUntil <= now + CLAIM_WINDOW_MS;
    if (blocked || expiring) attention.push({ worker, blocked, claimUntil });
  }
  return attention;
}

/** A follow-up is due when the board wrote an explicit date, and that date is today (local day). */
export function isDueToday(when: string | undefined, now: number): boolean {
  const value = when?.trim().toLowerCase();
  if (!value) return false;
  if (value === "today") return true;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  if (!day) return false;
  const date = new Date(now);
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return day === today;
}

const ISSUE_REF = /^[A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*$/;
const SETTLED = new Set(["accepted", "rejected", "done", "closed", "cancelled", "merged"]);

const RANK: Record<AttentionReason, number> = {
  Question: 0,
  Blocked: 1,
  "Claim expiring": 2,
  "Follow-up due": 3,
  Proposal: 4,
  Drift: 4,
};

/** "in 25m" / "expired 10m ago" — a countdown, never a negative relative time. */
export function countdown(target: number, now: number): string {
  const delta = target - now;
  const minutes = Math.round(Math.abs(delta) / 60_000);
  const span = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return delta >= 0 ? `in ${span}` : `expired ${span} ago`;
}

const time = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Sort with "no time" last, then by the given tie-break so the list is stable. */
function byTime(a: number | null, b: number | null, tie: number): number {
  if (a === null && b === null) return tie;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b || tie;
}

export function buildAttention(input: AttentionInput, now: number): AttentionItem[] {
  const project = `${input.repoBase}/project`;
  const items: AttentionItem[] = [];

  const questions = unansweredQuestions(input.questions, input.answers)
    .map((question) => ({
      question,
      at: time(question.doc.at),
      qid: question.doc.ref ?? question.id ?? question.path,
    }))
    .sort((a, b) => byTime(a.at, b.at, a.qid.localeCompare(b.qid)));
  for (const { question, at } of questions) {
    items.push({
      id: `question:${question.id}:${question.doc.ref ?? ""}`,
      reason: "Question",
      subject: question.doc.q ?? "Untitled question",
      detail: [question.doc.by ? `asked by ${question.doc.by}` : null, question.doc.rec ? `→ ${question.doc.rec}` : null].filter(Boolean).join(" · ") || null,
      refs: question.doc.ref ? [question.doc.ref] : [],
      at,
      ageLabel: at === null ? "" : ago(at),
      href: `${project}/questions`,
      section: "Questions",
      tone: "accent",
    });
  }

  const workers = workerAttention(input.workers, now).sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    if (a.blocked) return a.worker.doc.name.localeCompare(b.worker.doc.name);
    return (a.claimUntil ?? Number.POSITIVE_INFINITY) - (b.claimUntil ?? Number.POSITIVE_INFINITY);
  });
  for (const entry of workers) {
    const { worker } = entry;
    const at = time(worker.doc.milestoneAt);
    const blocked = entry.blocked;
    const reason: AttentionReason = blocked ? "Blocked" : "Claim expiring";
    items.push({
      id: `worker:${worker.doc.name}:${reason}`,
      reason,
      subject: blocked ? `${worker.doc.name} is blocked` : `${worker.doc.name}'s claim expires`,
      detail: [worker.doc.task ?? null, blocked ? worker.doc.note ?? null : null].filter(Boolean).join(" · ") || null,
      refs: worker.doc.issue ? [worker.doc.issue] : [],
      at,
      ageLabel: blocked ? (at === null ? "" : ago(at)) : entry.claimUntil === null ? "" : countdown(entry.claimUntil, now),
      href: `${project}/workers`,
      section: "Workers",
      tone: blocked ? "danger" : "neutral",
    });
  }

  const followUps = input.followUps
    .filter((followUp) => isDueToday(followUp.doc.when, now))
    .map((followUp) => ({ followUp, at: time(followUp.doc.when) }))
    .sort((a, b) => byTime(a.at, b.at, a.followUp.doc.ref.localeCompare(b.followUp.doc.ref)));
  for (const { followUp } of followUps) {
    items.push({
      id: `followup:${followUp.doc.ref}`,
      reason: "Follow-up due",
      subject: followUp.doc.title ?? followUp.doc.ref,
      detail: [followUp.doc.owner ? `owner ${followUp.doc.owner}` : null, followUp.doc.status ?? null].filter(Boolean).join(" · ") || null,
      refs: [followUp.doc.ref],
      at: null,
      ageLabel: followUp.doc.when ?? "",
      href: `${project}/followups`,
      section: "Follow-ups",
      tone: "accent",
    });
  }

  // Awareness: drift first (it is integration health), then proposals that still wait on a decision.
  if (input.health?.driftCount) {
    const drift = input.health.driftCount;
    items.push({
      id: "drift",
      reason: "Drift",
      subject: `${drift} ${drift === 1 ? "record has" : "records have"} drifted from the board`,
      detail: "the sync reports records the board does not carry",
      refs: [],
      at: null,
      ageLabel: "",
      href: `${project}/settings`,
      section: "Integration",
      tone: "neutral",
    });
  }

  const proposals = input.proposals
    .filter((proposal) => !SETTLED.has((proposal.doc.status ?? "").toLowerCase()))
    .map((proposal) => {
      const ref = proposal.doc.refs?.find((candidate) => ISSUE_REF.test(candidate)) ?? null;
      return { proposal, ref, at: time(proposal.doc.at) };
    })
    .filter((entry): entry is { proposal: BoardRecord<Proposal>; ref: string; at: number | null } => entry.ref !== null)
    .sort((a, b) => byTime(a.at, b.at, a.ref.localeCompare(b.ref)));
  for (const { proposal, ref, at } of proposals) {
    items.push({
      id: `proposal:${proposal.id}`,
      reason: "Proposal",
      subject: proposal.doc.title ?? proposal.path,
      detail: [proposal.doc.owner ? `from ${proposal.doc.owner}` : null, proposal.doc.status ?? null].filter(Boolean).join(" · ") || null,
      refs: [ref],
      at,
      ageLabel: at === null ? "" : ago(at),
      // The proposal's own Substrate issue is the durable surface; a proposal without one is skipped above.
      href: `${input.repoBase}/work/issues/${ref}`,
      section: "Issue",
      tone: "muted",
    });
  }

  return items.sort((a, b) => RANK[a.reason] - RANK[b.reason]);
}

export function attentionCounts(items: ReadonlyArray<AttentionItem>): AttentionCounts {
  const counts: AttentionCounts = { Question: 0, Blocked: 0, "Claim expiring": 0, "Follow-up due": 0, Proposal: 0, Drift: 0, total: items.length };
  for (const item of items) counts[item.reason] += 1;
  return counts;
}

/** The ranked rows. `Row` carries the navigation; the right column names where the row goes. */
export function AttentionList({ items }: { items: ReadonlyArray<AttentionItem> }) {
  const navigate = useNavigate();
  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-ink-faint" data-testid="attention-empty">
        Nothing needs attention: no unanswered question, no blocked worker, no claim inside two hours, no follow-up due today.
      </p>
    );
  }
  return (
    <ul aria-label="Attention" className="flex flex-col">
      {items.map((item) => (
        <li key={item.id}>
          <Row density="list" title={item.subject} onActivate={() => void navigate({ to: item.href } as never)}>
            <Badge tone={item.tone} size="xs" className="shrink-0">
              {item.reason}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-ink">{item.subject}</span>
            {item.detail && <span className="hidden max-w-[36%] min-w-0 truncate text-xs text-ink-faint lg:block">{item.detail}</span>}
            {item.refs.length > 0 && <span className="shrink-0 font-mono text-xs text-ink-faint">{item.refs.join(" ")}</span>}
            <span className="w-24 shrink-0 text-right text-xs text-ink-faint tabular">{item.ageLabel}</span>
            <span className="w-28 shrink-0 text-right text-xs text-ink-faint">→ {item.section}</span>
          </Row>
        </li>
      ))}
    </ul>
  );
}
