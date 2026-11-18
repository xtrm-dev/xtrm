import type { FollowUp } from "../../adapters/status-board/types.ts";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { Row } from "../../ui/primitives.tsx";
import { ReferenceChip } from "../../refs/references.tsx";
import { logContractGap } from "../workers/model.ts";

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
    <Row density="list" data-testid="followup-row" className="items-center gap-2">
      <span className="flex min-w-0 items-center gap-2">
        {followUp.ref ? (
          <ReferenceChip reference={{ kind: "issue", ref: followUp.ref }} showAlias={false} />
        ) : (
          <span className="text-ink-faint">no ref</span>
        )}
        <span className="truncate text-ink">{followUp.title ?? followUp.plain ?? "—"}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="font-mono text-xs text-ink-muted" data-testid="followup-priority">
          {followUp.priority ?? "—"}
        </span>
        {followUp.status ? (
          <Badge tone={statusTone(followUp.status)} size="xs" title={`follow-up status: ${followUp.status}`}>
            {followUp.status}
          </Badge>
        ) : (
          <span className="text-ink-faint">unknown state</span>
        )}
        <span className="w-28 shrink-0 truncate text-right text-xs text-ink-muted" data-testid="followup-owner">
          {followUp.owner ?? "unowned"}
        </span>
        <span className="w-32 shrink-0 truncate text-right text-xs text-ink-faint" data-testid="followup-when">
          {followUp.when ?? "—"}
        </span>
        <span className="flex shrink-0 items-center gap-1" data-testid="followup-refs">
          {(followUp.refs ?? []).map((ref) => (
            <ReferenceChip key={ref} reference={{ kind: "issue", ref }} showAlias={false} />
          ))}
        </span>
      </span>
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
