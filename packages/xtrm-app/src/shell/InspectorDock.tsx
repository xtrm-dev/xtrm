import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Icon } from "../ui/icon.tsx";
import { Tip, cx } from "../ui/primitives.tsx";
import { InspectorDrawer } from "./Inspector.tsx";
import { useShell } from "./context.tsx";
import { INSPECTOR } from "./layout.ts";

export const RAIL = 44;
const GAP = 24;

/**
 * Width of the expanding dock, clamped so it can never reach past the content card.
 * CLOSED → rail only; CONTEXTUAL/PINNED → rail + drawer; MAXIMIZED → the whole card.
 */
export function dockWidth(state: string, drawerWidth: number, cardWidth: number): number {
  if (state === "CLOSED") return RAIL;
  if (state === "MAXIMIZED") return RAIL + cardWidth;
  if (state === "PINNED") return RAIL + drawerWidth;
  return RAIL + Math.max(0, Math.min(drawerWidth, cardWidth - GAP));
}

export function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width || el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * v15 inspector: the floating rail IS the drawer's left edge. Opening grows the dock leftwards
 * over the content card (CONTEXTUAL/MAXIMIZED) or into the layout (PINNED); clicking the edge folds it back.
 */
export function InspectorDock({ cardWidth }: { cardWidth: number }) {
  const { layout, dispatch } = useShell();
  const { state, width, followLive } = layout.inspector;
  const open = state !== "CLOSED";
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const outer = state === "PINNED" ? dockWidth(state, width, cardWidth) : RAIL;
  const inner = dockWidth(state, width, cardWidth);
  const variant = state === "MAXIMIZED" ? "maximized" : state === "PINNED" ? "column" : "overlay";

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    setDragging(true);
    const move = (ev: PointerEvent) => drag.current && dispatch({ type: "drawer/resize", width: drag.current.w + drag.current.x - ev.clientX });
    const up = () => {
      drag.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ease = dragging ? "" : "transition-[width] duration-250 ease-in-out";

  return (
    <div data-testid="inspector-dock" data-state={state.toLowerCase()} className={cx("relative ml-1.5 shrink-0", ease)} style={{ width: outer }}>
      <div
        className={cx(
          "absolute top-0 right-0 bottom-0 z-30 flex overflow-hidden rounded-lg border bg-raised",
          open ? "border-border" : "border-border-muted bg-transparent",
          open && state !== "PINNED" && "shadow-float",
          ease,
        )}
        style={{ width: inner }}
      >
        <Tip label={open ? "Close inspector" : "Open inspector"} shortcut="Ctrl I" side="left">
          <button
            type="button"
            data-testid="inspector-rail"
            aria-label={open ? "Close inspector" : "Open inspector"}
            aria-expanded={open}
            onClick={() => dispatch({ type: open ? "drawer/close" : "drawer/open" })}
            className={cx(
              "group/edge relative flex shrink-0 flex-col items-center justify-center gap-2 outline-none focus-visible:bg-hover",
              open ? "border-r border-border-muted hover:bg-hover" : "hover:bg-hover/60",
            )}
            style={{ width: RAIL - 2 }}
          >
            {followLive && <span className="size-1.5 rounded-full bg-accent" />}
            <span className="flex h-12 w-5 items-center justify-center rounded-md border border-border-muted text-ink-faint transition-colors group-hover/edge:border-border group-hover/edge:text-ink">
              <Icon name="back" size="xs" className={cx("transition-transform duration-250", open && "rotate-180")} />
            </span>
            {layout.stack.length > 1 && (
              <span className="text-[0.65rem] text-ink-faint tabular">
                {layout.cursor + 1}/{layout.stack.length}
              </span>
            )}
          </button>
        </Tip>
        {open && (
          <div className="relative min-w-0 flex-1">
            {state !== "MAXIMIZED" && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector"
                aria-valuemin={INSPECTOR.min}
                aria-valuemax={INSPECTOR.max}
                aria-valuenow={width}
                onPointerDown={startResize}
                className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-border-strong/40"
              />
            )}
            <InspectorDrawer variant={variant} />
          </div>
        )}
      </div>
    </div>
  );
}
