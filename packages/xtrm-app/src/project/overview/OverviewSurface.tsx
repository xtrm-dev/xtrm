import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import type { BoardNext, BoardRecord } from "../../adapters/status-board/types.ts";
import { useShell } from "../../shell/context.tsx";
import { ErrorState, LoadingState, Row, ago } from "../../ui/primitives.tsx";
import { SectionHeader } from "../../ui/section.tsx";
import { IntegrationState } from "../IntegrationState.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { AttentionList, RowHint, attentionCounts, buildAttention, type AttentionReason } from "./AttentionList.tsx";

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

  // The counts are only as complete as the reads behind them: a page that stopped at its bound,
  // or a record the adapter could not read, makes the total a floor rather than the truth.
  const lists = [questions, answers, workers, followUps, proposals];
  const caveats: string[] = [];
  const truncated = lists.filter((page) => page.data?.truncated === true).length;
  if (truncated > 0) caveats.push(`${truncated} collection${truncated === 1 ? "" : "s"} stopped at the page limit, so the counts are a floor`);
  const gapCount = lists.reduce((total, page) => total + (page.data?.gaps.length ?? 0), 0);
  if (gapCount > 0) caveats.push(`${gapCount} record${gapCount === 1 ? "" : "s"} could not be read as declared`);

  return shell(
    <>
      <IntegrationState binding={binding.data} health={health.data ?? null} base={base} />
      <NowNext record={next.data ?? null} base={base} />
      <section aria-label="Attention" className="flex flex-col">
        <SectionHeader
          title="Attention"
          count={<span data-testid="attention-count">{counts.total}</span>}
          wrap
          className="border-b border-border-muted"
          aside={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint" data-testid="attention-reasons">
              {REASON_ORDER.filter((reason) => counts[reason] > 0).map((reason) => (
                <span key={reason} data-testid={`attention-count-${reason.replaceAll(" ", "-").toLowerCase()}`}>
                  {reason} <span className="tabular">{counts[reason]}</span>
                </span>
              ))}
            </span>
          }
        />
        {caveats.length > 0 && (
          <p className="px-3 pt-1 text-xs text-ink-faint" data-testid="attention-caveat">
            Incomplete read: {caveats.join("; ")}.
          </p>
        )}
        <AttentionList items={items} />
      </section>
    </>,
  );
}

const REASON_ORDER: AttentionReason[] = ["Question", "Blocked", "Claim expiring", "Follow-up due", "Proposal", "Drift"];

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*$/;

/**
 * The board's one current pointer, never a synthesized agenda. The live `board/next` document
 * carries `rows[]`; a flat document written before that shape still renders as one row.
 */
function NowNext({ record, base }: { record: BoardRecord<BoardNext> | null; base: string }) {
  const navigate = useNavigate();
  const rows = record?.doc.rows ?? [];
  const ref = record?.doc.ref ?? null;
  const href = ref ? `${base}/work/issues/${ref}` : null;
  return (
    <section aria-label="Now and next" className="flex flex-col">
      <SectionHeader title="Now / next" className="border-b border-border-muted" aside={<span className="text-xs text-ink-faint">from board/next</span>} />
      {record && rows.length > 0 ? (
        <ul className="flex flex-col" data-testid="now-next-rows">
          {rows.map((row) => {
            const rowHref = ISSUE_KEY.test(row.key) ? `${base}/work/issues/${row.key}` : null;
            return (
              <li key={row.key}>
                <Row density="list" title={row.why ?? row.title ?? row.key} onActivate={rowHref ? () => void navigate({ to: rowHref } as never) : undefined} data-testid="now-next-row" data-key={row.key}>
                  <span className="min-w-0 flex-1 truncate text-ink">{row.title ?? row.key}</span>
                  {row.status && <span className="shrink-0 text-xs text-ink-faint">{row.status}</span>}
                  <span className="shrink-0 font-mono text-xs text-ink-faint">{row.key}</span>
                  <span className="w-24 shrink-0 text-right text-xs text-ink-faint tabular">{row.start ? ago(row.start) : row.end ? ago(row.end) : ""}</span>
                  {rowHref && <RowHint section="Issue" className="w-20" />}
                </Row>
              </li>
            );
          })}
        </ul>
      ) : record ? (
        <ul className="flex flex-col">
          <li>
            <Row density="list" title={record.doc.title ?? record.path} onActivate={href ? () => void navigate({ to: href } as never) : undefined}>
              <span className="min-w-0 flex-1 truncate text-ink">{record.doc.title ?? record.path}</span>
              {record.doc.owner && <span className="shrink-0 text-xs text-ink-faint">{record.doc.owner}</span>}
              {ref && <span className="shrink-0 font-mono text-xs text-ink-faint">{ref}</span>}
              <span className="w-24 shrink-0 text-right text-xs text-ink-faint tabular">{record.doc.at ? ago(record.doc.at) : ""}</span>
              {href && <RowHint section="Issue" className="w-20" />}
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
