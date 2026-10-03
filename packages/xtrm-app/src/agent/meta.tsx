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

export function contextPercent(s: Pick<AgentSessionSummary, "context">): number | null {
  if (!s.context || s.context.window <= 0) return null;
  return Math.round((s.context.used / s.context.window) * 100);
}

/** Context utilization: a number and a hairline meter; colour only past 85% (§15.1). */
export function ContextMeter({ percent, className }: { percent: number | null; className?: string }) {
  if (percent === null) return null;
  const hot = percent >= 85;
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)} title={`Context ${percent}% used`}>
      <span className="relative h-1 w-6 overflow-hidden rounded-full bg-border">
        <span className={cx("absolute inset-y-0 left-0 rounded-full", hot ? "bg-danger" : "bg-ink-faint")} style={{ width: `${Math.min(100, percent)}%` }} />
      </span>
      <span className={cx("tabular", hot ? "text-danger" : undefined)}>{percent}%</span>
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

/** Model and thinking level as rows and headers show them: `deepseek-v4.1-flash · high`. */
export const modelLabel = (s: Pick<AgentSessionSummary, "model" | "thinking">): string | null => [shortModel(s.model), s.thinking].filter(Boolean).join(" · ") || null;
