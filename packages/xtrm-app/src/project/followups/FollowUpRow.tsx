import type { FollowUp } from "../../adapters/status-board/types.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { Row } from "../../ui/primitives.tsx";
import { ReferenceChip } from "../../refs/references.tsx";
import { logContractGap } from "../workers/model.ts";

/**
 * Column widths shared by the header and every row, so priority, state, owner, when and
 * refs start at the same x on every line (the Overview/Timeline grid pattern). The title
 * column takes the remaining width and is the only one that truncates freely.
 */
export const FOLLOWUP_COLUMNS =
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2.5rem_6.5rem_7rem_9rem_11rem] items-center gap-3";

/**
 * One Follow-ups row: the commitment's own ref (a real issue reference), its title,
 * priority, status, owner, when and its typed refs.
 *
 * Restraint rule 1: the status badge is the row's coloured element; the priority is
 * plain mono text (rule 2 — a priority is metadata, not a state), and each ref is a
 * reference chip that renders as its plain text when it does not resolve.
 */
export function FollowUpRow({ followUp }: { followUp: FollowUp }) {
  return (
    <Row density="list" data-testid="followup-row">
      <div className={FOLLOWUP_COLUMNS}>
        <span className="flex min-w-0 items-center gap-2">
          {followUp.ref ? (
            <ReferenceChip reference={{ kind: "issue", ref: followUp.ref }} showAlias={false} />
          ) : (
            <span className="shrink-0 text-ink-faint">no ref</span>
          )}
          <span className="truncate text-ink">{followUp.title ?? followUp.plain ?? "—"}</span>
        </span>
        <span className="text-right font-mono text-xs text-ink-muted tabular" data-testid="followup-priority">
          {followUp.priority ?? "—"}
        </span>
        <span className="min-w-0">
          {followUp.status ? (
            <Badge tone={statusTone(followUp.status)} size="xs" title={`follow-up status: ${followUp.status}`}>
              {followUp.status}
            </Badge>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </span>
        <span className="truncate text-xs text-ink-muted" data-testid="followup-owner">
          {followUp.owner ?? "unowned"}
        </span>
        <span className="truncate text-xs text-ink-faint tabular" data-testid="followup-when">
          {followUp.when ?? "—"}
        </span>
        <span className="flex min-w-0 items-center gap-1 overflow-hidden" data-testid="followup-refs">
          {(followUp.refs ?? []).map((ref) => (
            <ReferenceChip key={ref} reference={{ kind: "issue", ref }} showAlias={false} />
          ))}
        </span>
      </div>
    </Row>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = { open: "accent", deferred: "muted", done: "success", cancelled: "neutral" };

function statusTone(status: string): BadgeTone {
  const tone = STATUS_TONE[status];
  if (tone) return tone;
  logContractGap(`follow-up status "${status}" is not in the known set`);
  return "neutral";
}
