import { Tooltip } from "@base-ui/react/tooltip";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AgentWorkspaceProvider } from "../agent/workspace.tsx";
import { MODES, modeHref } from "../app/destinations.ts";
import { AccountControl } from "../github/auth.tsx";
import { Icon } from "../ui/icon.tsx";
import { IconButton, Kbd } from "../ui/primitives.tsx";
import { FillPanel, ResizableGroup, ResizeHandle, ResizablePanel } from "../ui/resizable.tsx";
import { ContextSidebar, useGo, useHalfNavigation } from "./ContextSidebar.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { InspectorDock } from "./InspectorDock.tsx";
import { ShellProvider, useShell } from "./context.tsx";
import { SIDEBAR, isShortcutSuppressed, modShortcut } from "./layout.ts";

/** Top bar of the main viewport: search, then the global options. */
function TopBar() {
  const { theme, toggleTheme, openPalette, repo, layout, dispatch } = useShell();
  const navigate = useNavigate();
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 px-3" data-testid="top-bar">
      {!layout.sidebar.open && (
        <IconButton data-testid="sidebar-reopen-rail" icon="sidebar" label="Open sidebar" shortcut={modShortcut("B")} onClick={() => dispatch({ type: "sidebar/toggle" })} />
      )}
      <button
        type="button"
        onClick={() => openPalette("search")}
        aria-label="Search"
        className="mx-auto flex h-8 w-full max-w-xl items-center gap-2 rounded-md bg-hover px-3 text-left text-sm text-ink-faint outline-none hover:bg-pressed hover:text-ink-muted focus-visible:bg-pressed"
      >
        <Icon name="search" size="xs" />
        <span className="flex-1 truncate">Search issues, repositories, Program in {repo.name} or the workspace…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon="command" label="Commands" shortcut="Ctrl Shift K" onClick={() => openPalette("commands")} />
        <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Light theme" : "Dark theme"} aria-pressed={theme === "dark"} onClick={toggleTheme} />
        <AccountControl />
        <IconButton icon="settings" label="Settings" onClick={() => void navigate({ to: "/settings" } as never)} />
      </div>
    </header>
  );
}

/** Mod+. switches half; Mod+<n> opens the n-th mode. */
function useModeShortcuts() {
  const { repo } = useShell();
  const go = useGo();
  const { half, switchTo } = useHalfNavigation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcutSuppressed(e.target) && e.key !== ".") return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key === ".") {
        e.preventDefault();
        switchTo(half === "agent" ? "console" : "agent");
        return;
      }
      if (isShortcutSuppressed(e.target)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n)) return;
      const mode = MODES[n - 1];
      if (!mode) return;
      e.preventDefault();
      go(modeHref(mode, repo));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

function ShellLayout() {
  const { layout, dispatch } = useShell();
  const { sidebar } = layout;
  useModeShortcuts();

  return (
    <div className="flex h-full min-h-0 bg-surface text-ink">
      {/* Single motion-panels driver for sidebar, main, and inspector: one Group using the default TRANSITION, which SHELL_MOTION mirrors (250ms, cubic-bezier(0.32,0.72,0,1)). No CSS width transitions on layout regions. */}
      <ResizableGroup>
        <ResizablePanel
          data-testid="sidebar-panel"
          size={sidebar.width}
          minSize={SIDEBAR.min}
          maxSize={SIDEBAR.max}
          collapsed={!sidebar.open}
          onSizeChange={(width) => dispatch({ type: "sidebar/resize", width })}
        >
          <div inert={!sidebar.open} data-state={sidebar.open ? "expanded" : "collapsed"} className="h-full bg-sidebar">
            <ContextSidebar />
          </div>
        </ResizablePanel>
        <ResizeHandle label="Resize sidebar" hidden={!sidebar.open} />
        <FillPanel data-testid="main-panel" className="flex flex-col overflow-hidden">
          <TopBar />
          <main data-testid="primary-region" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <Outlet />
          </main>
        </FillPanel>
        <InspectorDock />
      </ResizableGroup>
      <GlobalSearch />
    </div>
  );
}

export function AppShell() {
  return (
    <Tooltip.Provider delay={350}>
      <ShellProvider>
        <AgentWorkspaceProvider>
          <ShellLayout />
        </AgentWorkspaceProvider>
      </ShellProvider>
    </Tooltip.Provider>
  );
}
