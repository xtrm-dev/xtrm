import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { cx } from "../ui/primitives.tsx";

/**
 * The lifecycle the pull_requests store records. Anything else — including a state added upstream
 * later — falls through to `muted` and keeps its own word, so a new state never renders as empty.
 */
const TONE: Record<string, BadgeTone> = {
  merged: "accent",
  open: "active",
  closed: "muted",
};

export interface PrStateBadgeProps {
  state: string | null;
  /** `assumed` means only the PR opener wrote the row; no reconciler has read GitHub yet. */
  stateSource?: string | null;
  /** Render the assumption as its own muted badge. Off in dense cells, where the title carries it. */
  showSource?: boolean;
  size?: "xs" | "sm";
  className?: string;
}

/** One badge for PR state, so the issue table and the PR block cannot drift apart. */
export function PrStateBadge({ state, stateSource, showSource = false, size = "sm", className }: PrStateBadgeProps) {
  const label = state ? state.toLowerCase() : "unknown";
  const assumed = stateSource === "assumed";
  const title = assumed
    ? `${label} — assumed: the PR opener recorded this state and no reconciler has read it yet`
    : state
      ? `${label}: read from the pull_requests store`
      : "unknown: no pull_requests row has been read for this pull request";
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1", className)}>
      <Badge tone={TONE[label] ?? "muted"} size={size} title={title} className="capitalize">
        {label}
      </Badge>
      {showSource && assumed && (
        <Badge tone="muted" size={size} title="assumed: written by the PR opener, not yet confirmed by a reconciler read">
          assumed
        </Badge>
      )}
    </span>
  );
}
