import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { ExpandPopover } from "./expand-popover.tsx";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router };
}

/** The router mounts asynchronously; every case needs the sidebar before it can click it. */
async function mount(url: string) {
  const rendered = renderAt(url);
  await screen.findByTestId("context-sidebar");
  return rendered;
}

/** A whole press: Base UI's sloppy outside-press detection watches the press and its click. */
function pressAt(target: Element) {
  fireEvent.pointerDown(target, { button: 0, isPrimary: true });
  fireEvent.pointerUp(target, { button: 0, isPrimary: true });
  fireEvent.mouseDown(target, { button: 0 });
  fireEvent.mouseUp(target, { button: 0 });
  fireEvent.click(target, { detail: 1 });
}

const header = () => document.querySelector<HTMLElement>("[data-expand-popover-header]");

function expectHeaderRepeatsTrigger(trigger: HTMLElement) {
  const copy = header();
  expect(copy).not.toBeNull();
  expect(copy!.getAttribute("aria-hidden")).toBe("true");
  expect(copy!.textContent).toBe(trigger.textContent);
  for (const name of trigger.className.split(" ").filter(Boolean)) expect(copy!.classList.contains(name), name).toBe(true);
  expect(copy!.getAttribute("data-popup-open")).toBe("");
}

describe("expanding drop-up", () => {
  it("renders the trigger row again as the panel header over the trigger rect", async () => {
    await mount("/rep/xtrm-dev/xtrm/work/issues");
    const trigger = screen.getByRole("button", { name: "Data sources" });
    fireEvent.click(trigger);

    const popup = document.querySelector<HTMLElement>("[data-expand-popover]");
    expect(popup).not.toBeNull();
    expect(popup!.className).toContain("w-[var(--anchor-width)]");
    expect(popup!.getAttribute("data-side")).toBe("top");
    expectHeaderRepeatsTrigger(trigger);
    // The drop-up grows upward out of the trigger row, so the panel hangs above the header.
    expect(popup!.lastElementChild).toBe(header());
    expect(popup!.querySelector("[data-expand-popover-surface]")!.className).toContain("bottom-full");
    // Today's content, now inside the collapsing body.
    const transport = screen.getByTestId("board-transport");
    expect(transport.closest("[data-expand-popover-body]")).not.toBeNull();
    expect(screen.getAllByTestId("source-state")).toHaveLength(4);
  });

  it("moves through the status rows with the arrow keys", async () => {
    await mount("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(screen.getByRole("button", { name: "Data sources" }));

    const popup = document.querySelector<HTMLElement>("[data-expand-popover]")!;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-popover-row]"));
    expect(rows.length).toBeGreaterThan(1);

    fireEvent.keyDown(popup, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
  });
});

describe("expanding repository selector", () => {
  it("opens as an expanding popover and closes on Escape with focus back on the trigger", async () => {
    await mount("/rep/xtrm-dev/xtrm/work/issues");
    const trigger = screen.getByRole("button", { name: "Repository: xtrm-dev/xtrm" });
    fireEvent.click(trigger);

    const popup = document.querySelector("[data-expand-popover]")!;
    expect(popup.getAttribute("data-side")).toBe("bottom");
    expectHeaderRepeatsTrigger(trigger);
    // The panel hangs off the header's outer edge: the popup box never leaves the trigger rect.
    expect([...popup.children].map((child) => child.hasAttribute("data-expand-popover-header"))).toEqual([false, true]);
    expect(popup.querySelector("[data-expand-popover-surface]")!.className).toContain("top-full");
    expect(screen.getByLabelText("Filter repositories")).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-expand-popover]")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an outside press", async () => {
    await mount("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(screen.getByRole("button", { name: "Repository: xtrm-dev/xtrm" }));
    expect(document.querySelector("[data-expand-popover]")).not.toBeNull();

    pressAt(document.body);
    await waitFor(() => expect(document.querySelector("[data-expand-popover]")).toBeNull());
  });

  it("steps from the filter field through the repository rows with the arrow keys", async () => {
    await mount("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(screen.getByRole("button", { name: "Repository: xtrm-dev/xtrm" }));

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    const first = options[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });
});
