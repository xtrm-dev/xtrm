import { useEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent } from "react";
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
 * set, a `Clear` item reports `null`. Options therefore take `Omit<OptionItem, "onSelect">`:
 * the label is the value, and a caller's own `onSelect` would be silently dropped.
 */
export function ToolbarFilter({ label, value, options, onChange }: { label: string; value: string | null; options: Array<Omit<OptionItem, "onSelect">>; onChange: (v: string | null) => void }) {
  const clear: OptionItem = { label: "Clear", icon: "close", onSelect: () => onChange(null) };
  const items: OptionItem[] = [
    ...options.map((item) => ({ ...item, onSelect: () => onChange(item.label) })),
    ...(value === null ? [] : [clear]),
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

/**
 * Tabs for one surface. Selected is ink text plus a 2px ink bottom bar; there is no fill (R5).
 * Keyboard follows WAI-ARIA tabs: a roving `tabIndex` keeps one stop in the tablist, Left/Right
 * wrap, Home/End jump, and selection follows focus (automatic activation suits a local view switch).
 */
export function ToolbarTabs({ tabs, value, onChange, label }: { tabs: Array<{ id: string; label: string; count?: number }>; value: string; onChange: (id: string) => void; label: string }) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    if (tab.id !== value) onChange(tab.id);
    buttons.current[index]?.focus();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Alt+Arrow is browser history and Cmd/Ctrl+Home/End is the document; a tablist must not eat them.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const last = tabs.length - 1;
    // `-1` means no tab matches `value`. The first tab holds the single stop, so forward keys land
    // there and backward keys wrap to the last tab, instead of the tablist going inert.
    const index = tabs.findIndex((tab) => tab.id === value);
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index <= 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };
  // With no tab matching `value` there is no selected tab, so the first tab keeps the single stop.
  const selected = tabs.findIndex((tab) => tab.id === value);
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex items-center gap-1">
      {tabs.map((tab, index) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on || (selected === -1 && index === 0) ? 0 : -1}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            onClick={() => onChange(tab.id)}
            className={cx(
              "relative flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs outline-none transition-colors",
              on
                ? "font-medium text-ink after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink hover:bg-hover focus-visible:bg-hover"
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
 * With a value, `count` is the matched rows and the optional `total` the loaded rows: `12 of 41`
 * when the consumer passes both, `12` when it has no total yet.
 */
export function ListFilter({ value, onChange, placeholder = "Filter this list", count, total }: { value: string; onChange: (v: string) => void; placeholder?: string; count?: number; total?: number }) {
  // A filter that mounts with a value is already filtering rows, so it mounts expanded (§4.2); it
  // still does not steal the caret, only a user-initiated open does.
  const [open, setOpen] = useState(() => value !== "");
  const wantsFocus = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // Opening and focusing are separate asks: pressing `/` on a filter that is open but blurred
  // (reachable since a value mounts it expanded) must take the caret without re-opening anything.
  const openIt = () => {
    if (open) {
      input.current?.focus();
      return;
    }
    wantsFocus.current = true;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) {
      wantsFocus.current = false;
      return;
    }
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    input.current?.focus();
  }, [open]);

  // A value set from outside (a saved view, a keyboard command) expands the filter too.
  useEffect(() => {
    if (value !== "") setOpen(true);
  }, [value]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      openIt();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `open` is a dependency on purpose: the handler must see the current open state, or `/`
    // dead-ends in two states. Open but blurred (a value mounted it expanded, then the user typed
    // and blurred): a stale `open=false` sets `wantsFocus` and calls `setOpen(true)`, which is a
    // no-op, so nothing takes the caret. Closed after Escape: a stale `open=true` focuses a null ref.
  }, [open]);

  return (
    <div
      onFocus={open ? undefined : openIt}
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
              {total === undefined ? count : `${count} of ${total}`}
              {total === undefined && <span className="sr-only"> matching</span>}
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
        <IconButton icon="filter" label="Filter this list" shortcut="/" onClick={openIt} />
      )}
    </div>
  );
}
