import { describe, expect, it } from "vitest";
import {
  INSPECTOR,
  LAYOUT_STORAGE_KEY,
  currentRef,
  defaultInspectorWidth,
  initialLayout,
  layoutFromSearch,
  layoutReducer,
  persistLayout,
  restoreLayout,
  searchFromLayout,
  validateDrawerSearch,
  type LayoutAction,
  type LayoutState,
} from "./layout.ts";

const run = (...actions: LayoutAction[]) => actions.reduce(layoutReducer, initialLayout);
const issue = (ref: string) => ({ type: "drawer/inspect", ref: { kind: "issue", ref } }) as const;

describe("contextual sidebar", () => {
  it("collapses and restores the last expanded width, not the default", () => {
    const s = run({ type: "sidebar/resize", width: 330 }, { type: "sidebar/toggle" }, { type: "sidebar/toggle" });
    expect(s.sidebar).toMatchObject({ open: true, width: 330 });
  });

  it("clamps resize to the budget", () => {
    expect(run({ type: "sidebar/resize", width: 10 }).sidebar.width).toBe(220);
    expect(run({ type: "sidebar/resize", width: 9999 }).sidebar.width).toBe(360);
  });
});

describe("drawer states", () => {
  it("inspect opens CLOSED as CONTEXTUAL; pin survives further inspection", () => {
    let s = run(issue("XTRM-1"));
    expect(s.inspector.state).toBe("CONTEXTUAL");
    s = [{ type: "drawer/pin" } as const, issue("XTRM-2")].reduce(layoutReducer, s);
    expect(s.inspector.state).toBe("PINNED");
    expect(currentRef(s)).toEqual({ kind: "issue", ref: "XTRM-2" });
  });

  it("a column inspect opens CLOSED as PINNED but never changes an already open drawer's state", () => {
    const column = { type: "drawer/inspect", ref: { kind: "session", ref: "pi-main" }, column: true } as const;
    expect(run(column).inspector.state).toBe("PINNED");
    expect(run(issue("XTRM-1"), column).inspector.state).toBe("CONTEXTUAL");
    expect(run(column, { type: "drawer/close" }, column).inspector.state).toBe("PINNED");
  });

  it("opening pushes the sidebar and closing restores it", () => {
    const opened = run(issue("XTRM-1"));
    expect(opened.inspector.state).toBe("CONTEXTUAL");
    expect(opened.sidebar.open).toBe(false);
    expect(opened.inspector.collapsedSidebarForInspector).toBe(true);
    const closed = layoutReducer(opened, { type: "drawer/close" });
    expect(closed.inspector.state).toBe("CLOSED");
    expect(closed.sidebar.open).toBe(true);
    expect(closed.inspector.collapsedSidebarForInspector).toBe(false);
  });

  it("a sidebar collapsed by the user before open stays collapsed after close", () => {
    const s = run({ type: "sidebar/toggle" }, issue("XTRM-1"), { type: "drawer/close" });
    expect(s.sidebar.open).toBe(false);
  });

  it("manual sidebar reopen while open transfers ownership to the user", () => {
    const s = run(issue("XTRM-1"), { type: "sidebar/toggle" }, { type: "drawer/close" });
    expect(s.sidebar.open).toBe(true);
    expect(s.inspector.collapsedSidebarForInspector).toBe(false);
  });

  it("maximize from a pushed open keeps the push; restore stays collapsed and close reopens", () => {
    const max = run(issue("XTRM-1"), { type: "drawer/maximize" });
    expect(max.inspector.state).toBe("MAXIMIZED");
    expect(max.sidebar.open).toBe(false);
    expect(max.inspector.collapsedSidebarForInspector).toBe(true);
    expect(max.inspector.collapsedSidebarForMaximize).toBe(false);
    const restored = layoutReducer(max, { type: "drawer/restore" });
    expect(restored.inspector.state).toBe("CONTEXTUAL");
    expect(restored.sidebar.open).toBe(false);
    const closed = layoutReducer(restored, { type: "drawer/close" });
    expect(closed.sidebar.open).toBe(true);
  });

  it("maximize collapses a manually reopened sidebar and restore reopens it", () => {
    const max = run(issue("XTRM-1"), { type: "sidebar/toggle" }, { type: "drawer/maximize" });
    expect(max.sidebar.open).toBe(false);
    expect(max.inspector.collapsedSidebarForMaximize).toBe(true);
    const restored = layoutReducer(max, { type: "drawer/restore" });
    expect(restored.sidebar.open).toBe(true);
  });

  it("a sidebar collapsed by the user before maximize stays collapsed after restore", () => {
    const s = run({ type: "sidebar/toggle" }, issue("XTRM-1"), { type: "drawer/maximize" }, { type: "drawer/restore" });
    expect(s.sidebar.open).toBe(false);
  });

  it("restore returns to PINNED when maximized from PINNED", () => {
    const s = run(issue("XTRM-1"), { type: "drawer/pin" }, { type: "drawer/maximize" }, { type: "drawer/restore" });
    expect(s.inspector.state).toBe("PINNED");
  });

  it("closing a maximized drawer applies the restore rule and clears the stack", () => {
    const s = run(issue("XTRM-1"), issue("XTRM-2"), { type: "drawer/maximize" }, { type: "drawer/close" });
    expect(s.inspector.state).toBe("CLOSED");
    expect(s.sidebar.open).toBe(true);
    expect(s.stack).toEqual([]);
  });

  it("manual sidebar reopen while maximized transfers ownership to the user", () => {
    const s = run(issue("XTRM-1"), { type: "drawer/maximize" }, { type: "sidebar/toggle" }, { type: "sidebar/toggle" }, { type: "drawer/restore" });
    expect(s.sidebar.open).toBe(false);
  });

  it("FOLLOW_LIVE is an orthogonal flag, reset on close", () => {
    const s = run(issue("XTRM-1"), { type: "drawer/followLive" }, { type: "drawer/pin" });
    expect(s.inspector).toMatchObject({ state: "PINNED", followLive: true });
    expect(layoutReducer(s, { type: "drawer/close" }).inspector.followLive).toBe(false);
  });
});

