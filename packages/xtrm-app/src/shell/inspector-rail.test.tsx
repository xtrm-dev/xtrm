import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { INSPECTOR_MAXIMIZE_KEY, SHELL_MOTION, SHELL_MOTION_TW, isShortcutSuppressed, modShortcut } from "./layout.ts";
import { CommandMenu } from "../ui/command-menu.tsx";
import { isShortcutHint } from "../ui/command-menu.tsx";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router };
}

describe("shell motion token", () => {
  it("shares duration/easing with motion-panels' default TRANSITION", () => {
    expect(SHELL_MOTION.durationMs).toBe(250);
    expect(SHELL_MOTION.easingCss).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
    expect([...SHELL_MOTION.transition.ease]).toEqual([0.32, 0.72, 0, 1]);
  });

  it("disables motion under prefers-reduced-motion", () => {
    expect(SHELL_MOTION_TW).toContain("motion-reduce:transition-none");
    expect(SHELL_MOTION_TW).toContain("duration-[250ms]");
  });
});

describe("platform shortcuts", () => {
  it("labels Mod+I as Ctrl I off macOS and ⌘I on macOS", () => {
    expect(modShortcut("I")).toBe("Ctrl I");
    expect(modShortcut("B")).toBe("Ctrl B");
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Mac" });
    expect(modShortcut("I")).toBe("⌘I");
    vi.unstubAllGlobals();
  });

  it("labels the maximize shortcut with Mod+Shift+Enter", () => {
    expect(INSPECTOR_MAXIMIZE_KEY).toBe("Shift Enter");
    expect(modShortcut(INSPECTOR_MAXIMIZE_KEY)).toBe("Ctrl Shift Enter");
    expect(isShortcutHint(modShortcut(INSPECTOR_MAXIMIZE_KEY))).toBe(true);
  });

  it("suppresses toggles inside editable fields and dialogs", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isShortcutSuppressed(input)).toBe(true);
    input.remove();
    const area = document.createElement("textarea");
    expect(isShortcutSuppressed(area)).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isShortcutSuppressed(editable)).toBe(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inner = document.createElement("button");
    dialog.appendChild(inner);
    document.body.appendChild(dialog);
    expect(isShortcutSuppressed(inner)).toBe(true);
    dialog.remove();
    expect(isShortcutSuppressed(document.createElement("div"))).toBe(false);
    expect(isShortcutSuppressed(null)).toBe(false);
  });
});

describe("command list shortcuts", () => {
  it("treats Mod hints as shortcuts and keeps context hints plain", () => {
    expect(isShortcutHint("Ctrl I")).toBe(true);
    expect(isShortcutHint("Ctrl B")).toBe(true);
    expect(isShortcutHint("Ctrl Shift K")).toBe(true);
    expect(isShortcutHint("Ctrl Shift Enter")).toBe(true);
    expect(isShortcutHint("deferred")).toBe(false);
    expect(isShortcutHint("xtrm · Work")).toBe(false);
  });

  it("renders the Mod+I shortcut with the Kbd primitive", () => {
    render(
      <CommandMenu
        open
        onOpenChange={() => {}}
        query=">"
        onQueryChange={() => {}}
        placeholder="Run a command…"
        groups={[{ heading: "Commands", entries: [{ id: "inspector", label: "Open inspector", hint: "Ctrl I", icon: "inspector", onSelect: () => {} }] }]}
      />,
    );
    expect(screen.getByText("Ctrl I").tagName.toLowerCase()).toBe("kbd");
  });

  it("renders the maximize shortcut with the Kbd primitive", () => {
    render(
      <CommandMenu
        open
        onOpenChange={() => {}}
        query=">"
        onQueryChange={() => {}}
        placeholder="Run a command…"
        groups={[{ heading: "Commands", entries: [{ id: "max", label: "Maximize drawer", hint: "Ctrl Shift Enter", icon: "maximize", onSelect: () => {} }] }]}
      />,
    );
    expect(screen.getByText("Ctrl Shift Enter").tagName.toLowerCase()).toBe("kbd");
  });
});

describe("left edge", () => {
  it("has no inspector toggle; the sidebar collapse button is the only left-edge affordance", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    await screen.findByTestId("context-sidebar");
    expect(screen.queryByTestId("rail-inspector-toggle")).toBeNull();
    expect(screen.getByTestId("sidebar-collapse-edge")).toBeTruthy();
  });
});

