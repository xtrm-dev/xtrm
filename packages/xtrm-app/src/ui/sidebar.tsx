import { Children, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { NavRail } from "./nav-rail.tsx";
import { Row, StatusDot, cx, type Tone } from "./primitives.tsx";

export { NavRail, NavRailItem } from "./nav-rail.tsx";

/** Collapsible labelled group: Workspace / GitHub / System. */
export function SidebarSection({ label, children, defaultOpen = true }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/sec flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-ink-faint outline-none hover:text-ink-muted focus-visible:bg-hover"
      >
        {label}
        <Icon name="chevronDown" size="xs" className={cx("opacity-70 transition group-hover/sec:opacity-100 group-focus-visible/sec:opacity-100", !open && "-rotate-90")} />
      </button>
      <div className={cx("grid transition-[grid-template-rows] duration-150", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="flex min-h-0 flex-col gap-px overflow-hidden" inert={!open}>
          {children}
        </div>
      </div>
    </section>
  );
}

/** `Row` preset for the contextual sidebar: icon, label, count or status, hover/focus actions. */
export function SidebarRow({
  icon,
  label,
  count,
  status,
  selected,
  deferred,
  children,
  expanded,
  onToggle,
  onActivate,
  actions,
}: {
  icon: IconName;
  label: string;
  count?: number | null;
  status?: { tone: Tone; label: string };
  selected?: boolean;
  deferred?: boolean;
  /** Nested rows, rendered on a NavRail below this one (§4.1). */
  children?: ReactNode;
  /** Nested rows are shown below this one; pass with `onToggle` to render the disclosure chevron. */
  expanded?: boolean;
  onToggle?: () => void;
  onActivate?: () => void;
  actions?: ReactNode;
}) {
  const row = (
    <Row
      density="sidebar"
      selected={selected}
      onActivate={onActivate}
      actions={actions}
      // Deferred is a fact for the surface, not a fainter ink: ink-faint fails 4.5:1 at 13px on the sidebar.
      data-deferred={deferred || undefined}
      // ArrowRight expands and ArrowLeft collapses, the same keys as the issue-tree rows (§4.1).
      onKeyDown={
        onToggle
          ? (event) => {
              if (event.key === "ArrowRight" && !expanded) {
                event.preventDefault();
                onToggle();
              } else if (event.key === "ArrowLeft" && expanded) {
                event.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      // Sidebar rows sit at the Work/Agent switch height (28px) so no navigation row outweighs the
      // switch above it; the label stays at 14px and the glyph at 14px beside it.
      className={cx("h-7 gap-2", selected ? "bg-pressed text-ink" : "text-ink-muted")}
    >
      {/* The 14px glyph sits in a 1rem box: the label then starts on the same 42px column the
          rail's child labels use (--x-rail-text), at every root size. */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Icon name={icon} size="xs" className={selected ? "text-ink" : "text-ink-faint"} />
      </span>
      <span className="truncate text-base font-semibold">{label}</span>
      {status && <StatusDot tone={status.tone} label={status.label} />}
      {count != null && <span className={cx("text-xs text-ink-faint tabular group-hover/row:hidden group-focus-within/row:hidden", !onToggle && "ml-auto")}>{count}</span>}
      {onToggle && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="ml-auto -mr-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-faint outline-none hover:text-ink-muted focus-visible:bg-hover"
        >
          <Icon name="chevronDown" size="xs" className={cx("transition-transform", !expanded && "-rotate-90")} />
        </button>
      )}
    </Row>
  );
  // Expression children such as `{flag && <Rows/>}` arrive as `[false, false]`, which is truthy:
  // count rendered children instead, so a section never shows an empty rail group (review finding 1).
  if (Children.toArray(children).length === 0) return row;
  return (
    <>
      {row}
      <NavRail label={label}>{children}</NavRail>
    </>
  );
}
