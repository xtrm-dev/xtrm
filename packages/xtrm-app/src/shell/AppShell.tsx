import { Tooltip } from "@base-ui/react/tooltip";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { GLOBAL_DESTINATIONS } from "../app/destinations.ts";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Tip, cx } from "../ui/primitives.tsx";
import { FillPanel, ResizableGroup, ResizeHandle, ResizablePanel } from "../ui/resizable.tsx";
import { ContextSidebar, SidebarReopenRail, useGo } from "./ContextSidebar.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { InspectorDrawer } from "./Inspector.tsx";
import { ShellProvider, useShell } from "./context.tsx";
import { INSPECTOR, SIDEBAR } from "./layout.ts";

/** Persistent application-level rail: never collapses, never shows repository state (§3). */
function GlobalRail() {
  const { theme, toggleTheme, openPalette } = useShell();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const go = useGo();
  const activeId = pathname.startsWith("/rep/")
    ? pathname.includes("/governance/program")
      ? "program"
      : "repositories"
    : GLOBAL_DESTINATIONS.find((d) => pathname.startsWith(d.path))?.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || !Number.isInteger(n)) return;
      const d = GLOBAL_DESTINATIONS[n - 1];
      if (!d) return;
      e.preventDefault();
      go(d.path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <nav aria-label="Global" data-testid="global-rail" className="flex w-12 shrink-0 flex-col items-center gap-1 py-2">
      <div aria-hidden className="mb-2 flex size-7 items-center justify-center rounded-md bg-accent text-[0.7rem] font-semibold tracking-tight text-white">X</div>
      {GLOBAL_DESTINATIONS.map((d, i) => {
        const active = d.id === activeId;
        return (
          <Tip key={d.id} label={d.deferred ? `${d.label} · deferred` : d.label} shortcut={`Ctrl ${i + 1}`} side="right">
            <button
              type="button"
              aria-label={d.label}
              aria-current={active ? "page" : undefined}
              onClick={() => go(d.path)}
              className={cx(
                "relative flex size-9 items-center justify-center rounded-md outline-none transition-colors",
                active ? "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--x-border-muted)]" : "text-ink-faint hover:bg-hover hover:text-ink-muted",
              )}
            >
              {active && <span aria-hidden className="absolute top-2 bottom-2 -left-1.5 w-0.5 rounded-full bg-accent" />}
              <Icon name={d.icon} size="md" />
            </button>
          </Tip>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <IconButton icon="search" label="Search" shortcut="Ctrl K" size="md" tooltipSide="right" className="text-ink-faint" onClick={() => openPalette("search")} />
        <IconButton icon="command" label="Commands" shortcut="Ctrl Shift K" size="md" tooltipSide="right" className="text-ink-faint" onClick={() => openPalette("commands")} />
        <IconButton
          icon={theme === "dark" ? "sun" : "moon"}
          label={theme === "dark" ? "Light theme" : "Dark theme"}
          aria-pressed={theme === "dark"}
          size="md"
          tooltipSide="right"
          className="text-ink-faint"
          onClick={toggleTheme}
        />
        <IconButton icon="settings" label="Settings" size="md" tooltipSide="right" className="text-ink-faint" disabled />
      </div>
    </nav>
  );
}

/** Right-edge rail inside the content card; the overlay drawer attaches to it with no gap (§6, PRD §7.2). */
function InspectorRail() {
  const { layout, dispatch } = useShell();
  const open = layout.inspector.state !== "CLOSED";
  return (
    <div data-testid="inspector-rail" className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border-muted bg-surface py-1.5">
      <IconButton
        icon="inspector"
        label={open ? "Close inspector" : "Open inspector"}
        shortcut="Ctrl I"
        tooltipSide="left"
        active={open}
        aria-pressed={open}
        onClick={() => dispatch({ type: open ? "drawer/close" : "drawer/open" })}
      />
      {layout.stack.length > 1 && (
        <span className="text-[0.65rem] text-ink-faint tabular" title="Inspector history depth">
          {layout.cursor + 1}/{layout.stack.length}
        </span>
      )}
      {layout.inspector.followLive && <span className="mt-1 size-1.5 rounded-full bg-accent" title="Following live updates" />}
    </div>
  );
}

function ShellLayout() {
  const { layout, dispatch } = useShell();
  const { sidebar, inspector } = layout;
  const pinned = inspector.state === "PINNED";

  return (
    <div className="flex h-full min-h-0 bg-deep text-ink">
      <GlobalRail />
      {!sidebar.open && <SidebarReopenRail />}
      <ResizableGroup className="py-1.5 pr-1.5">
        {sidebar.open && (
          <ResizablePanel
            data-testid="sidebar-panel"
            size={sidebar.width}
            minSize={SIDEBAR.min}
            maxSize={SIDEBAR.max}
            onSizeChange={(width) => dispatch({ type: "sidebar/resize", width })}
          >
            <ContextSidebar />
          </ResizablePanel>
        )}
        {sidebar.open && <ResizeHandle label="Resize sidebar" />}
        <FillPanel data-testid="main-panel" className="flex">
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border-muted bg-surface">
            {/* The drawer renders inside this region, so it cannot cover the rails by construction (§7.2). */}
            <main data-testid="primary-region" className="relative flex min-w-0 flex-1 flex-col">
              <Outlet />
              {inspector.state === "CONTEXTUAL" && (
                <div className="absolute inset-y-0 right-0 z-20 max-w-full" style={{ width: inspector.width }}>
                  <InspectorDrawer variant="overlay" />
                </div>
              )}
              {inspector.state === "MAXIMIZED" && (
                <div className="absolute inset-0 z-20">
                  <InspectorDrawer variant="maximized" />
                </div>
              )}
            </main>
            {!pinned && <InspectorRail />}
          </div>
        </FillPanel>
        {pinned && <ResizeHandle label="Resize inspector" />}
        {pinned && (
          <ResizablePanel
            data-testid="inspector-panel"
            size={inspector.width}
            minSize={INSPECTOR.min}
            maxSize={INSPECTOR.max}
            onSizeChange={(width) => dispatch({ type: "drawer/resize", width })}
          >
            <InspectorDrawer variant="column" />
          </ResizablePanel>
        )}
      </ResizableGroup>
      <GlobalSearch />
    </div>
  );
}

export function AppShell() {
  return (
    <Tooltip.Provider delay={350}>
      <ShellProvider>
        <ShellLayout />
      </ShellProvider>
    </Tooltip.Provider>
  );
}
