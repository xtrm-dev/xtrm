// XTRM-757: the mixed Activity feed is ONE list over three sources, filtered by
// counts, and a failing source says so instead of counting as zero.
//
// These assertions are DOM-level on purpose: the merge is unit-tested in
// src/activity/merge.test.ts, but nothing there proves the surface actually
// calls it (a stacked triple list passed every unit test).

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
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

const chipNames = (): string[] =>
  screen
    .getAllByRole("button")
    .map((b) => b.textContent ?? "")
    .filter((t) => /^(All|Substrate|GitHub|Git)\d*|—/.test(t));

describe("Activity surface (XTRM-757)", () => {
  it("renders one merged list carrying rows from every source", async () => {
    renderActivity();
    const list = await feed();
    // One <ol>: three stacked lists would fail this.
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(3);
    const text = list.textContent ?? "";
    expect(text.toUpperCase()).toContain("SUBSTRATE");
    expect(text.toUpperCase()).toContain("GITHUB");
    expect(text.toUpperCase()).toContain("GIT");

    // Ordering is the property a stacked list breaks. The GitHub fixture is
    // dated relative to now and the Substrate fixture at a fixed earlier date,
    // so a MERGED feed starts with a GitHub row; three stacked lists would start
    // with the Substrate block. This is what makes dropping mergeActivity fail.
    const items = within(list).getAllByRole("listitem");
    const indexOfSource = (label: string): number =>
      items.findIndex((i) => (i.textContent ?? "").toUpperCase().startsWith(label));
    // Ordering is the property a stacked list breaks. The GitHub fixture is
    // pinned to 2026-09-16 and the git fixture to 2026-11-12, so a MERGED feed
    // puts every git row above every GitHub row; three stacked lists would put
    // the whole GitHub block first. This is what makes dropping mergeActivity
    // turn this test red.
    expect(indexOfSource("SUBSTRATE")).toBe(0);
    expect(indexOfSource("GIT")).toBeGreaterThan(0);
    expect(indexOfSource("GITHUB")).toBeGreaterThan(indexOfSource("GIT"));
  });

  it("offers a count per live source and no Jira chip", async () => {
    renderActivity();
    await feed();
    const chips = chipNames().join("|");
    expect(chips).toMatch(/Substrate/);
    expect(chips).toMatch(/GitHub/);
    expect(chips).toMatch(/Git/);
    expect(chips).not.toMatch(/Jira/);
  });

  it("marks the selected source with ink text, and never a chip fill", async () => {
    renderActivity();
    await feed();
    const all = screen.getByRole("button", { name: /^All/ });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(all.className).toContain("font-medium");
    expect(all.className).not.toContain("bg-pressed");
    // The sidebar also has a section button named GitHub; the filter is the one carrying aria-pressed.
    const github = screen.getAllByRole("button", { name: /^GitHub/ }).find((b) => b.hasAttribute("aria-pressed"))!;
    expect(github.getAttribute("aria-pressed")).toBe("false");
    expect(github.className).toContain("text-ink-muted");
    expect(github.className).not.toContain("bg-pressed");
  });

  it("shows an em dash, not a zero, for a source whose read failed", async () => {
    const broken = createFixtureSubstrate();
    broken.journalFeed = async () => {
      throw new Error("journal feed unavailable");
    };
    renderActivity({ substrate: broken });
    await feed();
    const chips = chipNames().join("|");
    // The Substrate count is a dash; a failed source is never reported as "nothing happened".
    expect(chips).toMatch(/Substrate—/);
    expect(screen.getByText(/substrate source unavailable/i)).toBeTruthy();
  });
});
