import { Tooltip } from "./tooltip.tsx";
import type { ComponentProps, ReactNode } from "react";
import type { DataSource } from "../adapters/types.ts";
import { Icon, type IconName } from "./icon.tsx";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// --- Surface --------------------------------------------------------------

const SURFACE = { deep: "bg-deep", sidebar: "bg-sidebar", surface: "bg-surface", raised: "bg-raised", control: "bg-control" } as const;

/** The only way to set a background role (§15.2). */
export function Surface({ role, bordered, className, ...props }: ComponentProps<"div"> & { role: keyof typeof SURFACE; bordered?: boolean }) {
  return <div {...props} className={cx(SURFACE[role], bordered && "border border-border-muted", className)} />;
}

// --- Tooltip + IconButton -------------------------------------------------

export function Tip({ label, shortcut, children, side = "bottom" }: { label: string; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children as React.ReactElement} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup className="z-50 flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-xs text-ink shadow-float">
            {label}
            {shortcut && <Kbd>{shortcut}</Kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-border px-1 font-sans text-2xs text-ink-faint">{children}</kbd>;
}

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon: IconName;
  label: string;
  shortcut?: string;
  size?: "sm" | "md";
  /** Glyph size override. A toolbar or 20px control passes `text` so the glyph matches its text. */
  iconSize?: ComponentProps<typeof Icon>["size"];
  active?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
};

/**
 * Icon-only button with a required accessible label and tooltip.
 *
 * The default glyph follows the control (XTRM-934): a `size-7` control takes `text` (0.8125rem,
 * the step of the label beside it), a `size-9` control takes `md`. It used to default to `sm`
 * (1rem), so 18 of 20 call sites rendered a 16px glyph in a 28px box next to 11.5px text, and the
 * icon outweighed its own label. Pass `iconSize="sm"` where a 16px mark is intended on purpose
 * (brand marks, the source tree).
 */
export function IconButton({ icon, label, shortcut, size = "sm", iconSize, active, tooltipSide, className, ...props }: IconButtonProps) {
  return (
    <Tip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        {...props}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink active:bg-pressed disabled:pointer-events-none disabled:opacity-40",
          size === "sm" ? "size-7" : "size-9",
          active && "bg-hover text-ink",
          className,
        )}
      >
        <Icon name={icon} size={iconSize ?? (size === "sm" ? "text" : "md")} />
      </button>
    </Tip>
  );
}

// --- Row ------------------------------------------------------------------

type RowProps = Omit<ComponentProps<"div">, "onClick"> & {
  density?: "sidebar" | "list" | "table";
  selected?: boolean;
  onActivate?: () => void;
  /** Secondary actions: revealed on hover and keyboard focus, never hover-only. */
  actions?: ReactNode;
};

/** The single collection row. Sidebar and list rows share anatomy, differ by density. */
export function Row({ density = "list", selected, onActivate, actions, className, children, onKeyDown, ...props }: RowProps) {
  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-current={selected ? "true" : undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (onActivate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
        onKeyDown?.(e);
      }}
      {...props}
      className={cx(
        "group/row relative flex min-w-0 items-center gap-2.5 outline-none transition-colors focus-visible:bg-hover",
        density === "table" ? "h-full rounded-none" : "rounded-md",
        density === "sidebar" ? "h-7 px-2" : density === "list" && "h-8 px-3",
        onActivate && "cursor-default hover:bg-hover",
        selected && "bg-hover text-ink",
        className,
      )}
    >
      {children}
      {actions && (
        <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

// --- StatusDot ------------------------------------------------------------

export type Tone = "neutral" | "accent" | "active" | "done" | "danger" | "muted";

const DOT: Record<Tone, string> = {
  neutral: "border border-ink-muted bg-transparent",
  accent: "bg-accent",
  active: "border-[1.5px] border-accent bg-transparent",
  done: "bg-ink-faint",
  danger: "bg-danger",
  muted: "border border-dashed border-ink-faint bg-transparent",
};

/** Ink/shape status indicator; colour only for accent and danger (§15.1). */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center" title={label}>
      <span className={cx("size-2 rounded-full", DOT[tone])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// --- ContentPanel ---------------------------------------------------------

/** Bounded scroll container for code, diff, output, and long fields. */
export function ContentPanel({ className, mono, ...props }: ComponentProps<"div"> & { mono?: boolean }) {
  return (
    <div
      {...props}
      className={cx("thin-scrollbar max-h-72 overflow-auto rounded-md border border-border-muted bg-deep/60 px-3 py-2 text-sm", mono && "font-mono text-xs leading-5", className)}
    />
  );
}

// --- EmptyState / LoadingState / ErrorState -------------------------------

export function EmptyState({ icon, title, children, className }: { icon?: IconName; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-2 px-6 py-16 text-center", className)}>
      {/*
        No bordered tile around the mark (XTRM-934): an empty state is a hairline surface too, and a
        36px rounded box made the icon the loudest element on eleven pages.
      */}
      {icon && <Icon name={icon} size="md" className="mb-1 text-ink-faint" />}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function LoadingState({ rows = 8, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-1 px-3 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3">
          <div className="size-2 rounded-full bg-control" />
          <div className="h-2.5 rounded bg-control" style={{ width: `${38 + ((i * 17) % 45)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title, error }: { title: string; error: unknown }) {
  return (
    <EmptyState icon="alert" title={title}>
      <span className="text-danger">{error instanceof Error ? error.message : String(error)}</span>
    </EmptyState>
  );
}

// --- Source badge ---------------------------------------------------------

/** Makes fixture-backed data visible; live data needs no badge. */
export function SourceBadge({ source }: { source: DataSource }) {
  if (source === "live") return null;
  return (
    <Tip label="Typed development fixture behind the adapter; not live data">
      <span className="rounded-sm border border-dashed border-border-strong px-1.5 text-xs text-ink-muted">fixture</span>
    </Tip>
  );
}

// --- Surface toolbar ------------------------------------------------------

/** Console toolbar: one row of 28px controls above a surface. The surface below owns its rule. */
export function SurfaceToolbar({ children }: { children?: ReactNode }) {
  return <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 px-1.5 py-1.5">{children}</div>;
}

/** 28px toolbar control. `TOOLBAR_GHOST` is the only resting style: chrome is quiet (§2.2, §4.2). */
export const TOOLBAR_CONTROL = "flex h-7 items-center gap-1 rounded-md px-1.5 text-xs outline-none transition-colors";
export const TOOLBAR_GHOST = "text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover";

/** "just now" / "4d ago"; absolute dates stay as-is. */
export function ago(iso: string | number | null): string {
  const r = relativeTime(iso);
  return r === "—" ? r : r === "now" ? "just now" : /^\d+[mhd]$/.test(r) ? `${r} ago` : r;
}

export function relativeTime(iso: string | number | null, now = Date.now()): string {
  if (iso === null) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 86_400 * 30) return `${Math.floor(s / 86_400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
