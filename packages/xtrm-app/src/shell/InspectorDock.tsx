import { useLayoutEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cubicBezier } from "motion";
import { useAnimate, useReducedMotion } from "motion/react";
import { Icon } from "../ui/icon.tsx";
import { Tip, cx } from "../ui/primitives.tsx";
import { ResizablePanel } from "../ui/resizable.tsx";
import { InspectorDrawer } from "./Inspector.tsx";
import { useShell } from "./context.tsx";
import { INSPECTOR, INSPECTOR_MAXIMIZE_KEY, SHELL_MOTION, modShortcut } from "./layout.ts";

export const RAIL = 22;

const ease = cubicBezier(...SHELL_MOTION.transition.ease);

/**
 * In-flow width of the dock Panel inside the shell ResizableGroup.
 * CLOSED and CONTEXTUAL reserve only the rail: CONTEXTUAL floats over the main
 * column instead of taking space. PINNED is a real column beside main.
 * MAXIMIZED fills the group (covers the card area, main squeezes to 0).
 */
export function dockWidth(state: string, drawerWidth: number): number | `${number}%` {
  if (state === "CLOSED" || state === "CONTEXTUAL") return RAIL;
  if (state === "MAXIMIZED") return "100%";
  return RAIL + drawerWidth;
}

/**
 * Minimum width of the visible frame (rail + drawer). The frame always fills its
 * dock (width 100%, driven by the panel motion) and never gets narrower than this,
 * so CONTEXTUAL overhangs the main column leftwards while its dock stays a rail.
 */
export function frameMinWidth(state: string, drawerWidth: number): number {
  return state === "CLOSED" ? RAIL : RAIL + drawerWidth;
}

/** Discreet vertical pill, same treatment as the sidebar edge handle. */
function RailPill({ icon, iconClassName, ...props }: { icon: "back" | "forward" | "sidebar"; iconClassName?: string } & React.ComponentProps<"button">) {
  return (
    <button type="button" {...props} className="group/edge flex w-5 shrink-0 items-center justify-center outline-none">
      <span className="flex h-12 w-2 items-center justify-center overflow-hidden rounded-full bg-border-muted text-ink-faint transition-all duration-200 motion-reduce:transition-none group-hover/edge:h-14 group-hover/edge:w-5 group-hover/edge:bg-hover group-hover/edge:text-ink group-focus-visible/edge:h-14 group-focus-visible/edge:w-5 group-focus-visible/edge:bg-hover">
        <Icon name={icon} size="xs" className={cx("shrink-0 opacity-0 transition-opacity motion-reduce:transition-none group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100", iconClassName)} />
      </span>
    </button>
  );
}

/**
 * v16 inspector. The dock Panel lives in the same ResizableGroup as the sidebar
 * and main fill (one motion-panels driver). The visible frame is absolutely
 * anchored to the dock's right edge and full height, so:
 * - CONTEXTUAL (default open) floats over the main column on --shadow-panel, no border;
 * - PINNED keeps the same borderless panel, so both states read as their own background;
 * - MAXIMIZED fills the group.
 * Only the frame's min-width animates (SHELL_MOTION, same curve as the panels);
 * everything else follows the panel motion, so maximize/restore stay in sync.
 * Resizing by drag is instant.
 */
export function InspectorDock() {
  const { layout, dispatch } = useShell();
  const { state, width, followLive } = layout.inspector;
  const open = state !== "CLOSED";
  const maximized = state === "MAXIMIZED";
  const pinned = state === "PINNED";
  const variant = maximized ? "maximized" : pinned ? "column" : "overlay";
  const reduced = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const minWidth = frameMinWidth(state, width);
  const [initialMinWidth] = useState(minWidth);
  const [frame, animate] = useAnimate<HTMLDivElement>();
  // Start in the layout phase, the same commit in which motion-panels starts the
  // sidebar/main/dock motion. motion does not tween min-width directly, so it
  // tweens a CSS variable the style reads. Its first write lands one frame late,
  // so paint the first step now and let the tween continue from one frame in.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const target = `${minWidth}px`;
    if (reduced || dragging) {
      animate(el, { "--frame-min": target } as never, { duration: 0 });
      return;
    }
    const from = Number.parseFloat(getComputedStyle(el).getPropertyValue("--frame-min")) || minWidth;
    if (from === minWidth) return;
    const step = 1000 / 60 / SHELL_MOTION.durationMs;
    el.style.setProperty("--frame-min", `${from + (minWidth - from) * ease(step)}px`);
    animate(el, { "--frame-min": target } as never, { ...SHELL_MOTION.transition, delay: -step * SHELL_MOTION.transition.duration });
  }, [animate, frame, minWidth, reduced, dragging]);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    const move = (ev: PointerEvent) => dispatch({ type: "drawer/resize", width: startW + startX - ev.clientX });
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <ResizablePanel
      data-testid="inspector-dock"
      data-state={state.toLowerCase()}
      size={dockWidth(state, width)}
      minSize={RAIL}
      maxSize={5000}
      className="relative self-stretch"
    >
      {/* The frame starts at the top bar's edge and the top bar centres its 32 px pill in 44 px, so a
          6 px inset at the bottom (bottom-1.5) mirrors that gap at every viewport height. */}
      <div
        ref={frame}
        data-testid="inspector-frame"
        style={{ "--frame-min": `${initialMinWidth}px`, minWidth: "var(--frame-min)" } as React.CSSProperties}
        className={cx(
          // No border: the panel reads as its own background. --shadow-panel lifts it without the 1px
          // ring that --shadow-float paints, so no hairline outlines the panel in another colour.
          "absolute top-0 bottom-1.5 z-30 flex min-h-0 overflow-hidden rounded-lg bg-raised",
          maximized ? "inset-x-2" : "right-0 w-full",
          !open ? "bg-sidebar" : "shadow-panel",
        )}
      >
        <button
          type="button"
          data-testid="inspector-rail"
          aria-label={open ? "Close inspector" : "Open inspector"}
          aria-expanded={open}
          onClick={() => dispatch({ type: open ? "drawer/close" : "drawer/open" })}
          className="group/rail flex shrink-0 flex-col items-center justify-end gap-1.5 py-2 transition-colors hover:bg-hover focus-visible:bg-hover"
          style={{ width: RAIL }}
        >
          {followLive && <span className="size-1.5 rounded-full bg-accent" />}
          <Icon name="sidebar" size="xs" className="text-ink-faint transition-colors group-hover/rail:text-ink group-focus-visible/rail:text-ink scale-x-[-1]" />
        </button>
        {open && (
          <div className="relative min-h-0 min-w-0 flex-1">
            {!maximized && (
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
    </ResizablePanel>
  );
}
