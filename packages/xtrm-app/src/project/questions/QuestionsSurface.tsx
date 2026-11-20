import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import type { Answer, BoardRecord, Question } from "../../adapters/status-board/types.ts";
import { useShell } from "../../shell/context.tsx";
import { Icon } from "../../ui/icon.tsx";
import { ErrorState, LoadingState } from "../../ui/primitives.tsx";
import { IntegrationState } from "../IntegrationState.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { QuestionRow } from "./QuestionRow.tsx";

/**
 * Project Questions (ADR-002 D2, XTRM-899, XTRM-913): the board's open questions, split into the
 * ones that still need an answer and the ones that already have one, each grouped by the owner
 * whose `questions/<owner>` document carries them, each with its ref, text, recommendation, why,
 * age and whether an `answers/<qid>` record exists.
 *
 * The unanswered section leads: it is the operator's work, so it stays open. The answered section
 * follows, collapsed by default with its count, so a board that is mostly answered does not push
 * the open questions off the first screen. Both sections keep the owner grouping.
 *
 * Read-only for this tranche: answering stays on the status board until XTRM-821. The surface
 * therefore offers no control that writes, and the state line says where the answer goes.
 */

interface QuestionGroup {
  owner: string;
  rows: Question[];
}

/** The row's own instant; a question without one sorts after the dated rows, never first. */
function questionAt(question: Question): number {
  const parsed = question.at ? Date.parse(question.at) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/** The owner document the board filed the question under, or the fallback the list states. */
function ownerOf(question: Question): string {
  return question.owner ?? question.by ?? "no owner";
}

/**
 * Group by the owner document the board filed the question under. Inside a group the
 * longest-waiting question comes first (the same oldest-first reading the Overview attention list
 * uses for unanswered questions); the groups themselves are ordered by their own oldest question,
 * so a section reads oldest first while the owner grouping stays intact. A tie falls back to the
 * owner name, which keeps the order stable between reads.
 */
function groupQuestions(questions: ReadonlyArray<Question>): QuestionGroup[] {
  const buckets = new Map<string, Question[]>();
  for (const question of questions) {
    const owner = ownerOf(question);
    buckets.set(owner, [...(buckets.get(owner) ?? []), question]);
  }
  return [...buckets.entries()]
    .map(([owner, rows]) => ({ owner, rows: rows.sort((a, b) => questionAt(a) - questionAt(b) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => questionAt(a.rows[0]!) - questionAt(b.rows[0]!) || a.owner.localeCompare(b.owner));
}

/** The question ids the board has an `answers/<qid>` record for. */
function answeredQids(answers: ReadonlyArray<BoardRecord<Answer>>): Set<string> {
  const qids = new Set<string>();
  for (const answer of answers) if (answer.doc.qid) qids.add(answer.doc.qid);
  return qids;
}

/**
 * One section's owner groups; the section supplies the split, the ordering and the state. The label
 * names the section as well as the owner, because an owner can carry an unanswered and an answered
 * question at once and two identically named regions leave a screen-reader reader unable to say which
 * one the next control belongs to (XTRM-918).
 */
function QuestionGroups({ groups, answered, section }: { groups: ReadonlyArray<QuestionGroup>; answered: boolean; section: "Unanswered" | "Answered" }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.owner} aria-label={`${section}, owner ${group.owner}`} data-testid="question-group" data-owner={group.owner}>
          <h4 className="flex items-baseline gap-2 px-1.5 pt-2 pb-1 text-xs font-medium text-ink-muted">
            <span className="truncate">{group.owner}</span>
            <span className="shrink-0 text-xs text-ink-faint tabular" data-testid="question-group-count">
              {group.rows.length}
            </span>
          </h4>
          <ul className="flex flex-col">
            {group.rows.map((question) => (
              <QuestionRow key={question.id} question={question} answered={answered} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function QuestionsSurface() {
  const { repo } = useShell();
  const { statusBoard } = useAdapters();
  const repository = repo.fullName;
  const base = `/rep/${repo.owner}/${repo.name}`;

  const binding = useQuery({ queryKey: ["project", "binding", repository], queryFn: () => statusBoard.binding(repository), staleTime: 60_000 });
  const bound = binding.data?.configured === true;
  const health = useQuery({ queryKey: ["project", "health", repository], queryFn: () => statusBoard.health(repository), staleTime: 60_000, enabled: bound });
  const questions = useQuery({ queryKey: ["project", "questions", repository], queryFn: () => statusBoard.listQuestions(repository), staleTime: 60_000, enabled: bound });
  const answers = useQuery({ queryKey: ["project", "answers", repository], queryFn: () => statusBoard.listAnswers(repository), staleTime: 60_000, enabled: bound });

  const rows = (questions.data?.records ?? []).map((record) => record.doc);
  const answered = answeredQids(answers.data?.records ?? []);
  const unansweredRows = rows.filter((question) => !answered.has(question.id));
  const answeredRows = rows.filter((question) => answered.has(question.id));
  const unansweredGroups = groupQuestions(unansweredRows);
  const answeredGroups = groupQuestions(answeredRows);
  const answeredCount = answeredRows.length;
  const ownerCount = new Set(rows.map(ownerOf)).size;

  // A bounded read and an unreadable record both make the list incomplete; the page says so
  // instead of presenting a short page as the whole board.
  const caveats: string[] = [];
  if (questions.data?.truncated) caveats.push(`the questions page stopped at ${rows.length} records; more remain on the board`);
  if (answers.data?.truncated) caveats.push("the answers page stopped at its limit, so some rows may read unanswered");
  const gapCount = (questions.data?.gaps.length ?? 0) + (answers.data?.gaps.length ?? 0);
  if (gapCount > 0) caveats.push(`${gapCount} record${gapCount === 1 ? "" : "s"} could not be read as declared`);

  const shell = (children: ReactNode) => (
    <ProjectShell
      title="Questions"
      binding={binding.data ?? null}
      health={bound ? (health.data ?? null) : null}
      source={statusBoard.source}
      toolbar={
        <span className="text-xs text-ink-faint" data-testid="questions-count" title={`${ownerCount} owners carry an open question`}>
          {rows.length} questions · {answeredCount} answered
        </span>
      }
    >
      {children}
    </ProjectShell>
  );

  if (!bound) return shell(<IntegrationState binding={binding.data ?? null} health={null} base={base} />);
  if (questions.isLoading || answers.isLoading) return shell(<LoadingState label="Loading questions" />);
  // Answer presence is part of what the list states; a failed read must not render every row as unanswered.
  if (questions.error) return shell(<ErrorState title="Questions could not be read" error={questions.error} />);
  if (answers.error) return shell(<ErrorState title="Answers could not be read" error={answers.error} />);

  return shell(
    <div data-testid="questions-list">
      <p className="px-1.5 pt-2 text-xs text-ink-faint" data-testid="questions-read-only">
        Read-only. Answering stays on the status board until XTRM-821.
      </p>
      {caveats.length > 0 && (
        <p className="px-1.5 pt-1 text-xs text-ink-faint" data-testid="questions-caveat">
          Incomplete read: {caveats.join("; ")}.
        </p>
      )}
      {rows.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-faint">No open questions on this board.</p>}
      {unansweredGroups.length > 0 && (
        <section aria-label="Unanswered questions" data-testid="question-section" data-section="unanswered">
          <h3 className="flex items-baseline gap-2 px-1.5 pt-2 pb-1 text-xs font-medium text-ink">
            <span className="truncate">Unanswered</span>
            <span className="shrink-0 text-xs text-ink-faint tabular" data-testid="question-section-count">
              {unansweredRows.length}
            </span>
          </h3>
          <QuestionGroups groups={unansweredGroups} answered={false} section="Unanswered" />
        </section>
      )}
      {answeredGroups.length > 0 && (
        // Native disclosure: closed by default, so the answered backlog never pushes the open
        // questions below the first screen; the summary names the count the reader would find.
        <details data-testid="question-section" data-section="answered" className="group">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 rounded-sm px-1.5 pt-3 pb-1 text-xs font-medium text-ink-muted outline-none select-none hover:text-ink focus-visible:text-ink focus-visible:ring-1 focus-visible:ring-accent/40">
            <Icon name="forward" size="xs" className="shrink-0 self-center text-ink-faint transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            <span className="truncate">Answered</span>
            <span className="shrink-0 text-xs text-ink-faint tabular" data-testid="question-section-count">
              {answeredRows.length}
            </span>
          </summary>
          <QuestionGroups groups={answeredGroups} answered={true} section="Answered" />
        </details>
      )}
    </div>,
  );
}
