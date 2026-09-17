import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { SHELL_MOTION, SHELL_MOTION_TW, isShortcutSuppressed, modShortcut } from "./layout.ts";
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
});

describe("rail inspector toggle", () => {
  it("opens and closes the inspector with an active state", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    const toggle = await screen.findByTestId("rail-inspector-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("inspector-drawer")).toBeNull();

    fireEvent.click(await screen.findByText("XTRM-300.1"));
    await screen.findByTestId("inspector-drawer");
    await waitFor(() => expect(screen.getByTestId("rail-inspector-toggle").getAttribute("aria-pressed")).toBe("true"));

    fireEvent.click(screen.getByTestId("rail-inspector-toggle"));
    await waitFor(() => expect(screen.queryByTestId("inspector-drawer")).toBeNull());
    expect(screen.getByTestId("rail-inspector-toggle").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByTestId("rail-inspector-toggle"));
    await screen.findByTestId("inspector-dock");
    expect(screen.getByTestId("inspector-dock").dataset.state).toBe("contextual");
  });

  it("runs inspector width on the shared token with reduced-motion disabled", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    const dock = await screen.findByTestId("inspector-dock");
    expect(dock.className).toContain("motion-reduce:transition-none");
    expect(dock.className).toContain("duration-[250ms]");
  });
});
