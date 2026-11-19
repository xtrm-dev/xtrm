import type { ScheduleEvent } from "../../adapters/status-board/types.ts";
import { EventRow } from "./EventRow.tsx";
import { NowMarker } from "./NowMarker.tsx";

/**
 * One date of the agenda (§5): a `bg-control` heading in mono caps plus its
 * events in time order, with the now marker between the past and the future.
 *
 * "Day-grouped agenda" is the only shape: a day with no events renders
 * nothing here (the surface shows its own empty state), so a group never
 * appears as a blank heading.
 */

const DAY_IN_MS = 86_400_000;

/** `YYYY-MM-DD` of an instant in the binding's timezone. */
export function dayKey(now: number | Date, timeZone: string): string {
  const date = typeof now === "number" ? new Date(now) : now;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** A calendar day shifted by whole days; the day string is timezone-free arithmetic. */
export function shiftDay(day: string, delta: number): string {
  const at = Date.parse(`${day}T00:00:00Z`);
  return new Date(at + delta * DAY_IN_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` or nothing: anything else is not a date and never becomes one. */
export function parseDay(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : undefined;
}

/** The heading is the calendar date itself, so it is formatted from the day, not from an instant. */
export function formatDayHeading(day: string, today: string): string {
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
  const relative = day === today ? "today" : day === shiftDay(today, -1) ? "yesterday" : day === shiftDay(today, 1) ? "tomorrow" : null;
  return relative ? `${label} · ${relative}` : label;
}

/** Event time in the binding's zone; an unreadable `at` stays visibly absent. */
export function formatTime(iso: string, timeZone: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "--:--";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

/** A time-ordered event list: `at` ascending, an interval closed at `end`, no `at` last. */
export function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    const left = a.at ? Date.parse(a.at) : Number.NaN;
    const right = b.at ? Date.parse(b.at) : Number.NaN;
    if (Number.isNaN(left) && Number.isNaN(right)) return a.id.localeCompare(b.id);
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left - right || a.id.localeCompare(b.id);
  });
}

/** Group one flat event page by the `schedule/<day>` record it came from. */
export function groupByDay(events: ScheduleEvent[]): Map<string, ScheduleEvent[]> {
  const groups = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    const day = event.day;
    if (!parseDay(day)) continue;
    const bucket = groups.get(day);
    if (bucket) bucket.push(event);
    else groups.set(day, [event]);
  }
  for (const [day, bucket] of groups) groups.set(day, sortEvents(bucket));
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** An event is past once its end (or, without an end, its start) is behind now. */
export function isPastEvent(event: ScheduleEvent, now: number): boolean {
  const boundary = Date.parse(event.end ?? event.at ?? "");
  return Number.isNaN(boundary) ? false : boundary < now;
}

export function DayGroup({
  day,
  events,
  now,
  timeZone,
  today,
  repoBase,
}: {
  day: string;
  events: ScheduleEvent[];
  now: number;
  timeZone: string;
  /** Today's key in the binding's zone; the marker is drawn on this day only. */
  today: string;
  repoBase: string;
}) {
  if (events.length === 0) return null;
  const ordered = sortEvents(events);
  // The marker sits after the last event that has already started; a day whose
  // events all lie ahead keeps it at the top, and a past day has none at all.
  const markerIndex = day !== today ? -1 : ordered.filter((event) => event.at && Date.parse(event.at) <= now).length;

  return (
    <section aria-label={formatDayHeading(day, today)} data-testid={`day-group-${day}`} className="flex flex-col">
      <header className="flex items-center gap-2 border-b border-border-muted bg-control px-3 py-1">
        <h2 className="font-mono text-xs tracking-wide text-ink-muted uppercase">{formatDayHeading(day, today)}</h2>
        <span className="ml-auto text-xs text-ink-faint tabular" data-testid={`day-count-${day}`}>
          {ordered.length}
        </span>
      </header>
      <ul className="flex flex-col py-1">
        {ordered.map((event, index) => (
          <FragmentRow key={event.id} event={event} index={index} markerIndex={markerIndex} now={now} timeZone={timeZone} repoBase={repoBase} />
        ))}
        {markerIndex === ordered.length && <li className="list-none"><NowMarker /></li>}
      </ul>
    </section>
  );
}

function FragmentRow({
  event,
  index,
  markerIndex,
  now,
  timeZone,
  repoBase,
}: {
  event: ScheduleEvent;
  index: number;
  markerIndex: number;
  now: number;
  timeZone: string;
  repoBase: string;
}) {
  const marker = markerIndex === index;
  return (
    <>
      {marker && (
        <li className="list-none">
          <NowMarker />
        </li>
      )}
      <EventRow
        event={event}
        timeLabel={event.at ? formatTime(event.at, timeZone) : "--:--"}
        endLabel={event.end ? formatTime(event.end, timeZone) : null}
        past={isPastEvent(event, now)}
        repoBase={repoBase}
      />
    </>
  );
}
