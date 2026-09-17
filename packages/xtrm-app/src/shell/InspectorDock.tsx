import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../ui/icon.tsx";
import { Tip, cx } from "../ui/primitives.tsx";
import { ResizablePanel } from "../ui/resizable.tsx";
import { InspectorDrawer } from "./Inspector.tsx";
import { useShell } from "./context.tsx";
import { INSPECTOR, INSPECTOR_MAXIMIZE_KEY, modShortcut } from "./layout.ts";

export const RAIL = 22;

/**
 * In-flow inspector width: the rail is always reserved so open/close/maximize
 * animate as one motion-panels motion with the sidebar and main fill.
 * CLOSED → rail only; CONTEXTUAL/PINNED → rail + drawer; MAXIMIZED → fill the group (covers the card area, main squeezes to 0).
 */
export function dockWidth(state: string, drawerWidth: number): number | `${number}%` {
  if (state === "CLOSED") return RAIL;
  if (state === "MAXIMIZED") return "100%";
  return RAIL + drawerWidth;
}

/**
 * v16 inspector: a real layout column in the same ResizableGroup as the sidebar
 * and main fill — one motion-panels driver, one SHELL_MOTION.transition.
 * CONTEXTUAL and PINNED both push (no overlay, no clipping); MAXIMIZED fills
 * the group so it covers the card area. The rail carries two edge-handle pills
 * (open/close + maximize/restore) sharing the sidebar edge visual language.
 */
export function InspectorDock() {
  const { layout, dispatch } = useShell();
  const { state, width } = layout.inspector;
  const open = state !== "CLOSED";
  const maximized = state === "MAXIMIZED";

  const size = open ? (maximized ? ("100%" as const) : RAIL + width) : RAIL;
  const variant = maximized ? "maximized" : "column";

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => dispatch({ type: "drawer/resize", width: startW + startX - ev.clientX });
    const up = () => {
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
      size={size}
      minSize={RAIL}
      maxSize={5000}
      className="ml-1.5 self-stretch"
    >
      <div
        className={cx(
          "flex h-full min-h-0 overflow-hidden rounded-lg border bg-raised",
          // In-flow columns use the muted card border with no shadow (no floating overlay).
          !open ? "border-border-muted bg-transparent" : "border-border-muted",
        )}
      >
        <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 py-2" style={{ width: RAIL }}>
          <Tip label={open ? "Close inspector" : "Open inspector"} shortcut={modShortcut("I")} side="left">
            <button
              type="button"
              data-testid="inspector-rail"
              aria-label={open ? "Close inspector" : "Open inspector"}
              aria-expanded={open}
              onClick={() => dispatch({ type: open ? "drawer/close" : "drawer/open" })}
              className="group/edge flex w-4 shrink-0 items-center justify-center outline-none"
            >
              <span className="flex h-10 w-1 items-center justify-center overflow-hidden rounded-full bg-border-muted text-ink-faint transition-all duration-200 motion-reduce:transition-none group-hover/edge:h-12 group-hover/edge:w-4 group-hover/edge:bg-hover group-hover/edge:text-ink group-focus-visible/edge:h-12 group-focus-visible/edge:w-4 group-focus-visible/edge:bg-hover">
                <Icon name="back" size="xs" className={cx("shrink-0 opacity-0 transition-opacity motion-reduce:transition-none group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100", open && "rotate-180")} />
              </span>
            </button>
          </Tip>
          {open && (
            <Tip label={maximized ? "Restore inspector" : "Maximize inspector"} shortcut={modShortcut(INSPECTOR_MAXIMIZE_KEY)} side="left">
              <button
                type="button"
                data-testid="inspector-maximize-rail"
                aria-label={maximized ? "Restore inspector" : "Maximize inspector"}
                aria-pressed={maximized}
                onClick={() => dispatch({ type: maximized ? "drawer/restore" : "drawer/maximize" })}
                className="group/edge flex w-4 shrink-0 items-center justify-center outline-none"
              >
                <span className="flex h-10 w-1 items-center justify-center overflow-hidden rounded-full bg-border-muted text-ink-faint transition-all duration-200 motion-reduce:transition-none group-hover/edge:h-12 group-hover/edge:w-4 group-hover/edge:bg-hover group-hover/edge:text-ink group-focus-visible/edge:h-12 group-focus-visible/edge:w-4 group-focus-visible/edge:bg-hover">
                  <Icon name={maximized ? "restore" : "maximize"} size="xs" className="shrink-0 opacity-0 transition-opacity motion-reduce:transition-none group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100" />
                </span>
              </button>
            </Tip>
          )}
        </div>
        {open && (
          <div className="relative min-w-0 flex-1">
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
