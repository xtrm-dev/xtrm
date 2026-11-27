import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import type { IssueSummary } from "../adapters/index.tsx";
import { issueStatus } from "./issue-table.ts";
import { TERMINAL } from "./meta.tsx";

/**
 * The one status chip for a Substrate issue (2026-11-27 ruling). The list row and the inspector
 * drawer both render this component, so the label, tone and fill cannot drift between them; only
 * the size differs (`xs` in a row, `sm` next to the drawer title).
 *
 * - A state of work (In progress, Ready, Attested, Blocked, Rejected, Deferred, closed) is a solid chip.
 * - A gap (Draft, Unattested, Stale, Open) is the quiet tint on the `muted` tokens.
 * - Closed work is a fact, not a warning: a terminal lifecycle takes the success tone.
 * - Glyph plus word, the same shape as the PR state chip (XTRM-1136): the glyph marks the status
 *   family without colour (open-like gaps share a circle); the word names the exact status.
 */
export function IssueStatusBadge({ issue, size = "xs", className }: { issue: IssueSummary; size?: BadgeProps["size"]; className?: string }) {
  const status = issueStatus(issue);
  const tone = status.quiet ? "muted" : status.tone === "muted" && TERMINAL.has(issue.lifecycle) ? "success" : status.tone;
  return (
    <Badge variant={status.quiet ? "tint" : "solid"} tone={tone} size={size} title={status.hint} className={className} data-testid="issue-status" data-status={status.label}>
      <Icon name={status.icon} size="micro" className="shrink-0" />
      {status.label}
    </Badge>
  );
}
