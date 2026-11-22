import type { IconName } from "../ui/icon.tsx";
import type { SelectOption } from "../ui/fields.tsx";
import { StatusDot, cx, type Tone } from "../ui/primitives.tsx";
import type { Lifecycle, Scrutiny } from "../adapters/index.tsx";

export const TERMINAL = new Set(["done", "cancelled", "archived"]);

export const LIFECYCLES: Array<{ value: Lifecycle; label: string; tone: Tone }> = [
  { value: "open", label: "Open", tone: "neutral" },
  { value: "deferred", label: "Deferred", tone: "muted" },
  { value: "done", label: "Done", tone: "done" },
  { value: "cancelled", label: "Cancelled", tone: "muted" },
  { value: "archived", label: "Archived", tone: "muted" },
];

export function lifecycleTone(lifecycle: string): Tone {
  return LIFECYCLES.find((l) => l.value === lifecycle)?.tone ?? "neutral";
}

export const lifecycleLabel = (lifecycle: string) => LIFECYCLES.find((l) => l.value === lifecycle)?.label ?? lifecycle.replace(/_/g, " ");

export const lifecycleOptions: SelectOption<Lifecycle>[] = LIFECYCLES.map((l) => ({ value: l.value, label: l.label, adornment: <StatusDot tone={l.tone} label={l.label} /> }));

export const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"] as const;

export function PriorityGlyph({ priority }: { priority: number | null }) {
  if (priority === null) return <span className="inline-block w-4 text-center text-xs text-ink-faint">—</span>;
  // Three bars; filled count = urgency. Ink only: Substrate stores 0 as the default, so red would misreport.
  const filled = Math.max(0, 3 - Math.floor((priority * 3) / 4.01));
  return (
    <span className="inline-flex h-3 w-4 items-end gap-[2px]" aria-label={`P${priority} ${PRIORITIES[priority]}`} title={`P${priority} · ${PRIORITIES[priority]}`}>
      {[0, 1, 2].map((i) => (
        // Full-round caps, like every other dot and marker in the glyph scale (XTRM-987): a 3px bar has
        // no corner to keep square, and `rounded-[1px]` was the last arbitrary radius literal.
        <span key={i} className={cx("w-[3px] rounded-full", i < filled ? "bg-ink-muted" : "bg-border-strong")} style={{ height: `${5 + i * 3}px` }} />
      ))}
    </span>
  );
}

export const priorityOptions: SelectOption<number>[] = PRIORITIES.map((label, p) => ({ value: p, label: `P${p} · ${label}`, adornment: <PriorityGlyph priority={p} /> }));

export const scrutinyOptions: SelectOption<Scrutiny>[] = (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }));

export const KIND_ICON: Record<string, IconName> = {
  epic: "work",
  task: "issues",
  bug: "alert",
  decision: "target",
  research: "search",
  followup: "forward",
};

export const kindIcon = (kind: string): IconName => KIND_ICON[kind] ?? "issues";

export function readinessLabel(state: string) {
  return state.replace(/_/g, " ");
}

export function formatDate(ms: number | null) {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Hierarchical locator first (shows epic lineage); the flat ref follows dimmed when it differs. */
/** `showAlias={false}` keeps the primary key alone: dense cells put the alias in the tooltip instead. */
export function IssueKey({ locator, humanRef, showAlias = true, className }: { locator?: string | null; humanRef: string; showAlias?: boolean; className?: string }) {
  const primary = locator || humanRef;
  return (
    <span className={cx("font-mono text-xs whitespace-nowrap", className)}>
      <span className="text-ink-muted">{primary}</span>
      {showAlias && primary !== humanRef && <span className="text-ink-faint opacity-70"> / {humanRef}</span>}
    </span>
  );
}
