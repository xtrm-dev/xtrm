import { Tooltip } from "@base-ui/react/tooltip";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { MODES, modeForPath, modeHref } from "../app/destinations.ts";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Kbd, Tip, cx } from "../ui/primitives.tsx";
import { FillPanel, ResizableGroup, ResizeHandle, ResizablePanel } from "../ui/resizable.tsx";
import { ContextSidebar, SidebarReopenRail, useGo } from "./ContextSidebar.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { InspectorDrawer } from "./Inspector.tsx";
import { ShellProvider, useShell } from "./context.tsx";
import { INSPECTOR, SIDEBAR } from "./layout.ts";

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

/** v15 inspector rail: a separate rounded column with a centered handle; hidden while the drawer is pinned. */
function InspectorRail() {
  const { layout, dispatch } = useShell();
  const open = layout.inspector.state !== "CLOSED";
  return (
    <div data-testid="inspector-rail" className="mb-1.5 ml-1.5 flex w-11 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-border-muted">
      {layout.inspector.followLive && <span className="size-1.5 rounded-full bg-accent" title="Following live updates" />}
      <Tip label={open ? "Close inspector" : "Open inspector"} shortcut="Ctrl I" side="left">
        <button
          type="button"
          aria-label={open ? "Close inspector" : "Open inspector"}
          aria-pressed={open}
          onClick={() => dispatch({ type: open ? "drawer/close" : "drawer/open" })}
          className={cx(
            "flex h-12 w-5 items-center justify-center rounded-md border outline-none transition-colors focus-visible:border-border-strong",
            open ? "border-border bg-hover text-ink" : "border-border-muted text-ink-faint hover:bg-hover hover:text-ink",
          )}
        >
          <Icon name={open ? "forward" : "back"} size="xs" />
        </button>
      </Tip>
      {layout.stack.length > 1 && (
        <span className="text-[0.65rem] text-ink-faint tabular" title="Inspector history depth">
          {layout.cursor + 1}/{layout.stack.length}
        </span>
      )}
    </div>
  );
}

function ShellLayout() {
  const { layout, dispatch } = useShell();
  const { sidebar, inspector } = layout;
  const pinned = inspector.state === "PINNED";

  return (
    <div className="flex h-full min-h-0 flex-col bg-deep text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ModeRail />
        {!sidebar.open && <SidebarReopenRail />}
        <ResizableGroup className="pr-0 pb-1.5">
          {sidebar.open && (
            <ResizablePanel data-testid="sidebar-panel" size={sidebar.width} minSize={SIDEBAR.min} maxSize={SIDEBAR.max} onSizeChange={(width) => dispatch({ type: "sidebar/resize", width })}>
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
                  <div className="absolute top-2 right-2 bottom-2 z-20 max-w-[calc(100%-1rem)]" style={{ width: inspector.width }}>
                    <InspectorDrawer variant="overlay" />
                  </div>
                )}
                {inspector.state === "MAXIMIZED" && (
                  <div className="absolute inset-2 z-20">
                    <InspectorDrawer variant="maximized" />
                  </div>
                )}
              </main>
            </div>
          </FillPanel>
          {pinned && <ResizeHandle label="Resize inspector" />}
          {pinned && (
            <ResizablePanel data-testid="inspector-panel" size={inspector.width} minSize={INSPECTOR.min} maxSize={INSPECTOR.max} onSizeChange={(width) => dispatch({ type: "drawer/resize", width })}>
              <InspectorDrawer variant="column" />
            </ResizablePanel>
          )}
        </ResizableGroup>
        {pinned ? <div className="w-1.5 shrink-0" /> : <InspectorRail />}
        {!pinned && <div className="w-1.5 shrink-0" />}
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
