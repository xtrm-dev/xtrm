import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

/**
 * XTRM-883: the row action is invisible at rest, so it must not take the row's clicks, and its
 * confirmation must describe a write that actually happened.
 */
function renderIssues() {
  const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

/** The first rendered issue row, resolved from its key cell. */
async function firstRow() {
  await screen.findByRole("region", { name: "XTRM Issues" });
  // The list key splits the short ref into prefix and number (XTRM-1136); its data attribute keeps it whole.
  await screen.findAllByText(/^3\d\d$/, undefined, { timeout: 5000 });
  const keys = Array.from(document.querySelectorAll<HTMLElement>("[data-key-cell] [data-issue-key]")).filter((k) => /^XTRM-3\d\d$/.test(k.dataset.issueKey ?? ""));
  const row = keys[0].closest('[role="button"]') as HTMLElement | null;
  expect(row).not.toBeNull();
  return { row: row!, key: keys[0] };
}

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

const liveRegion = (row: HTMLElement) => row.querySelector('[aria-live="polite"]') as HTMLElement | null;

describe("Issue row action (XTRM-883)", () => {
  afterEach(() => {
    // jsdom ships no clipboard; leave none behind for the next test.
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("takes no pointer events at rest, so the row keeps the click", async () => {
    renderIssues();
    const { row } = await firstRow();
    const reveal = within(row).getByRole("button", { name: /^Copy / }).parentElement as HTMLElement;
    const tokens = reveal.className.split(/\s+/);

    // jsdom has no layout or hit testing, so the guard is the mechanism; e2e/issue-rows.spec.ts
    // proves the computed `pointer-events` and the click in a real browser.
    expect(tokens).toContain("pointer-events-none");
    expect(tokens).toContain("group-hover/row:pointer-events-auto");
    expect(tokens).toContain("group-focus-within/row:pointer-events-auto");
    expect(tokens).toContain("opacity-0");
  });

  it("announces Copied only after the clipboard write resolves", async () => {
    let resolve!: () => void;
    stubClipboard(() => new Promise<void>((done) => (resolve = done)));
    renderIssues();
    const { row } = await firstRow();

    await userEvent.click(within(row).getByRole("button", { name: /^Copy / }));
    expect(liveRegion(row)?.textContent, "nothing is confirmed before the write resolves").toBe("");

    resolve();
    await waitFor(() => expect(liveRegion(row)?.textContent).toBe("Copied"));
  });

  it("announces Copy failed, and no Copied, when the write rejects", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    renderIssues();
    const { row } = await firstRow();

    await userEvent.click(within(row).getByRole("button", { name: /^Copy / }));
    await waitFor(() => expect(liveRegion(row)?.textContent).toBe("Copy failed"));
  });

  it("opens the issue page on double-click", async () => {
    const router = renderIssues();
    const { row, key } = await firstRow();
    const ref = key.textContent;

    await userEvent.dblClick(row);
    await waitFor(() => expect(router.state.location.pathname).toContain("/work/issues/"));
    expect(router.state.location.pathname).toContain(ref);
  });
});
