import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "./badge.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { cx } from "./primitives.tsx";

/**
 * One module owns PR identity (docs/design/console-ui-system.md §4.4): the state model, the key
 * and the state chip. `src/issues/pr-state.tsx` re-exports the chip so its callers keep working.
 */
export type PrState = "open" | "draft" | "merged" | "closed";

/** `unknown` is a rendered state, never an empty cell: a state added upstream later still shows. */
export type PrStateKey = PrState | "unknown";

/**
 * `draft` is a flag on an open PR, not a stored state; resolve it once here so every surface
 * agrees. Anything outside the four states is `unknown` and keeps its own neutral word.
 */
export function prStateOf(state: string | null, draft?: boolean | null): PrStateKey {
  const value = state?.toLowerCase() ?? "";
  if (value === "open") return draft ? "draft" : "open";
  if (value === "merged") return "merged";
  if (value === "closed") return "closed";
  return "unknown";
}

export interface PrStateMeta {
  /** The word a human reads. The key itself never shows it; the chip does. */
  word: string;
  /** The key's ink. Light ratios are on `#ffffff`, dark on `#151515` (§4.4). */
  keyClass: string;
  chipTone: BadgeTone;
  /** The glyph shape is the non-colour carrier of the state (ruling R2). */
  icon: IconName;
  /** Tooltip and `aria-label` text: the state again, in words. */
  hint: string;
}

export const PR_STATES: Record<PrState, PrStateMeta> = {
  open: { word: "Open", keyClass: "text-success", chipTone: "success", icon: "pull", hint: "Open — ready for review" },
  draft: { word: "Draft", keyClass: "text-ink-muted", chipTone: "neutral", icon: "pullDraft", hint: "Draft — not ready for review" },
  merged: { word: "Merged", keyClass: "text-accent-ink", chipTone: "accent", icon: "merge", hint: "Merged" },
  closed: { word: "Closed", keyClass: "text-danger", chipTone: "danger", icon: "pullClosed", hint: "Closed without merging" },
};

/** Unknown reads as a state of its own: muted ink, the pull glyph, and a word in the tooltip. */
export const PR_STATE_UNKNOWN: PrStateMeta = {
  word: "Unknown",
  keyClass: "text-ink-muted",
  chipTone: "muted",
  icon: "pull",
  hint: "State unknown — no pull_requests row has been read for this pull request",
};

export function prStateMeta(state: string | null, draft?: boolean | null): PrStateMeta {
  const key = prStateOf(state, draft);
  if (key !== "unknown") return PR_STATES[key];
  // A state the source reported but this module does not know keeps its own word: the cell says
  // "Queued", not "Unknown", because the data is present and only the rendering is new (§4.4).
  const reported = typeof state === "string" ? state.trim() : "";
  if (!reported) return PR_STATE_UNKNOWN;
  return {
    ...PR_STATE_UNKNOWN,
    word: reported.charAt(0).toUpperCase() + reported.slice(1),
    hint: `State reported by the source: ${reported}`,
  };
}

export interface PrKeyProps {
  number: number;
  state: string | null;
  draft?: boolean | null;
  /** `owner/name` shown faint after `#N` when the key travels outside its repository. */
  repo?: string;
  /** The state glyph before `#N`. On in lists, chips and headers; off only in running prose. */
  glyph?: boolean;
  /** Muted ink for a row that already carries a coloured status (Restraint rule 1). */
  quiet?: boolean;
  className?: string;
}

/**
 * The PR key, coloured by state, with the glyph that carries the state without colour. Mono is
 * allowed for keys (ADR-002 §D9), and the tooltip plus `aria-label` name the state in words.
 */
export function PrKey({ number, state, draft, repo, glyph = true, quiet = false, className }: PrKeyProps) {
  const meta = prStateMeta(state, draft);
  return (
    <span
      className={cx("inline-flex min-w-0 items-center gap-1 font-mono text-xs", quiet ? "text-ink-muted" : meta.keyClass, className)}
      title={meta.hint}
      aria-label={`Pull request #${number}, ${meta.word.toLowerCase()}`}
    >
      {glyph && <Icon name={meta.icon} size="text" className="shrink-0" />}
      <span className="shrink-0">#{number}</span>
      {repo && <span className="truncate text-ink-faint">{repo}</span>}
    </span>
  );
}

export interface PrStateChipProps {
  state: string | null;
  draft?: boolean | null;
  /** `assumed` means only the PR opener wrote the row; no reconciler has read GitHub yet. */
  stateSource?: string | null;
  /** Render the assumption as its own muted badge. Off in dense cells, where the tooltip carries it. */
  showSource?: boolean;
  size?: "xs" | "sm";
  className?: string;
}

/**
 * The state chip: glyph plus word. Only the inspector header carries it (§4.5, Restraint rule 3);
 * everywhere else the key alone names the state.
 */
export function PrStateChip({ state, draft, stateSource, showSource = false, size = "sm", className }: PrStateChipProps) {
  const meta = prStateMeta(state, draft);
  const assumed = stateSource === "assumed";
  const title = assumed ? `${meta.hint} — assumed: the PR opener recorded this state and no reconciler has read it yet` : meta.hint;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1", className)}>
      <Badge tone={meta.chipTone} size={size} title={title}>
        <Icon name={meta.icon} size="micro" className="shrink-0" />
        {meta.word}
      </Badge>
      {showSource && assumed && (
        <Badge tone="muted" size={size} title="assumed: written by the PR opener, not yet confirmed by a reconciler read">
          assumed
        </Badge>
      )}
    </span>
  );
}

/** Alias kept for the callers that predate §4.4; the chip above is the one component. */
export function PrStateBadge(props: PrStateChipProps): ReactNode {
  return <PrStateChip {...props} />;
}
