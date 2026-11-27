import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "./popover.tsx";
import { cx } from "./primitives.tsx";

/**
 * A popover that expands out of its trigger (XTRM-1099).
 *
 * The popup opens on the same side as a normal popover, but its positioner sits on the trigger
 * rect (`sideOffset` = -anchor height) and its width is the anchor width. The trigger row is
 * rendered again inside the popup as the panel header, so the popup box is the trigger box and the
 * panel (an absolutely positioned surface behind the body) grows out of its outer edge. Height
 * animates with `grid-template-rows` (no `scaleY`) and opacity in the same 180 ms ease-out;
 * `prefers-reduced-motion` removes both transitions.
 *
 * The animation itself lives in `src/styles.css` under `[data-expand-popover]`, because the
 * starting/ending values come from Base UI's `data-starting-style` / `data-ending-style`.
 *
 * There is no detached variant: the console has no collapsed icon rail (the sidebar collapses to
 * zero extent, so neither trigger is rendered), and the operator asked for an expanding popover in
 * every state the component can appear in.
 *
 * The header is painted over the trigger, so it must not eat the pointer: the popup box and the
 * header are `pointer-events-none` (only the panel surface is interactive). A second press on the
 * row that opened the panel therefore reaches the trigger and closes it, as it did before the
 * change, while the header stays out of the accessibility tree and out of the tab order.
 */
export function ExpandPopover({
  side,
  label,
  open,
  onOpenChange,
  row,
  triggerClassName,
  popupClassName,
  bodyClassName,
  children,
}: {
  side: "top" | "bottom";
  /** Accessible name for the trigger and for the dialog. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trigger content. Rendered in the trigger and again, verbatim, as the panel header. */
  row: ReactNode | ((state: { open: boolean }) => ReactNode);
  /** The trigger element's classes; the header copy reuses them so both boxes measure identically. */
  triggerClassName: string;
  /**
   * The panel surface behind the body: background, shadow, text colour, and the outer radius — the
   * caller passes `rounded-b-*` for a drop-up and `rounded-t-*` for a downward panel. The popup box
   * itself is always the trigger rect.
   */
  popupClassName?: string;
  /** Classes for the content box under the header (padding, gaps). */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const content = typeof row === "function" ? row({ open }) : row;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [cap, setCap] = useState<number | null>(null);

  /**
   * Cap the panel at the room between the trigger edge and the viewport edge, so a short window
   * never pushes content off screen: the panel scrolls instead. `--available-height` (Base UI)
   * measures the floating box, which here is the trigger rect, so it overstates the room the
   * off-box surface really has.
   */
  useLayoutEffect(() => {
    if (!open) {
      setCap(null);
      return;
    }
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const room = side === "top" ? rect.top : window.innerHeight - rect.bottom;
      setCap(Math.max(0, Math.floor(room - 8)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, side]);

  const header = (
    <div
      aria-hidden="true"
      data-expand-popover-header=""
      // The same attribute Base UI puts on the trigger while open, so the trigger's
      // `data-[popup-open]:` classes paint the header identically.
      data-popup-open={open ? "" : undefined}
      className={cx("pointer-events-none relative shrink-0", triggerClassName)}
    >
      {content}
    </div>
  );

  /**
   * The panel. It is absolutely positioned against the header's outer edge, so the popup box
   * stays exactly the trigger rect while the panel grows: no reposition frame lags the
   * animation, and the header cannot drift off the trigger.
   */
  const surface = (
    <div
      data-expand-popover-surface=""
      className={cx(
        "pointer-events-auto absolute inset-x-0 overflow-hidden",
        side === "top" ? "bottom-full" : "top-full",
        popupClassName,
      )}
    >
      {/* The grid row is the animated height and clips while it grows; the box inside it scrolls
          when the viewport caps the panel, so a short window never pushes content off screen. */}
      <div data-expand-popover-body="" className="min-h-0 overflow-hidden">
        <div
          data-expand-popover-scroll=""
          style={cap === null ? undefined : { maxHeight: `${cap}px` }}
          // One scroller for the whole panel: the inline cap from the layout effect above is the only
          // height limit, the repo's scrollbar treatment sits beside the overflow, and children keep
          // their height instead of compressing, so the panel scrolls rather than squashing rows.
          className={cx("thin-scrollbar overflow-y-auto overscroll-contain [&>*]:shrink-0", bodyClassName)}
        >
          {children}
        </div>
      </div>
    </div>
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger ref={triggerRef} aria-label={label} className={triggerClassName}>
        {content}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          align="start"
          sideOffset={({ anchor }) => -anchor.height}
          // The popover must stay on its side and on the trigger's left edge: a flip or a shift
          // would break the header/trigger geometry the component exists for.
          collisionAvoidance={{ side: "none", align: "none", fallbackAxisSide: "none" }}
          // The positioner box also sits on the trigger rect; it must not swallow the press either.
          className="pointer-events-none z-50"
        >
          <Popover.Popup
            aria-label={label}
            data-expand-popover=""
            className="pointer-events-none relative w-[var(--anchor-width)] outline-none"
            onKeyDown={moveThroughRows}
          >
            {surface}
            {header}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Rows the arrow keys step through: the panel's controls plus any element marked
 * `data-popover-row` (the drop-up's status rows are read with the arrows, not the tab key).
 */
const ROW_SELECTOR = [
  "input:not([disabled])",
  "button:not([disabled])",
  "a[href]",
  "[role='option']",
  "[role='button']",
  "[tabindex]:not([tabindex='-1'])",
  "[data-popover-row]",
].join(",");

function moveThroughRows(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
    (node) => !node.closest('[aria-hidden="true"]') && !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true",
  );
  if (rows.length === 0) return;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement as HTMLElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = current === -1 ? (step === 1 ? 0 : rows.length - 1) : (current + step + rows.length) % rows.length;
  rows[next]?.focus();
}
