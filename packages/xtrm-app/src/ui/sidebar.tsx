import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { Row, StatusDot, cx, type Tone } from "./primitives.tsx";

/** Collapsible labelled group: Work / Code / System / Governance (§8.2). */
export function SidebarSection({ label, children, defaultOpen = true }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/sec flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-faint outline-none hover:text-ink-muted focus-visible:bg-hover"
      >
        {label}
        <Icon name="chevronDown" size="xs" className={cx("opacity-0 transition group-hover/sec:opacity-100 group-focus-visible/sec:opacity-100", !open && "-rotate-90")} />
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
  indent,
  onActivate,
  actions,
}: {
  icon: IconName;
  label: string;
  count?: number | null;
  status?: { tone: Tone; label: string };
  selected?: boolean;
  deferred?: boolean;
  /** Sub-row under the destination it belongs to. */
  indent?: boolean;
  onActivate: () => void;
  actions?: ReactNode;
}) {
  return (
    <Row
      density="sidebar"
      selected={selected}
      onActivate={onActivate}
      actions={actions}
      style={indent ? { paddingLeft: "1.75rem" } : undefined}
      className={cx("h-8", selected ? "bg-pressed text-ink" : "text-ink-muted")}
    >
      <Icon name={icon} size="xs" className={selected ? "text-ink" : "text-ink-faint"} />
      <span className={cx("truncate", deferred && "text-ink-faint")}>{label}</span>
      {status && <StatusDot tone={status.tone} label={status.label} />}
      {count != null && <span className="ml-auto text-xs text-ink-faint tabular group-hover/row:hidden group-focus-within/row:hidden">{count}</span>}
    </Row>
  );
}
