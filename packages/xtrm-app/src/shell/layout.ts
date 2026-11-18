// Shell layout state: contextual sidebar + Inspector Drawer.
// Contract: docs/console-v2-shell-architecture.md §4.3 (restore rules) and §7 (drawer states).
// This reducer is the only writer of layout state.

export type DrawerState = "CLOSED" | "CONTEXTUAL" | "PINNED" | "MAXIMIZED";

export type DrawerRefKind = "issue" | "activity" | "pr" | "gh-issue" | "github-auth" | "research-run" | "research-metric" | "research-sample" | "research-annotation" | "session" | "commit" | "file";

/** Typed entity reference. Same vocabulary the composer will consume later (`@issue:XTRM-12`). */
export interface DrawerRef {
  kind: DrawerRefKind;
  ref: string;
}

export interface LayoutState {
  sidebar: { open: boolean; width: number; lastExpandedWidth: number };
  inspector: {
    state: DrawerState;
    width: number;
    /** State to return to when un-maximizing. */
    restoreState: Exclude<DrawerState, "MAXIMIZED" | "CLOSED"> | null;
    /** True only when the maximize action (not the user) collapsed the sidebar. */
    collapsedSidebarForMaximize: boolean;
    /** True only when opening the inspector (not the user) collapsed the sidebar for push. */
    collapsedSidebarForInspector: boolean;
    followLive: boolean;
  };
  /** Drawer navigation stack; `cursor` points at the inspected entity. */
  stack: DrawerRef[];
  cursor: number;
}

export const SIDEBAR = { default: 264, min: 220, max: 360 } as const;
export const INSPECTOR = { default: 576, min: 320, max: 1200 } as const;

/**
 * Fresh-open width: ~45% of the total viewport, clamped to the resize budget.
 * `INSPECTOR.default` is the 1280px-viewport reference (1280 * 0.45 = 576);
 * the runtime default resolves against the live viewport instead of a fixed px.
 */
export function defaultInspectorWidth(viewport?: number): number {
  const vw = typeof viewport === "number" ? viewport : typeof window !== "undefined" ? window.innerWidth : 1280;
  return Math.min(INSPECTOR.max, Math.max(INSPECTOR.min, Math.round(vw * 0.45)));
}

// --- shell motion ------------------------------------------------------------
// One driver for all three regions: motion-panels (JS) with SHELL_MOTION.transition.
// The sidebar, main fill, and inspector live in one ResizableGroup so open,
// close, maximize, and restore start and settle on the same frame — no CSS
// width transitions on layout regions (they would drift a frame behind the
// JS-timed panels). Duration/easing mirror motion-panels' default TRANSITION
// (0.25s, [0.32, 0.72, 0, 1]); motion-panels collapses to INSTANT under
// prefers-reduced-motion via its own guard.

export const SHELL_MOTION = {
  durationMs: 250,
  easingCss: "cubic-bezier(0.32, 0.72, 0, 1)",
  transition: { duration: 0.25, ease: [0.32, 0.72, 0, 1] as const },
} as const;

/** Tailwind classes applying SHELL_MOTION to plain width transitions; reduced motion disables it. */
export const SHELL_MOTION_TW = "transition-[width,margin,transform] duration-[250ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

/** Platform-aware Mod shortcut label rendered with the Kbd primitive. */
export function modShortcut(key: string): string {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const platform = (nav?.platform ?? "") as string;
  const ua = (nav as unknown as { userAgent?: string } | null)?.userAgent ?? "";
  const mac = /mac|iphone|ipad/i.test(`${platform} ${ua}`);
  return mac ? `⌘${key}` : `Ctrl ${key}`;
}

/** True when a shortcut must not fire: editable fields, dialogs, and menus. */
export function isShortcutSuppressed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[role=dialog],[role=menu],[role=listbox]")) return true;
  const el = target instanceof HTMLElement ? target : target instanceof Element ? target.closest("*") : null;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el.closest("input,textarea,select,[contenteditable=true]")) return true;
  return false;
}

/** Key fragment for the maximize/restore shortcut: Mod+Shift+Enter. Rendered via modShortcut. */
export const INSPECTOR_MAXIMIZE_KEY = "Shift Enter";

export const initialLayout: LayoutState = {
  sidebar: { open: true, width: SIDEBAR.default, lastExpandedWidth: SIDEBAR.default },
  inspector: { state: "CLOSED", width: defaultInspectorWidth(), restoreState: null, collapsedSidebarForMaximize: false, collapsedSidebarForInspector: false, followLive: false },
  stack: [],
  cursor: -1,
};

