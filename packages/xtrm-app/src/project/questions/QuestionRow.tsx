import type { Question } from "../../adapters/status-board/types.ts";
import { ReferenceChip } from "../../refs/references.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Row, ago } from "../../ui/primitives.tsx";

/**
 * One operator question filed by the board owner of its document (`questions/<owner>` rows).
 *
 * The row carries the five facts the operator asked for: the question's ref, its text, the
 * recommendation, the reason and its age, then the answered state.
 *
 * Restraint rule 1: the answered badge is the row's only state colour. The ref is a reference,
 * which renders as plain text when it does not resolve (never a dead chip); `rec` and `why` are
 * metadata, so their labels stay faint and their values muted (rule 2).
 */
export function QuestionRow({ question, answered }: { question: Question; answered: boolean }) {
  return (
    <li className="list-none">
      <Row
      density="list"
      role="listitem"
      data-testid="question-row"
      data-question-id={question.id}
      data-question-state={answered ? "answered" : "unanswered"}
      className="h-auto items-start py-1.5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {question.ref ? (
            <span className="shrink-0">
              <ReferenceChip reference={{ kind: "issue", ref: question.ref }} showAlias={false} />
            </span>
          ) : (
            <span className="shrink-0 text-xs text-ink-faint">no ref</span>
          )}
          <span className="min-w-0 truncate text-sm text-ink" title={question.q ?? undefined} data-testid="question-text">
            {question.q ?? <span className="text-ink-faint">The board recorded no question text.</span>}
          </span>
        </div>
        <div className="flex min-w-0 gap-3 text-xs">
          <span className="flex min-w-0 flex-1 items-baseline gap-1" data-testid="question-rec">
            <span className="shrink-0 text-ink-faint">rec</span>
            <span className={question.rec ? "truncate text-ink-muted" : "truncate text-ink-faint"} title={question.rec ?? undefined}>
              {question.rec ?? "—"}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-1" data-testid="question-why">
            <span className="shrink-0 text-ink-faint">why</span>
            <span className={question.why ? "truncate text-ink-muted" : "truncate text-ink-faint"} title={question.why ?? undefined}>
              {question.why ?? "—"}
            </span>
          </span>
        </div>
      </div>
      <span className="w-16 shrink-0 text-right text-xs text-ink-faint tabular" data-testid="question-age" title={question.at ?? undefined}>
        {ago(question.at ?? null)}
      </span>
      <span className="w-20 shrink-0 text-right" data-testid="question-state">
        <Badge size="xs" tone={answered ? "success" : "muted"} title={answered ? "An answers record exists for this question" : "No answers record exists for this question"}>
          {answered ? "answered" : "unanswered"}
        </Badge>
      </span>
      </Row>
    </li>
  );
}