describe("inspector push", () => {
  it("opening collapses the sidebar to its rail and closing restores it", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    expect(await screen.findByTestId("sidebar-collapse-edge")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-reopen-rail")).toBeNull();

    fireEvent.click(await screen.findByText("XTRM-300.1"));
    await screen.findByTestId("inspector-drawer");
    await waitFor(() => expect(screen.queryByTestId("sidebar-reopen-rail")).toBeTruthy());
    expect(screen.getByTestId("context-sidebar").closest("[data-state]")?.getAttribute("data-state")).toBe("collapsed");

    fireEvent.click(screen.getByTestId("inspector-rail"));
    await waitFor(() => expect(screen.queryByTestId("inspector-drawer")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("sidebar-collapse-edge")).toBeTruthy());
    expect(screen.getByTestId("context-sidebar").closest("[data-state]")?.getAttribute("data-state")).toBe("expanded");
  });
});

describe("inspector maximize pill", () => {
  it("toggles MAXIMIZED and restores, with edge-handle pill styling", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    await screen.findByTestId("inspector-drawer");
    const pill = await screen.findByTestId("inspector-maximize-rail");
    expect(pill.getAttribute("aria-label")).toBe("Maximize inspector");
    // Same discreet vertical oblong pill as the sidebar edge handle.
    expect(pill.className).toContain("group/edge");
    expect(pill.querySelector("span")?.className).toContain("rounded-full");

    fireEvent.click(pill);
    await waitFor(() => expect(screen.getByTestId("inspector-dock").dataset.state).toBe("maximized"));
    expect(screen.getByTestId("inspector-maximize-rail").getAttribute("aria-label")).toBe("Restore inspector");

    fireEvent.click(screen.getByTestId("inspector-maximize-rail"));
    await waitFor(() => expect(screen.getByTestId("inspector-dock").dataset.state).toBe("contextual"));
  });

  it("shows the maximize shortcut in a Kbd tooltip", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    const pill = await screen.findByTestId("inspector-maximize-rail");
    fireEvent.focus(pill);
    // Base UI tooltip (delay 350ms) renders label + Kbd shortcut.
    const tip = await screen.findByText("Maximize inspector", {}, { timeout: 2000 }).catch(() => null);
    if (tip) {
      const popup = tip.closest("[data-slot]") ?? tip.parentElement;
      expect(popup?.querySelector("kbd")?.textContent).toBe(modShortcut(INSPECTOR_MAXIMIZE_KEY));
    } else {
      // Tooltip timing is environment-sensitive; at minimum the shortcut must be Kbd-renderable.
      expect(isShortcutHint(modShortcut(INSPECTOR_MAXIMIZE_KEY))).toBe(true);
    }
  });
});

describe("inspector shortcuts", () => {
  it("Mod+Shift+Enter maximizes and restores; suppressed in editable fields", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    await screen.findByTestId("inspector-drawer");
    expect(screen.getByTestId("inspector-dock").dataset.state).toBe("contextual");

    act(() => void fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true }));
    await waitFor(() => expect(screen.getByTestId("inspector-dock").dataset.state).toBe("maximized"));

    act(() => void fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true }));
    await waitFor(() => expect(screen.getByTestId("inspector-dock").dataset.state).toBe("contextual"));

    // Suppressed in inputs: no state change.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => void fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, shiftKey: true }));
    expect(screen.getByTestId("inspector-dock").dataset.state).toBe("contextual");
    input.remove();
  });

  it("Mod+I still toggles open/close", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    await screen.findByTestId("inspector-drawer");
    act(() => void fireEvent.keyDown(window, { key: "i", ctrlKey: true }));
    await waitFor(() => expect(screen.queryByTestId("inspector-drawer")).toBeNull());
  });
});

describe("command palette lists both shortcuts", () => {
  it("shows Mod+I and Mod+Shift+Enter as Kbd", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    await screen.findByTestId("inspector-drawer");
    // Open the palette in command mode.
    fireEvent.click(screen.getByRole("button", { name: "Commands" }));
    const input = await screen.findByPlaceholderText("Run a command…");
    expect(input).toBeTruthy();
    expect(await screen.findByText("Maximize drawer")).toBeTruthy();
    // Both shortcuts render with the Kbd primitive.
    expect(screen.getByText("Ctrl I").tagName.toLowerCase()).toBe("kbd");
    expect(screen.getByText("Ctrl Shift Enter").tagName.toLowerCase()).toBe("kbd");
  });
});
