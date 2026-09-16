import { Tooltip } from "@base-ui/react/tooltip";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { MODES, modeForPath, modeHref } from "../app/destinations.ts";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Kbd, Tip, cx } from "../ui/primitives.tsx";
import { FillPanel, ResizableGroup, ResizeHandle, ResizablePanel } from "../ui/resizable.tsx";
import { ContextSidebar, useGo } from "./ContextSidebar.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { InspectorDock, useElementWidth } from "./InspectorDock.tsx";
import { ShellProvider, useShell } from "./context.tsx";
import { SIDEBAR } from "./layout.ts";

/** Full-width top bar: brand, global search, command and theme (v13 reference). */
function TopBar() {
  const { theme, toggleTheme, openPalette, repo } = useShell();
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 px-2" data-testid="top-bar">
      <div className="flex w-12 shrink-0 justify-center">
        <div aria-hidden className="flex size-7 items-center justify-center rounded-md bg-accent text-[0.7rem] font-semibold tracking-tight text-white">X</div>
      </div>
      <span className="hidden text-sm font-medium text-ink md:inline">XTRM Console</span>
      <button
        type="button"
        onClick={() => openPalette("search")}
        aria-label="Search"
        className="mx-auto flex h-8 w-full max-w-xl items-center gap-2 rounded-md border border-border-muted bg-surface/70 px-3 text-left text-sm text-ink-faint outline-none hover:border-border hover:text-ink-muted focus-visible:border-border-strong"
      >
        <Icon name="search" size="xs" />
        <span className="flex-1 truncate">Search issues, repositories, Program in {repo.name} or the workspace…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon="command" label="Commands" shortcut="Ctrl Shift K" onClick={() => openPalette("commands")} />
        <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Light theme" : "Dark theme"} aria-pressed={theme === "dark"} onClick={toggleTheme} />
        <IconButton icon="settings" label="Settings" disabled />
      </div>
    </header>
  );
}

/** Mode rail: selects the workspace mode; never shows repository state (§3). */
function ModeRail() {
  const { repo } = useShell();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const go = useGo();
  const active = modeForPath(pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || !Number.isInteger(n)) return;
      const mode = MODES[n - 1];
      if (!mode) return;
      e.preventDefault();
      go(modeHref(mode, repo));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <nav aria-label="Modes" data-testid="global-rail" className="flex w-12 shrink-0 flex-col items-center gap-1 pb-2">
      {MODES.map((m, i) => {
        const isActive = m.id === active;
        return (
          <Tip key={m.id} label={m.deferred ? `${m.label} · deferred` : m.label} shortcut={`Ctrl ${i + 1}`} side="right">
            <button
              type="button"
              aria-label={m.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => go(modeHref(m, repo))}
              className={cx(
                "relative flex size-9 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
                isActive ? "bg-accent-soft text-accent-ink" : "text-ink-faint hover:bg-hover hover:text-ink-muted",
              )}
            >
              <Icon name={m.icon} size="md" />
            </button>
          </Tip>
        );
      })}
    </nav>
  );
}

/** Sidebar toggle: one light edge — beside the mode rail when collapsed, on the sidebar's right edge when open. */
function SidebarEdge({ open }: { open: boolean }) {
  const { dispatch } = useShell();
  const label = open ? "Collapse sidebar" : "Open sidebar";
  return (
    <button
      type="button"
      data-testid={open ? "sidebar-collapse-edge" : "sidebar-reopen-rail"}
      aria-label={label}
      title={`${label} (Ctrl B)`}
      onClick={() => dispatch({ type: "sidebar/toggle" })}
      className={cx("group/edge flex w-4 shrink-0 items-center justify-center outline-none", open ? "absolute inset-y-0 right-0 z-20" : "-ml-1 mb-1.5")}
    >
      <span className="flex h-10 w-1 items-center justify-center overflow-hidden rounded-full bg-border-muted text-ink-faint transition-all duration-200 group-hover/edge:h-12 group-hover/edge:w-4 group-hover/edge:bg-hover group-hover/edge:text-ink group-focus-visible/edge:h-12 group-focus-visible/edge:w-4 group-focus-visible/edge:bg-hover">
        <Icon name={open ? "back" : "forward"} size="xs" className="shrink-0 opacity-0 transition-opacity group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100" />
      </span>
    </button>
  );
}

function ShellLayout() {
  const { layout, dispatch } = useShell();
  const { sidebar } = layout;
  const card = useRef<HTMLDivElement>(null);
  const cardWidth = useElementWidth(card);

  return (
    <div className="flex h-full min-h-0 flex-col bg-deep text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1 pr-1.5 pb-1.5">
        <ModeRail />
        {!sidebar.open && <SidebarEdge open={false} />}
        <ResizableGroup>
          <ResizablePanel
            data-testid="sidebar-panel"
            size={sidebar.width}
            minSize={SIDEBAR.min}
            maxSize={SIDEBAR.max}
            collapsed={!sidebar.open}
            onSizeChange={(width) => dispatch({ type: "sidebar/resize", width })}
          >
            <div inert={!sidebar.open} data-state={sidebar.open ? "expanded" : "collapsed"} className="relative h-full pr-3">
              <ContextSidebar />
              <SidebarEdge open />
            </div>
          </ResizablePanel>
          {sidebar.open && <ResizeHandle label="Resize sidebar" />}
          <FillPanel data-testid="main-panel" className="flex">
            <div ref={card} className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border-muted bg-surface">
              <main data-testid="primary-region" className="relative flex min-w-0 flex-1 flex-col">
                <Outlet />
              </main>
            </div>
          </FillPanel>
        </ResizableGroup>
        <InspectorDock cardWidth={cardWidth} />
      </div>
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