export type LayoutAction =
  | { type: "sidebar/toggle" }
  | { type: "sidebar/resize"; width: number }
  | { type: "drawer/inspect"; ref: DrawerRef; /** Open from CLOSED as a column beside the work (Agent half, PRD §36.5). */ column?: boolean }
  | { type: "drawer/open" }
  | { type: "drawer/pin" }
  | { type: "drawer/unpin" }
  | { type: "drawer/maximize" }
  | { type: "drawer/restore" }
  | { type: "drawer/close" }
  | { type: "drawer/back" }
  | { type: "drawer/forward" }
  | { type: "drawer/followLive" }
  | { type: "drawer/resize"; width: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

function unmaximize(s: LayoutState, to: DrawerState): LayoutState {
  const reopen = s.inspector.collapsedSidebarForMaximize && !s.sidebar.open;
  return {
    ...s,
    sidebar: reopen ? { ...s.sidebar, open: true, width: s.sidebar.lastExpandedWidth } : s.sidebar,
    inspector: { ...s.inspector, state: to, restoreState: null, collapsedSidebarForMaximize: false },
  };
}

/** Opening the inspector pushes the sidebar: collapse to its rail in the same motion. */
function openInspector(s: LayoutState, to: Exclude<DrawerState, "MAXIMIZED" | "CLOSED">): LayoutState {
  const collapse = s.sidebar.open;
  return {
    ...s,
    sidebar: collapse ? { ...s.sidebar, open: false, lastExpandedWidth: s.sidebar.width } : s.sidebar,
    inspector: { ...s.inspector, state: to, collapsedSidebarForInspector: collapse ? true : s.inspector.collapsedSidebarForInspector },
  };
}

/** Closing restores a sidebar that was pushed by open (unless the user now owns it). */
function restorePushedSidebar(s: LayoutState): LayoutState {
  const reopen = s.inspector.collapsedSidebarForInspector && !s.sidebar.open;
  return {
    ...s,
    sidebar: reopen ? { ...s.sidebar, open: true, width: s.sidebar.lastExpandedWidth } : s.sidebar,
    inspector: { ...s.inspector, collapsedSidebarForInspector: false },
  };
}

export function layoutReducer(s: LayoutState, a: LayoutAction): LayoutState {
  const d = s.inspector;
  switch (a.type) {
    case "sidebar/toggle": {
      if (s.sidebar.open) {
        return { ...s, sidebar: { ...s.sidebar, open: false, lastExpandedWidth: s.sidebar.width } };
      }
      // A manual reopen transfers sidebar ownership to the user (maximize and push must not restore it later).
      return {
        ...s,
        sidebar: { ...s.sidebar, open: true, width: s.sidebar.lastExpandedWidth },
        inspector: { ...d, collapsedSidebarForMaximize: false, collapsedSidebarForInspector: false },
      };
    }
    case "sidebar/resize": {
      const width = clamp(a.width, SIDEBAR.min, SIDEBAR.max);
      return { ...s, sidebar: { ...s.sidebar, width, lastExpandedWidth: width } };
    }
    case "drawer/inspect": {
      const current = s.stack[s.cursor];
      const openAs = a.column ? "PINNED" : "CONTEXTUAL";
      if (current && current.kind === a.ref.kind && current.ref === a.ref.ref) {
        if (d.state !== "CLOSED") return s;
        const reopened = openInspector(s, openAs);
        return { ...reopened };
      }
      const stack = [...s.stack.slice(0, s.cursor + 1), a.ref];
      const base = { ...s, stack, cursor: stack.length - 1 };
      return d.state === "CLOSED" ? openInspector(base, openAs) : base;
    }
    case "drawer/open":
      return d.state === "CLOSED" ? openInspector(s, "CONTEXTUAL") : s;
    case "drawer/pin":
      return d.state === "CONTEXTUAL" ? { ...s, inspector: { ...d, state: "PINNED" } } : s;
    case "drawer/unpin":
      return d.state === "PINNED" ? { ...s, inspector: { ...d, state: "CONTEXTUAL" } } : s;
    case "drawer/maximize": {
      if (d.state !== "CONTEXTUAL" && d.state !== "PINNED") return s;
      const collapse = s.sidebar.open;
      return {
        ...s,
        sidebar: collapse ? { ...s.sidebar, open: false, lastExpandedWidth: s.sidebar.width } : s.sidebar,
        inspector: { ...d, state: "MAXIMIZED", restoreState: d.state, collapsedSidebarForMaximize: collapse },
      };
    }
    case "drawer/restore":
      return d.state === "MAXIMIZED" ? unmaximize(s, d.restoreState ?? "CONTEXTUAL") : s;
    case "drawer/close": {
      const afterMax = d.state === "MAXIMIZED" ? unmaximize(s, "CLOSED") : { ...s, inspector: { ...d, state: "CLOSED" as const } };
      const restored = restorePushedSidebar(afterMax);
      return { ...restored, stack: [], cursor: -1, inspector: { ...restored.inspector, followLive: false } };
    }
    case "drawer/back":
      return s.cursor > 0 ? { ...s, cursor: s.cursor - 1 } : s;
    case "drawer/forward":
      return s.cursor < s.stack.length - 1 ? { ...s, cursor: s.cursor + 1 } : s;
    case "drawer/followLive":
      return { ...s, inspector: { ...d, followLive: !d.followLive } };
    case "drawer/resize":
      return { ...s, inspector: { ...d, width: clamp(a.width, INSPECTOR.min, INSPECTOR.max) } };
  }
}

export const currentRef = (s: LayoutState): DrawerRef | null => s.stack[s.cursor] ?? null;

// ---------------------------------------------------------------------------
// URL codec: ?inspect=<kind>:<ref>&drawer=contextual|pinned|maximized (§9.1)

const KINDS: readonly DrawerRefKind[] = ["issue", "activity", "pr", "gh-issue", "github-auth", "research-run", "research-metric", "research-sample", "research-annotation", "session", "commit", "file"];
const URL_STATES = { contextual: "CONTEXTUAL", pinned: "PINNED", maximized: "MAXIMIZED" } as const;

export interface DrawerSearch {
  inspect?: string;
  drawer?: keyof typeof URL_STATES;
}

export function parseRef(value: unknown): DrawerRef | null {
  if (typeof value !== "string") return null;
  const i = value.indexOf(":");
  if (i <= 0 || i === value.length - 1) return null;
  const kind = value.slice(0, i) as DrawerRefKind;
  return KINDS.includes(kind) ? { kind, ref: value.slice(i + 1) } : null;
}

export const formatRef = (r: DrawerRef) => `${r.kind}:${r.ref}`;

/** Route search validator: drops anything malformed instead of throwing. */
export function validateDrawerSearch(search: Record<string, unknown>): DrawerSearch {
  const ref = parseRef(search.inspect);
  if (!ref) return {};
  const drawer = typeof search.drawer === "string" && search.drawer in URL_STATES ? (search.drawer as DrawerSearch["drawer"]) : undefined;
  return drawer ? { inspect: formatRef(ref), drawer } : { inspect: formatRef(ref) };
}

export function searchFromLayout(s: LayoutState): DrawerSearch {
  const ref = currentRef(s);
  if (!ref || s.inspector.state === "CLOSED") return {};
  const drawer = s.inspector.state.toLowerCase() as DrawerSearch["drawer"];
  return drawer === "contextual" ? { inspect: formatRef(ref) } : { inspect: formatRef(ref), drawer };
}

/** Deep-link restore: apply URL drawer state on top of a (persisted) layout. */
export function layoutFromSearch(base: LayoutState, search: DrawerSearch): LayoutState {
  const ref = parseRef(search.inspect);
  if (!ref) return base;
  let s = layoutReducer(base, { type: "drawer/inspect", ref });
  if (search.drawer === "pinned") s = layoutReducer(s, { type: "drawer/pin" });
  if (search.drawer === "maximized") s = layoutReducer(s, { type: "drawer/maximize" });
  return s;
}

// ---------------------------------------------------------------------------
// Persistence: widths, sidebar open, drawer pinning. Namespaced, validated,
// never the Console v1 `forge-*` keys (§4.3 rule 3).
// ponytail: hand validation instead of seitu+arktype; five fields do not need a schema library.

export const LAYOUT_STORAGE_KEY = "xtrm.console.layout.v1";

interface PersistedLayout {
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
}

export function persistLayout(s: LayoutState, storage: Pick<Storage, "setItem"> = localStorage) {
  const data: PersistedLayout = {
    sidebarOpen: s.inspector.collapsedSidebarForMaximize || s.inspector.collapsedSidebarForInspector ? true : s.sidebar.open,
    sidebarWidth: s.sidebar.lastExpandedWidth,
    inspectorWidth: s.inspector.width,
  };
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable: layout simply does not persist
  }
}

export function restoreLayout(storage: Pick<Storage, "getItem"> = localStorage): LayoutState {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(LAYOUT_STORAGE_KEY) ?? "null");
  } catch {
    return initialLayout;
  }
  if (!raw || typeof raw !== "object") return initialLayout;
  const p = raw as Partial<PersistedLayout>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  const width = num(p.sidebarWidth, SIDEBAR.min, SIDEBAR.max, SIDEBAR.default);
  return {
    ...initialLayout,
    sidebar: { open: typeof p.sidebarOpen === "boolean" ? p.sidebarOpen : true, width, lastExpandedWidth: width },
    inspector: { ...initialLayout.inspector, width: num(p.inspectorWidth, INSPECTOR.min, INSPECTOR.max, defaultInspectorWidth()) },
  };
}
