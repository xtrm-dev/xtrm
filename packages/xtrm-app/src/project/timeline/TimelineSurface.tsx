import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import { useShell } from "../../shell/context.tsx";
import { EmptyState, ErrorState, IconButton, LoadingState } from "../../ui/primitives.tsx";
import { ToolbarButton } from "../../ui/toolbar.tsx";
import { IntegrationState } from "../IntegrationState.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { DayGroup, dayKey, groupByDay, parseDay, shiftDay } from "./DayGroup.tsx";

/**
 * Timeline (§5): a day-grouped agenda of the board's own `schedule/<day>`
 * events, with a now marker on today.
 *
 * One day is on screen at a time — the day in `?day=`, defaulting to today in
 * the binding's timezone — so the surface always shows exactly the events the
 * chosen `schedule/<day>` document carries and never fills a blank day with
 * invented rows. Previous/next step one calendar day; Today returns to the
 * default. Times render in the binding's zone and the zone is labelled once in
 * the header (ADR-002 §D2, assumption 3: read-only against the board).
 */

/** `?day=YYYY-MM-DD` — an invalid value is dropped, never coerced into a date. */
export function validateTimelineSearch(search: Record<string, unknown>): { day?: string } {
  const day = parseDay(search.day);
  return day ? { day } : {};
}

export function TimelineSurface() {
  const { repo } = useShell();
  const { statusBoard } = useAdapters();
  const repository = repo.fullName;
  const base = `/rep/${repo.owner}/${repo.name}`;
  const search = useSearch({ strict: false }) as { day?: string };
  const navigate = useNavigate();

  const binding = useQuery({ queryKey: ["project", "binding", repository], queryFn: () => statusBoard.binding(repository), staleTime: 60_000 });
  const bound = binding.data?.configured === true;
  const health = useQuery({ queryKey: ["project", "health", repository], queryFn: () => statusBoard.health(repository), staleTime: 60_000, enabled: bound });
  const schedule = useQuery({ queryKey: ["project", "schedule", repository], queryFn: () => statusBoard.listSchedule(repository), staleTime: 60_000, enabled: bound });

  const timeZone = binding.data?.statusBoard?.timezone ?? "UTC";
  const now = Date.now();
  const today = dayKey(now, timeZone);
  const day = parseDay(search.day) ?? today;

  const goto = (next: string, replace = true) =>
    void navigate({ to: `${base}/project/timeline`, search: (prev: Record<string, unknown>) => ({ ...prev, day: next === today ? undefined : next }), replace } as never);

  const shell = (children: ReactNode) => (
    <ProjectShell
      title="Timeline"
      binding={binding.data ?? null}
      health={bound ? (health.data ?? null) : null}
      source={statusBoard.source}
      toolbar={
        <>
          <IconButton icon="back" label="Previous day" onClick={() => goto(shiftDay(day, -1))} />
          <IconButton icon="forward" label="Next day" onClick={() => goto(shiftDay(day, 1))} />
          <ToolbarButton icon="target" onClick={() => goto(today)} disabled={day === today}>
            Today
          </ToolbarButton>
          <span className="ml-1 text-[11px] text-ink-faint" data-testid="timeline-timezone">
            {timeZone}
          </span>
        </>
      }
    >
      {children}
    </ProjectShell>
  );

  if (binding.isPending) return shell(<LoadingState label="Resolving the Project binding" rows={4} />);
  if (binding.isError) return shell(<ErrorState title="The status board is unavailable" error={binding.error} />);
  if (!binding.data.configured) return shell(<IntegrationState binding={binding.data} health={null} base={base} />);

  if (health.isError) return shell(<ErrorState title="The status board is unavailable" error={health.error} />);
  if (schedule.isError) return shell(<ErrorState title="The schedule is unavailable" error={schedule.error} />);
  if (schedule.isPending) return shell(<LoadingState label="Reading the schedule" />);

  const groups = groupByDay(schedule.data.records.map((record) => record.doc));
  const events = groups.get(day) ?? [];

  return shell(
    <>
      <IntegrationState binding={binding.data} health={health.data ?? null} base={base} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto thin-scrollbar" data-testid="timeline-day" data-day={day}>
        {events.length > 0 ? (
          <DayGroup day={day} events={events} now={now} timeZone={timeZone} today={today} repoBase={base} />
        ) : (
          <EmptyState icon="activity" title="No scheduled events">
            <span data-testid="timeline-empty-day">
              {schedule.data.records.length === 0
                ? `The board carries no schedule/<day> record for ${repository}.`
                : `schedule/${day} carries no event.`}
            </span>
          </EmptyState>
        )}
      </div>
    </>
  );
}
