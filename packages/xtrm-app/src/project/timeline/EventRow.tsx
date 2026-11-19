import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ScheduleEvent } from "../../adapters/status-board/types.ts";
import { Badge } from "../../ui/badge.tsx";
import { Icon, type IconName } from "../../ui/icon.tsx";
import { Row } from "../../ui/primitives.tsx";
import { RowAction } from "../../ui/row-action.tsx";

/**
 * One `schedule/<day>` event (§5): `[time] [kind glyph + word] [label] [refs]`,
 * the status chip as the row's one coloured element, and a detail row that
 * exposes the record's own provenance (ref, label, note, note source, URL,
 * created_by). The row is a disclosure, never an editor: sync owns these
 * records (ADR-002 assumption 3, read-only first tranche).
 */

const KIND_GLYPH: Record<string, IconName> = {
  window: "target",
  pr: "merge",
  handover: "assignment",
  incident: "alert",
  report: "file",
};

/** Status is the row's state carrier; an unrecognised status stays a neutral word. */
export function statusTone(status: string): "success" | "danger" | "neutral" {
  const word = status.toLowerCase();
  if (word === "done" || word === "closed" || word === "complete" || word === "completed") return "success";
  if (word === "failed" || word === "blocked" || word === "breached") return "danger";
  return "neutral";
}

export interface EventRowProps {
  event: ScheduleEvent;
  /** Start time in the binding's zone, precomputed by the group. */
  timeLabel: string;
  endLabel: string | null;
  /** True once the event's end (or start) is behind the now marker. */
  past: boolean;
  repoBase: string;
}

export function EventRow({ event, timeLabel, endLabel, past, repoBase }: EventRowProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const detailsId = `event-detail-${event.id}`;
  const kind = event.kind ?? "unknown";
  // The store writes `label` or `title` for an event; both are its own name for the row.
  const label = event.label ?? event.title ?? event.id;
  const issueHref = event.ref && /^[A-Za-z][A-Za-z0-9]*-\d+(?:\.\d+)*$/.test(event.ref) ? `${repoBase}/work/issues/${event.ref}` : null;
  const action = event.url ?? issueHref;

  return (
    <li>
      <Row
        density="list"
        data-testid={`event-row-${event.id}`}
        title={label}
        aria-expanded={open}
        aria-controls={detailsId}
        data-kind={kind}
        data-event-id={event.id}
        onActivate={() => setOpen((value) => !value)}
        actions={
          action ? (
            <RowAction
              icon={event.url ? "external" : "issues"}
              label={event.url ? "Open the event URL" : `Open ${event.ref}`}
              onAct={() => {
                if (event.url) window.open(event.url, "_blank", "noopener,noreferrer");
                else void navigate({ to: issueHref as never });
              }}
            />
          ) : undefined
        }
      >
        <span className="w-12 shrink-0 text-xs text-ink-faint tabular">{timeLabel}</span>
        <span className="flex w-24 shrink-0 items-center gap-1.5">
          <Icon name={KIND_GLYPH[kind] ?? "file"} size="text" className="shrink-0 text-ink-faint" />
          <span className="truncate text-xs text-ink-muted">{kind}</span>
        </span>
        <span className={past ? "min-w-0 flex-1 truncate text-ink-muted" : "min-w-0 flex-1 truncate text-ink"}>{label}</span>
        {event.ref && <span className="shrink-0 font-mono text-xs text-ink-muted">{event.ref}</span>}
        {endLabel && <span className="shrink-0 text-[11px] text-ink-faint tabular">until {endLabel}</span>}
        {event.status && (
          <Badge size="xs" tone={statusTone(event.status)} className="shrink-0">
            {event.status}
          </Badge>
        )}
      </Row>
      {open && (
        <dl
          id={detailsId}
          data-testid={detailsId}
          className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-0.5 border-l border-border-muted px-3 py-1.5 pl-6 text-[11px]"
        >
          <dt className="text-ink-faint">ref</dt>
          <dd className="font-mono text-ink-muted">{event.ref ?? "—"}</dd>
          <dt className="text-ink-faint">label</dt>
          <dd className="text-ink-muted">{event.label ?? event.title ?? "—"}</dd>
          <dt className="text-ink-faint">note</dt>
          <dd className="text-ink-muted">
            {event.note ?? "—"}
            {event.noteSrc && <span className="text-ink-faint"> (source: {event.noteSrc})</span>}
          </dd>
          <dt className="text-ink-faint">url</dt>
          <dd className="truncate font-mono text-ink-muted">
            {event.url ? (
              <a href={event.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent-ink">
                {event.url}
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-ink-faint">by</dt>
          <dd className="text-ink-muted">{event.createdBy ?? "—"}</dd>
        </dl>
      )}
    </li>
  );
}
