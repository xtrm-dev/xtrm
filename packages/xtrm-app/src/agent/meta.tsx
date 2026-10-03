import type { AgentSessionSummary, RefKind, SessionState } from "../adapters/index.tsx";
import type { IconName } from "../ui/icon.tsx";
import { cx, type Tone } from "../ui/primitives.tsx";

/**
 * A session state as shown: while the live stream is down (XTRM-613) a live session's state is unknown
 * and shows `disconnected` instead of a possibly stale state (useShownState).
 */
export type ShownState = SessionState | "disconnected";

export const STATE_LABEL: Record<ShownState, string> = {
  disconnected: "disconnected",
  working: "working",
  waiting: "waiting for input",
  settled: "settled",
  failed: "failed",
  history: "history only",
};

export const STATE_TONE: Record<ShownState, Tone> = {
  disconnected: "muted",
  working: "active",
  waiting: "accent",
  settled: "neutral",
  failed: "danger",
  history: "muted",
};

export const REF_ICON: Record<RefKind, IconName> = {
  issue: "issues",
  epic: "board",
  "gh-issue": "comment",
  pr: "pull",
  commit: "commit",
  file: "file",
  session: "agent",
  agent: "agents",
  frame: "list",
};

export const REF_LABEL: Record<RefKind, string> = {
  issue: "Issue",
  epic: "Epic",
  "gh-issue": "GitHub issue",
  pr: "Pull request",
  commit: "Commit",
  file: "File",
  session: "Session",
  agent: "Agent",
  frame: "Frame",
};

/**
 * The utilization shown as text (XTRM-612): whole percent from 10, one decimal below 10,
 * `<1%` for a non-zero share too small for one decimal, `0%` only for an empty context —
 * rounding 2330/1e6 to a whole percent must not show 0% on a 1M-window model.
 */
export function contextLabel(context: { used: number; window: number } | null | undefined): string | null {
  if (!context || context.window <= 0) return null;
  const pct = (context.used / context.window) * 100;
  if (pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** Context utilization: a number and a hairline meter; colour only past 85% (§15.1). The fill
 * keeps a visible hairline for any non-zero context (XTRM-612). */
export function ContextMeter({ context, className }: { context: { used: number; window: number } | null; className?: string }) {
  if (!context || context.window <= 0) return null;
  const pct = (context.used / context.window) * 100;
  const label = contextLabel(context)!;
  const hot = pct >= 85;
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)} title={`Context ${label} used`}>
      <span className="relative h-1 w-6 overflow-hidden rounded-full bg-border">
        <span className={cx("absolute inset-y-0 left-0 rounded-full", hot ? "bg-danger" : "bg-ink-faint")} style={{ width: `${pct > 0 ? Math.min(100, Math.max(pct, 2)) : 0}%` }} />
      </span>
      <span className={cx("tabular", hot ? "text-danger" : undefined)}>{label}</span>
    </span>
  );
}

export function duration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Model id without its provider (`opencode-go/deepseek-v4.1-flash` → `deepseek-v4.1-flash`, `claude-opus-5-5` → `opus 5.5`). */
export const shortModel = (model: string | null) =>
  model
    ?.replace(/^[^/]+\//, "")
    .replace(/^claude-/, "")
    .replace(/-(\d+)-(\d+)$/, " $1.$2") ?? null;

/** Provider of a `<provider>/<model id>` model (`opencode-go`); null for a bare model id. */
export const modelProvider = (model: string | null) => (model ? (/^([^/]+)\//.exec(model)?.[1] ?? null) : null);

/** Model and thinking level as rows and headers show them: `deepseek-v4.1-flash · high`. */
export const modelLabel = (s: Pick<AgentSessionSummary, "model" | "thinking">): string | null => [shortModel(s.model), s.thinking].filter(Boolean).join(" · ") || null;