describe("inspector default width", () => {
  it("opens at ~45% of the viewport", () => {
    expect(defaultInspectorWidth(1280)).toBe(576);
    expect(defaultInspectorWidth(1000)).toBe(450);
  });

  it("clamps the 45% default to the resize budget", () => {
    expect(defaultInspectorWidth(400)).toBe(INSPECTOR.min);
    expect(defaultInspectorWidth(4000)).toBe(INSPECTOR.max);
  });

  it("uses the live viewport when no width is stored", () => {
    const prev = window.innerWidth;
    try {
      window.innerWidth = 1280;
      expect(defaultInspectorWidth()).toBe(INSPECTOR.default);
      window.innerWidth = 1000;
      expect(defaultInspectorWidth()).toBe(450);
    } finally {
      window.innerWidth = prev;
    }
  });
});

describe("navigation stack", () => {
  it("back/forward traverse; inspecting after back truncates forward history", () => {
    let s = run(issue("A"), issue("B"), issue("C"), { type: "drawer/back" });
    expect(currentRef(s)?.ref).toBe("B");
    s = layoutReducer(s, { type: "drawer/forward" });
    expect(currentRef(s)?.ref).toBe("C");
    s = [{ type: "drawer/back" } as const, { type: "drawer/back" } as const, issue("D")].reduce(layoutReducer, s);
    expect(s.stack.map((r) => r.ref)).toEqual(["A", "D"]);
  });

  it("re-inspecting the current entity does not grow the stack", () => {
    expect(run(issue("A"), issue("A")).stack).toHaveLength(1);
  });
});

describe("URL codec and deep links", () => {
  it("round-trips drawer state through search params", () => {
    const s = run(issue("XTRM-94"), { type: "drawer/pin" });
    const search = searchFromLayout(s);
    expect(search).toEqual({ inspect: "issue:XTRM-94", drawer: "pinned" });
    const restored = layoutFromSearch(initialLayout, search);
    expect(restored.inspector.state).toBe("PINNED");
    expect(currentRef(restored)).toEqual({ kind: "issue", ref: "XTRM-94" });
  });

  it("keeps colons inside refs", () => {
    expect(validateDrawerSearch({ inspect: "activity:xtrm-dev/xtrm:123" })).toEqual({ inspect: "activity:xtrm-dev/xtrm:123" });
  });

  it("drops malformed params instead of throwing", () => {
    expect(validateDrawerSearch({ inspect: "nope:1" })).toEqual({});
    expect(validateDrawerSearch({ inspect: "issue:" })).toEqual({});
    expect(validateDrawerSearch({ inspect: "issue:X", drawer: "sideways" })).toEqual({ inspect: "issue:X" });
  });

  it("deep link to maximized collapses the sidebar via the normal rule", () => {
    const s = layoutFromSearch(initialLayout, { inspect: "activity:xtrm-dev/xtrm:42", drawer: "maximized" });
    expect(s.inspector.state).toBe("MAXIMIZED");
    expect(s.sidebar.open).toBe(false);
  });
});

describe("persistence", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("persists widths and the user's sidebar choice, not the maximize side effect", () => {
    const store = memory();
    persistLayout(run({ type: "sidebar/resize", width: 300 }, issue("A"), { type: "drawer/maximize" }), store);
    const s: LayoutState = restoreLayout(store);
    expect(s.sidebar).toMatchObject({ open: true, width: 300 });
    expect(s.inspector.state).toBe("CLOSED");
  });

  it("rejects garbage and out-of-range values", () => {
    const store = memory();
    store.setItem(LAYOUT_STORAGE_KEY, "{not json");
    expect(restoreLayout(store)).toEqual(initialLayout);
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarOpen: "yes", sidebarWidth: 5000, inspectorWidth: "wide" }));
    const s = restoreLayout(store);
    expect(s.sidebar).toMatchObject({ open: true, width: 360 });
    expect(s.inspector.width).toBe(initialLayout.inspector.width);
  });
});
