import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import type { BoardNext, BoardRecord } from "../../adapters/status-board/types.ts";
import { useShell } from "../../shell/context.tsx";
import { ErrorState, LoadingState, Row, ago } from "../../ui/primitives.tsx";
import { IntegrationState } from "../IntegrationState.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { AttentionList, attentionCounts, buildAttention, type AttentionReason } from "./AttentionList.tsx";

/**
 * Overview (§5): the operator's first question — what needs attention in this
 * repository now — answered from the board's own records.
 *
 * Composition: the ProjectShell header (repository, binding, freshness), a
 * compact now/next row from `board/next`, one `IntegrationState` when the
 * repository is unbound or the sync is stale, and one ranked `AttentionList`
 * built from `questions/*`, `workers/*`, `followups/*` and `proposals/*`.
 *
 * Read-only, per ADR-002 assumption 3: nothing here writes to the board.
 * An unbound repository never calls a board collection — the binding is the
 * only request, and `IntegrationState` is the only block.
 */
export function OverviewSurface() {
  const { repo } = useShell();
  const { statusBoard } = useAdapters();
  const repository = repo.fullName;
  const base = `/rep/${repo.owner}/${repo.name}`;

  const binding = useQuery({ queryKey: ["project", "binding", repository], queryFn: () => statusBoard.binding(repository), staleTime: 60_000 });
  const bound = binding.data?.configured === true;

  const health = useQuery({ queryKey: ["project", "health", repository], queryFn: () => statusBoard.health(repository), staleTime: 60_000, enabled: bound });
  const questions = useQuery({ queryKey: ["project", "questions", repository], queryFn: () => statusBoard.listQuestions(repository), staleTime: 60_000, enabled: bound });
  const answers = useQuery({ queryKey: ["project", "answers", repository], queryFn: () => statusBoard.listAnswers(repository), staleTime: 60_000, enabled: bound });
  const workers = useQuery({ queryKey: ["project", "workers", repository], queryFn: () => statusBoard.listWorkers(repository), staleTime: 60_000, enabled: bound });
  const followUps = useQuery({ queryKey: ["project", "followups", repository], queryFn: () => statusBoard.listFollowUps(repository), staleTime: 60_000, enabled: bound });
  const proposals = useQuery({ queryKey: ["project", "proposals", repository], queryFn: () => statusBoard.listProposals(repository), staleTime: 60_000, enabled: bound });
  const next = useQuery({ queryKey: ["project", "next", repository], queryFn: () => statusBoard.boardNext(repository), staleTime: 60_000, enabled: bound });

  const shell = (children: ReactNode) => (
    <ProjectShell title="Overview" binding={binding.data ?? null} health={bound ? (health.data ?? null) : null} source={statusBoard.source}>
      {children}
    </ProjectShell>
  );

  if (binding.isPending) return shell(<LoadingState label="Resolving the Project binding" rows={4} />);
  if (binding.isError) return shell(<ErrorState title="The status board is unavailable" error={binding.error} />);
  if (!binding.data.configured) return shell(<IntegrationState binding={binding.data} health={null} base={base} />);

  const pages = [health, questions, answers, workers, followUps, proposals, next];
  const failed = pages.find((page) => page.isError);
  if (failed) return shell(<ErrorState title="The status board is unavailable" error={failed.error} />);
  if (pages.some((page) => page.isPending)) return shell(<LoadingState label="Reading the status board" />);

  const now = Date.now();
  const items = buildAttention(
    {
      questions: questions.data?.records ?? [],
      answers: answers.data?.records ?? [],
      workers: workers.data?.records ?? [],
      followUps: followUps.data?.records ?? [],
      proposals: proposals.data?.records ?? [],
      health: health.data ?? null,
      repoBase: base,
    },
    now,
  );
  const counts = attentionCounts(items);

  return shell(
    <>
      <IntegrationState binding={binding.data} health={health.data ?? null} base={base} />
      <NowNext record={next.data ?? null} base={base} />
      <section aria-label="Attention" className="flex flex-col">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-muted px-3 py-1.5">
          <h2 className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">Attention</h2>
          <span className="text-[11px] text-ink-faint tabular" data-testid="attention-count">
            {counts.total}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
            {REASON_ORDER.filter((reason) => counts[reason] > 0).map((reason) => (
              <span key={reason} data-testid={`attention-count-${reason.replaceAll(" ", "-").toLowerCase()}`}>
                {reason} <span className="tabular">{counts[reason]}</span>
              </span>
            ))}
          </span>
        </header>
        <AttentionList items={items} />
      </section>
    </>,
  );
}

const REASON_ORDER: AttentionReason[] = ["Question", "Blocked", "Claim expiring", "Follow-up due", "Proposal", "Drift"];

/** The board's one current pointer, never a synthesized agenda. */
function NowNext({ record, base }: { record: BoardRecord<BoardNext> | null; base: string }) {
  const navigate = useNavigate();
  const ref = record?.doc.ref ?? null;
  const href = ref ? `${base}/work/issues/${ref}` : null;
  return (
    <section aria-label="Now and next" className="flex flex-col">
      <header className="flex items-center gap-2 border-b border-border-muted px-3 py-1.5">
        <h2 className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">Now / next</h2>
        <span className="ml-auto text-[11px] text-ink-faint">from board/next</span>
      </header>
      {record ? (
        <ul className="flex flex-col">
          <li>
            <Row density="list" title={record.doc.title ?? record.path} onActivate={href ? () => void navigate({ to: href } as never) : undefined}>
              <span className="min-w-0 flex-1 truncate text-ink">{record.doc.title ?? record.path}</span>
              {record.doc.owner && <span className="shrink-0 text-xs text-ink-faint">{record.doc.owner}</span>}
              {ref && <span className="shrink-0 font-mono text-xs text-ink-faint">{ref}</span>}
              <span className="w-24 shrink-0 text-right text-xs text-ink-faint tabular">{record.doc.at ? ago(record.doc.at) : ""}</span>
              {href && <span className="w-20 shrink-0 text-right text-xs text-ink-faint">→ Issue</span>}
            </Row>
          </li>
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm text-ink-faint" data-testid="now-next-empty">
          The board has no current pointer.
        </p>
      )}
    </section>
  );
}
