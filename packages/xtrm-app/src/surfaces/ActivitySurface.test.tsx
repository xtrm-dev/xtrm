// XTRM-757: the mixed Activity feed is ONE list over three sources, filtered by
// counts, and a failing source says so instead of counting as zero.
// Approved grammar (2026-11-24): one merged stream, 32px rows, no dividers, the
// event kind is a chip at the left, and a row opens the real inspector — the
// feed grows no panel of its own.
//
// These assertions are DOM-level on purpose: the merge is unit-tested in
// src/activity/merge.test.ts, but nothing there proves the surface actually
// calls it (a stacked triple list passed every unit test).

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import type { Adapters } from "../adapters/types.ts";

function renderActivity(adapters: Partial<Adapters> = {}) {
  const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/code/activity"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({
    adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate(), ...adapters },
    history,
    queryClient,
  });
  render(<RouterProvider router={router} />);
  return router;
}

const feed = () => screen.findByRole("list", { name: /activity feed/i });

/** The source of a row is not printed on the line; it rides a data attribute for the shell and the tests. */
const sourceOrder = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("data-source") ?? "");

describe("Activity surface (XTRM-757)", () => {
  it("renders one merged list carrying rows from every source", async () => {
    renderActivity();
    const list = await feed();
    // One <ol>: three stacked lists would fail this.
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(3);
    const order = sourceOrder(list);
    expect(new Set(order)).toEqual(new Set(["substrate", "github"]));

    // Ordering is the property a stacked list breaks. GitHub (pushes included,
    // XTRM-1090 seq 2: the git source is gone) and the substrate journal are
    // dated apart, so a MERGED feed interleaves them; stacked lists would emit
    // one contiguous block per source.
    const transitions = order.filter((s, i) => i > 0 && s !== order[i - 1]).length;
    expect(transitions).toBeGreaterThan(0);
  });

  it("opens every source as a tab with its count and never offers Jira", async () => {
    renderActivity();
    await feed();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    expect(tabs.join("|")).toMatch(/All/);
    expect(tabs.join("|")).toMatch(/Substrate/);
    expect(tabs.join("|")).toMatch(/GitHub/);
    expect(tabs.some((t) => /^Git\d+$/.test(t))).toBe(false);
    expect(tabs.join("|")).not.toMatch(/Jira/);
    // The first tab is the resting selection.
    expect(screen.getByRole("tab", { name: /^All/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("filters the stream to one source without reordering it", async () => {
    renderActivity();
    const list = await feed();
    const before = sourceOrder(list);
    const githubTab = screen.getAllByRole("tab").find((tab) => /^GitHub\d*$/.test(tab.textContent ?? ""))!;
    await userEvent.click(githubTab);
    const after = sourceOrder(await feed());
    expect(after.every((s) => s === "github")).toBe(true);
    // Filtering is a projection, not a re-sort: the surviving rows keep their order.
    expect(after).toEqual(before.filter((s) => s === "github"));
  });

  it("never draws a divider between rows and keeps every row at 32px", async () => {
    renderActivity();
    const list = await feed();
    const items = within(list).getAllByRole("listitem");
    for (const item of items) {
      const row = item.querySelector("[data-testid='activity-row']")!;
      // The divider is gone everywhere; the 32px height comes from the row token, not a table band.
      expect(row.className).not.toMatch(/border-b/);
      expect(row.className).toContain("h-row");
      // An expandable row stacks its body under the line, so the item is a column.
      expect(item.className).toContain("flex-col");
    }
  });

  it("names the event with a chip at the left and reuses the reference chip", async () => {
    renderActivity();
    const list = await feed();
    const row = within(list).getAllByRole("listitem")[0]!;
    const line = row.querySelector("[data-testid='activity-row']")!;
    // A chip, not a mono word at the right edge: the kind is read before the sentence.
    const chip = line.querySelector("[data-slot='badge']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent ?? "").toMatch(/note|result|finding|commit|PR|issue|review|comment/i);
    // A work reference renders through the shared chip, which resolves and inspects on its own.
    const linked = within(list)
      .getAllByRole("listitem")
      .find((item) => item.querySelector("[data-reference], [data-testid='activity-refs'] button, [data-testid='activity-refs'] a") !== null);
    expect(linked).not.toBeUndefined();
  });

  it("names a GitHub target once, not as a report plus a link", async () => {
    renderActivity();
    const list = await feed();
    const githubRow = within(list)
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("data-source") === "github" && item.querySelector("[data-reference]") !== null)!;
    const line = githubRow.querySelector("[data-testid='activity-row']")!;
    // Exactly one reference chip on the line, and it carries the number.
    const refs = line.querySelectorAll("[data-reference]");
    expect(refs.length).toBe(1);
    expect(refs[0]!.getAttribute("data-reference") ?? "").toMatch(/^@(pr|gh-issue):/);
    // The old line reported the target as text and then linked it again; the report is gone.
    expect(line.textContent ?? "").not.toMatch(/[\w.-]+\/[\w.-]+#\d+/);
    // The trailing column no longer repeats the same entity.
    expect(line.querySelector("[data-testid='activity-refs']")).toBeNull();
  });

  it("expands the entry body under the row, through the inspector's own renderer", async () => {
    renderActivity();
    const list = await feed();
    const expandable = within(list)
      .getAllByRole("listitem")
      .find((item) => item.querySelector("[data-testid='activity-expand']") !== null)!;
    const toggle = expandable.querySelector("[data-testid='activity-expand']")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(expandable.querySelector("[data-testid='activity-body']")).toBeNull();
    await userEvent.click(toggle);
    const body = expandable.querySelector("[data-testid='activity-body']")!;
    expect(body).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // The line is not repeated in the body: the body is the entry's own text.
    const line = expandable.querySelector("[data-testid='activity-row']")!.textContent ?? "";
    expect(body.textContent ?? "").not.toBe(line);
    // Folding it back removes the body again.
    await userEvent.click(toggle);
    expect(expandable.querySelector("[data-testid='activity-body']")).toBeNull();
  });

  it("never truncates the actor: the target gives up width instead", async () => {
    renderActivity();
    const list = await feed();
    const target = within(list)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("[data-testid='activity-target']"))
      .find((el): el is Element => el !== null);
    expect(target).toBeTruthy();
    // The entity keeps its full width; only the target behind it ellipsises.
    expect(target!.className).toContain("flex-1");
    expect(target!.className).toContain("min-w-0");
    const verb = target!.previousElementSibling!;
    expect(verb.className).toContain("shrink-0");
    expect(verb.className).toContain("whitespace-nowrap");
    const actor = verb.previousElementSibling;
    if (actor !== null) {
      expect(actor.className).toContain("shrink-0");
      expect(actor.className).toContain("whitespace-nowrap");
      expect(actor.className).not.toContain("truncate");
    }
  });

  it("opens the inspector instead of a panel of its own", async () => {
    renderActivity();
    const list = await feed();
    expect(screen.queryByTestId("inspector-drawer")).toBeNull();
    const row = within(list)
      .getAllByRole("listitem")
      .find((item) => item.querySelector("[data-reference], [data-testid='activity-refs'] button") !== null)!;
    await userEvent.click(row.querySelector("[data-testid='activity-row']")!);
    // The one inspector the console already has, not a second sidebar built for the feed.
    const drawer = await screen.findByTestId("inspector-drawer");
    expect(drawer).toBeTruthy();
    expect(screen.queryByTestId("activity-detail")).toBeNull();
  });

  it("shows an em dash, not a zero, for a source whose read failed", async () => {
    const broken = createFixtureSubstrate();
    broken.journalFeed = async () => {
      throw new Error("journal feed unavailable");
    };
    renderActivity({ substrate: broken });
    await feed();
    // The Substrate tab carries a dash; a failed source is never reported as "nothing happened".
    const substrate = screen.getByRole("tab", { name: /^Substrate/ });
    expect(substrate.textContent).toMatch(/—/);
    expect(screen.getByText(/substrate source unavailable/i)).toBeTruthy();
  });
});
