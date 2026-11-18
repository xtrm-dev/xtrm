import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Icon, type IconName } from "./icon.tsx";
import { OptionsMenu, type OptionItem } from "./menu.tsx";
import { IconButton, TOOLBAR_CONTROL, TOOLBAR_GHOST, cx } from "./primitives.tsx";

/**
 * Toolbar primitives (§4.2). Every control is a ghost at rest: fill is the selection and the focus
 * state, not the resting state. The belt order stays
 * `[SourceBadge] [primary] [tabs or filters] [ListFilter] … [layout] [options]`.
 */

/** A text or icon button in the toolbar. `primary` is the one action of the surface (`New issue`). */
export function ToolbarButton({ icon, primary, className, children, ...button }: ComponentProps<"button"> & { icon?: IconName; primary?: boolean }) {
  return (
    <button
      {...button}
      type={button.type ?? "button"}
      className={cx(
        TOOLBAR_CONTROL,
        primary ? "text-ink font-medium hover:bg-hover focus-visible:bg-hover" : TOOLBAR_GHOST,
        className,
      )}
    >
      {icon && <Icon name={icon} size="text" />}
      {children}
    </button>
  );
}

/**
 * A named filter whose value lives in the label: `Status ▾`, then `Status: open` with the value in
 * ink. The menu is `OptionsMenu`; selecting an option reports its label to `onChange`. With a value
 * set, a `Clear` item reports `null`. Option `onSelect` hooks are not used: the label is the value.
 */
export function ToolbarFilter({ label, value, options, onChange }: { label: string; value: string | null; options: OptionItem[]; onChange: (v: string | null) => void }) {
  const items: OptionItem[] =
    value === null
      ? options.map((item) => ({ ...item, onSelect: () => onChange(item.label) }))
      : [
          ...options.map((item) => ({ ...item, onSelect: () => onChange(item.label) })),
          { label: "Clear", icon: "close", onSelect: () => onChange(null) },
        ];
  return (
    <OptionsMenu
      label={`${label} filter`}
      trigger={
        <button
          type="button"
          aria-label={value === null ? `${label} filter` : `${label} filter: ${value}`}
          className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST)}
        >
          {label}
          {value !== null && (
            <>
              : <span className="font-medium text-ink">{value}</span>
            </>
          )}
          <Icon name="chevronDown" size="micro" className="text-ink-faint" />
        </button>
      }
      items={items}
    />
  );
}

/** Tabs for one surface. Selected is ink text plus a 2px ink bottom bar; there is no fill (R5). */
export function ToolbarTabs({ tabs, value, onChange, label }: { tabs: Array<{ id: string; label: string; count?: number }>; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-1">
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={cx(
              "relative flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs outline-none transition-colors",
              on
                ? "font-medium text-ink after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink"
                : TOOLBAR_GHOST,
            )}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tabular text-ink-faint">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The local list filter (§4.2), distinct from Ctrl+K: it filters the rows already loaded in the
 * current surface and never navigates. At rest it is a 28px `filter` icon button; on click, `/` or
 * keyboard focus it widens to 192px and takes focus. Escape clears and collapses.
 */
export function ListFilter({ value, onChange, placeholder = "Filter this list", count }: { value: string; onChange: (v: string) => void; placeholder?: string; count?: number }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={cx(
        "flex h-7 shrink-0 items-center rounded-md transition-[width] duration-150 motion-reduce:transition-none",
        open ? "w-48 gap-1 bg-hover px-1.5" : "w-7",
      )}
    >
      {open ? (
        <>
          <Icon name="filter" size="text" className="shrink-0 text-ink-faint" />
          <input
            ref={input}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              onChange("");
              setOpen(false);
            }}
            onBlur={() => {
              if (!value) setOpen(false);
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
          />
          {value !== "" && count !== undefined && (
            <span aria-live="polite" title="Rows matching this filter" className="shrink-0 text-xs tabular text-ink-faint">
              {count}
            </span>
          )}
          {value !== "" && (
            <IconButton
              icon="close"
              label="Clear filter"
              onClick={() => {
                onChange("");
                input.current?.focus();
              }}
              className="size-5"
            />
          )}
        </>
      ) : (
        <IconButton icon="filter" label="Filter this list" shortcut="/" onClick={() => setOpen(true)} />
      )}
    </div>
  );
}
