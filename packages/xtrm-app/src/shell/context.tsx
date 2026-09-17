import { useNavigate, useRouterState } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import {
  currentRef,
  isShortcutSuppressed,
  layoutFromSearch,
  layoutReducer,
  persistLayout,
  restoreLayout,
  searchFromLayout,
  validateDrawerSearch,
  type DrawerRef,
  type LayoutAction,
  type LayoutState,
} from "./layout.ts";

export const DEFAULT_REPO = { owner: "xtrm-dev", name: "xtrm" };
const REPO_KEY = "xtrm.console.repo.v1";
const THEME_KEY = "xtrm.console.theme.v1";

export type Theme = "light" | "dark";
export type PaletteMode = "search" | "commands";
export type SearchScope = "repository" | "workspace";

interface ShellContextValue {
  layout: LayoutState;
  dispatch: Dispatch<LayoutAction>;
  inspect: (ref: DrawerRef) => void;
  inspected: DrawerRef | null;
  repo: { owner: string; name: string; fullName: string };
  theme: Theme;
  toggleTheme: () => void;
  palette: { open: boolean; query: string; scope: SearchScope };
  openPalette: (mode: PaletteMode, query?: string) => void;
  setPalette: (next: Partial<ShellContextValue["palette"]>) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell outside ShellProvider");
  return value;
}

const REP_RE = /^\/rep\/([^/]+)\/([^/]+)/;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

function initialTheme(): Theme {
  const stored = readStored(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const location = useRouterState({ select: (s) => s.location });
  const navigate = useNavigate();

  // Deep-link restore on load: persisted widths + URL drawer state (§9.1).
  const [layout, dispatch] = useReducer(layoutReducer, undefined, () =>
    layoutFromSearch(restoreLayout(), validateDrawerSearch(location.search as Record<string, unknown>)),
  );

  useEffect(() => persistLayout(layout), [layout]);

  // Layout → URL. Runs after navigation too, so the drawer survives surface changes.
  const desired = JSON.stringify(searchFromLayout(layout));
  const current = JSON.stringify(validateDrawerSearch(location.search as Record<string, unknown>));
  useEffect(() => {
    if (desired === current) return;
    void navigate({
      to: ".",
      replace: true,
      search: (prev: Record<string, unknown>) => {
        const { inspect: _i, drawer: _d, ...rest } = prev;
        return { ...rest, ...searchFromLayout(layout) };
      },
    } as never);
  }, [desired, current, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Repository context: route wins; otherwise the last selected repository.
  const match = REP_RE.exec(location.pathname);
  const stored = readStored(REPO_KEY)?.split("/");
  const owner = match?.[1] ?? stored?.[0] ?? DEFAULT_REPO.owner;
  const name = match?.[2] ?? stored?.[1] ?? DEFAULT_REPO.name;
  useEffect(() => {
    if (match) writeStored(REPO_KEY, `${match[1]}/${match[2]}`);
  }, [match?.[1], match?.[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStored(THEME_KEY, theme);
  }, [theme]);

  const [palette, setPaletteState] = useState<ShellContextValue["palette"]>({ open: false, query: "", scope: "repository" });
  const setPalette = useCallback((next: Partial<ShellContextValue["palette"]>) => setPaletteState((p) => ({ ...p, ...next })), []);
  const openPalette = useCallback((mode: PaletteMode, query = "") => setPalette({ open: true, query: mode === "commands" ? `>${query}` : query }), [setPalette]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Global keyboard model (§3, §4.4). ponytail: one listener; adopt @tanstack/react-hotkeys when bindings become user-configurable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Toggles never steal typing or dialog keys; the palette stays reachable everywhere.
      if (isShortcutSuppressed(e.target)) {
        if (mod && key === "k") {
          e.preventDefault();
          openPalette(e.shiftKey ? "commands" : "search");
        }
        return;
      }
      if (mod && key === "k") {
        e.preventDefault();
        openPalette(e.shiftKey ? "commands" : "search");
      } else if (mod && key === "b") {
        e.preventDefault();
        dispatch({ type: "sidebar/toggle" });
      } else if (mod && key === "i") {
        e.preventDefault();
        dispatch({ type: layoutRef.current.inspector.state === "CLOSED" ? "drawer/open" : "drawer/close" });
      } else if (key === "escape" && !e.defaultPrevented && layoutRef.current.inspector.state !== "CLOSED") {
        if (e.target instanceof Element && e.target.closest("[role=dialog],[role=menu]")) return;
        dispatch({ type: layoutRef.current.inspector.state === "MAXIMIZED" ? "drawer/restore" : "drawer/close" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);

  const value = useMemo<ShellContextValue>(
    () => ({
      layout,
      dispatch,
      inspect: (ref) => dispatch({ type: "drawer/inspect", ref }),
      inspected: currentRef(layout),
      repo: { owner, name, fullName: `${owner}/${name}` },
      theme,
      toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      palette,
      openPalette,
      setPalette,
    }),
    [layout, owner, name, theme, palette, openPalette, setPalette],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
