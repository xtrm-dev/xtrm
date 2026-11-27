import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { fixturePulls } from "../adapters/github/fixture.ts";
import { extractIssueKeys, filterPulls, parseProvenancePr, parsePullRef, pullUrl, resolvePullReference, sortPulls } from "./pr.ts";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router };
}

const drawer = () => screen.queryByTestId("inspector-drawer");
const search = (router: ReturnType<typeof renderAt>["router"]) => router.state.location.search as Record<string, unknown>;

describe("PR linkage helpers", () => {
  it("parses canonical owner/repo#N refs", () => {
    expect(parsePullRef("xtrm-dev/xtrm#206")).toEqual({ owner: "xtrm-dev", repo: "xtrm", fullName: "xtrm-dev/xtrm", number: 206 });
    expect(parsePullRef("nope")).toBeNull();
  });

  it("rejects path-like repository segments", () => {
    expect(parsePullRef("../..#5")).toBeNull();
    expect(parsePullRef("./x#1")).toBeNull();
    expect(parsePullRef(".owner/repo#2")).toBeNull();
  });

  it("resolves a bare #N against the surface repository, never across repositories", () => {
    expect(resolvePullReference("#212", "xtrm-dev/xtrm")).toEqual({ owner: "xtrm-dev", repo: "xtrm", fullName: "xtrm-dev/xtrm", number: 212 });
    expect(resolvePullReference("#83", "Jaggerxtrm/console")).toEqual({ owner: "Jaggerxtrm", repo: "console", fullName: "Jaggerxtrm/console", number: 83 });
    // A canonical reference keeps its own repository even when the surface is another one.
    expect(resolvePullReference("Jaggerxtrm/console#83", "xtrm-dev/xtrm"))
      .toEqual({ owner: "Jaggerxtrm", repo: "console", fullName: "Jaggerxtrm/console", number: 83 });
    expect(resolvePullReference("#212", "")).toBeNull();
    expect(pullUrl("xtrm-dev/xtrm", 212)).toBe("https://github.com/xtrm-dev/xtrm/pull/212");
  });

  it("extracts issue keys from PR title/branch/body and skips UTF-8", () => {
    expect(extractIssueKeys("feat(XTRM-301): thing", "xt/o8h2", "See XTRM-300.1")).toEqual(["XTRM-301", "XTRM-300.1"]);
    expect(extractIssueKeys("UTF-8 is not a reference")).toEqual([]);
  });

  it("resolves provenance PR strings to PR references", () => {
    expect(parseProvenancePr("xtrm-dev/xtrm#212", "xtrm-dev/xtrm")).toEqual({ kind: "pr", ref: "xtrm-dev/xtrm#212" });
    expect(parseProvenancePr("https://github.com/xtrm-dev/xtrm/pull/211", "xtrm-dev/xtrm")).toEqual({ kind: "pr", ref: "xtrm-dev/xtrm#211" });
    expect(parseProvenancePr("#212", "xtrm-dev/xtrm")).toEqual({ kind: "pr", ref: "xtrm-dev/xtrm#212" });
    expect(parseProvenancePr("not a pr", "xtrm-dev/xtrm")).toBeNull();
  });

  it("filters by state and query, sorts by updated/created/comments", () => {
    const pulls = fixturePulls("xtrm-dev/xtrm");
    expect(filterPulls(pulls, new Set(["open"]), "").every((p) => p.state === "open")).toBe(true);
    expect(filterPulls(pulls, new Set(["merged"]), "").every((p) => p.state === "merged")).toBe(true);
    expect(filterPulls(pulls, new Set(["closed"]), "").every((p) => p.state === "closed")).toBe(true);
    // The set is a union: two states selected keeps both, and an empty set keeps nothing.
    expect(filterPulls(pulls, new Set(["open", "merged"]), "").length).toBeGreaterThan(
      filterPulls(pulls, new Set(["open"]), "").length,
    );
    expect(filterPulls(pulls, new Set(), "")).toEqual([]);
    expect(filterPulls(pulls, new Set(["open"]), "XTRM-301").map((p) => p.number)).toEqual([212]);
    expect(filterPulls(pulls, new Set(["open"]), "xt/o8h2").map((p) => p.number)).toEqual([212]);
    const byComments = sortPulls(pulls, "comments");
    expect(byComments[0]!.comments).toBeGreaterThanOrEqual(byComments[1]!.comments);
    const byUpdated = sortPulls(pulls, "updated");
    expect(byUpdated[0]!.updatedAt >= byUpdated[1]!.updatedAt).toBe(true);
  });
});

describe("Pull requests surface", () => {
  it("lists every state by default and narrows through the state filter", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    expect(await screen.findByRole("region", { name: "Pull requests" })).toBeTruthy();
    // Every state is on by default: one multi-select replaces the three state tabs.
    expect(await screen.findByText("feat(XTRM-301): rail keyboard model v2")).toBeTruthy();
    expect(screen.getByText("feat(XTRM-94): Substrate Documentation vNext")).toBeTruthy();
    expect(screen.getByText("#212")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "State filter" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Open" }));
    // Unchecking one state hides exactly that state and leaves the others.
    await waitFor(() => expect(screen.queryByText("feat(XTRM-301): rail keyboard model v2")).toBeNull());
    expect(screen.getByText("feat(XTRM-94): Substrate Documentation vNext")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // The trigger names the remaining choice instead of a count when two states are off.
    expect(screen.getByRole("button", { name: /State filter: (Merged|Closed)/ })).toBeTruthy();
    // Put every state back before the query step: the filter is a set, not a tab switch.
    fireEvent.click(screen.getByRole("button", { name: /State filter: (Merged|Closed)/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Select all" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // The sort control is a ghost button: a menu affordance, not a chip (the chip fill was `bg-pressed`).
    expect(screen.getByRole("button", { name: /Recently updated/ }).className.split(/\s+/)).not.toContain("bg-pressed");
    fireEvent.click(screen.getByRole("button", { name: "Filter this list" }));
    fireEvent.change(screen.getByLabelText("Filter pull requests"), { target: { value: "XTRM-305" } });
    expect(await screen.findByText("fix(XTRM-305): silence virtual-bead spam")).toBeTruthy();
    expect(screen.queryByText("feat(XTRM-301): rail keyboard model v2")).toBeNull();
  });

  it("renders diff, review and comment counts from the row, and unknown where the row carries none", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");

    const counted = await screen.findByText("chore(XTRM-857): two reviews, three comments");
    const countedRow = counted.closest('[data-testid="pull-row"]') as HTMLElement;
    // XTRM-1136: the diff reads in GitHub's colours, bold; checks and review sit in tint pills.
    const diff = within(countedRow).getByTitle("24 added, 7 removed");
    expect(diff.textContent).toBe("+24 \u22127");
    expect(diff.className).toContain("font-semibold");
    expect(within(diff).getByText("+24").className).toContain("text-success-ink");
    expect(within(diff).getByText("\u22127").className).toContain("text-danger");
    const checks = within(countedRow).getByTestId("pull-checks");
    expect(checks.getAttribute("data-slot")).toBe("badge");
    const review = within(countedRow).getByTestId("pull-review");
    expect(review.textContent).toBe("approved");
    expect(review.className).toContain("text-success-ink");
    // The review pill sheds below xl through its wrapper: a `hidden` on the Badge loses to its inline-flex.
    expect(review.parentElement!.className).toBe("hidden xl:inline-flex");
    expect(review.className).not.toContain("hidden");
    expect(within(countedRow).getByTitle(/3 conversation comments/)).toBeTruthy();
    expect(within(countedRow).getByTitle("24 added, 7 removed")).toBeTruthy();
    expect(within(countedRow).getByTitle("approved \u00b7 2 reviews")).toBeTruthy();

    const unknown = await screen.findByText("chore(XTRM-857): unknown metrics sample");
    const unknownRow = unknown.closest('[data-testid="pull-row"]') as HTMLElement;
    expect(within(unknownRow).getByTitle("Diff counts unknown")).toBeTruthy();
    expect(within(unknownRow).getByTitle("Conversation comment count unknown")).toBeTruthy();
    expect(within(unknownRow).getByTitle("Review state: unknown")).toBeTruthy();
    expect(within(unknownRow).getAllByTitle("checks unknown").length).toBeGreaterThan(0);
    expect(within(unknownRow).getAllByText("unknown").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the head -> base branch and the review count in the drawer", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    fireEvent.click(await screen.findByText("chore(XTRM-857): two reviews, three comments"));
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("Reviews \u00b7 2")).toBeTruthy();
    // The header and the Overview field both state the branch.
    expect(within(el).getAllByText(/xt\/x857-counts \u2192 main/).length).toBeGreaterThan(0);
    // The header carries the diff and the file count; commits keep an Overview row.
    expect(within(el).getByText("2 files")).toBeTruthy();
    expect(within(el).getByText("2 commits")).toBeTruthy();
  });

  it("renders the drawer's unknown branch, diff and review state as unknown", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    fireEvent.click(await screen.findByText("chore(XTRM-857): unknown metrics sample"));
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("Reviews \u00b7 unknown")).toBeTruthy();
    expect(within(el).getAllByText(/unknown \u2192 unknown/).length).toBeGreaterThan(0);
    expect(within(el).getByTitle("Diff counts unavailable from the source")).toBeTruthy();
    expect(within(el).getByText("Review data unavailable from the source.")).toBeTruthy();
    expect(within(el).getByText("File summary unavailable from the source.")).toBeTruthy();
    expect(within(el).getByText("Conversation unavailable from the source.")).toBeTruthy();
    expect(within(el).getByText(/commits unknown/)).toBeTruthy();
  });

  it("opens the PR drawer from a row with overview, checks, reviews, files, and linked issues", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    fireEvent.click(await screen.findByText("feat(XTRM-301): rail keyboard model v2"));
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("Linked Substrate issues")).toBeTruthy();
    expect(within(el).getByText(/Reviews/)).toBeTruthy();
    expect(within(el).getByText(/Files changed/)).toBeTruthy();
    // checks + review state render in the overview (StatusDot mirrors the label for screen readers)
    expect(within(el).getAllByText("checks passing").length).toBeGreaterThan(0);
    await waitFor(() => expect(search(router).inspect).toBe("pr:xtrm-dev/xtrm#212"));
  });

  it("opens the PR drawer from a Substrate provenance chip", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues/XTRM-301");
    fireEvent.click(await screen.findByRole("tab", { name: /Provenance/ }));
    expect((await screen.findAllByText("Pull requests")).length).toBeGreaterThan(0);
    // Wait for the PR chip query to resolve: resolution wraps the button in a
    // tooltip and replaces the pending node, so a handle taken earlier would be detached.
    const chip = await screen.findByRole("button", { name: /rail keyboard model v2/ });
    expect(chip.getAttribute("data-reference")).toBe("@pr:xtrm-dev/xtrm#212");
    fireEvent.click(chip);
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("feat(XTRM-301): rail keyboard model v2")).toBeTruthy();
  });

  it("restores ?inspect=pr:… from the URL", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=pr:xtrm-dev/xtrm%23212");
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("feat(XTRM-301): rail keyboard model v2")).toBeTruthy();
    expect(search(router).inspect).toBe("pr:xtrm-dev/xtrm#212");
  });

  it("scopes a bare #N inside the drawer to the drawer's repository, not the shell repository", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=pr:Jaggerxtrm/console%23212");
    const el = await screen.findByTestId("inspector-drawer");
    // The fixture body of PR 212 mentions #211. The shell route is xtrm-dev/xtrm, so a chip
    // resolved against the shell would carry that repository and this assertion would fail.
    const chip = await within(el).findByRole("button", { name: /#211/ });
    expect(chip.getAttribute("data-reference")).toBe("@pr:Jaggerxtrm/console#211");
    // The title renders inline, not only in the accessible name.
    expect(within(chip).getByText("fix(XTRM-305): silence virtual-bead spam")).toBeTruthy();
    expect(within(el).getByRole("link", { name: /Open Jaggerxtrm\/console#211 on GitHub/ }).getAttribute("href"))
      .toBe("https://github.com/Jaggerxtrm/console/pull/211");
  });
});

describe("PR identity (§4.4-4.5)", () => {
  it("shows the key, the linked column and the copy action, and no state dot, in the list", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    const title = await screen.findByText("feat(XTRM-301): rail keyboard model v2");
    const row = title.closest("[data-testid='pull-row']") as HTMLElement;
    // The key is a dim address; the state is the solid chip beside it (2026-11-24 follow-up).
    const key = within(row).getByLabelText("Pull request #212");
    expect(key.className).toContain("text-ink-muted");
    expect(key.className).not.toContain("bg-");
    const chip = within(row).getByText("Open", { selector: "[data-slot='badge']" });
    expect(chip.className).toContain("bg-chip-success");
    expect(chip.className).toContain("text-white");
    expect(within(row).getByLabelText("Copy xtrm-dev/xtrm#212")).toBeTruthy();
  });

  it("collapses surplus linked refs into +N instead of overflowing the cell", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    const title = await screen.findByText("fix(XTRM-305): silence virtual-bead spam");
    const row = title.closest("[data-testid='pull-row']") as HTMLElement;
    expect(within(row).getAllByRole("button").filter((b) => b.getAttribute("data-reference")?.startsWith("@issue:"))).toHaveLength(1);
    // The compact cell shows the primary key alone; the alias lives in the tooltip and the popover.
    const compact = within(row).getAllByRole("button").filter((b) => b.getAttribute("data-reference")?.startsWith("@issue:"))[0];
    expect(compact.textContent ?? "").not.toContain("/");
    const more = within(row).getByLabelText("1 more linked issues");
    expect(more.textContent).toBe("+1");
    fireEvent.click(more);
    const chips = await screen.findAllByRole("button", { name: /XTRM-\d+/ });
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  it("opens the +N popover on Enter without opening the inspector", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    const title = await screen.findByText("fix(XTRM-305): silence virtual-bead spam");
    const row = title.closest("[data-testid='pull-row']") as HTMLElement;
    const more = within(row).getByLabelText("1 more linked issues");
    // Enter must not bubble into the row's own activation; the trigger opens its own popover.
    fireEvent.keyDown(more, { key: "Enter" });
    expect(screen.queryByTestId("inspector-drawer")).toBeNull();
    fireEvent.click(more);
    // Several rows may link the same issue now that every state renders by default: the popover is
    // what has to carry the chip, not the page.
    expect((await screen.findAllByRole("button", { name: /XTRM-94/ })).length).toBeGreaterThan(0);
  });

  it("renders the §4.5 inspector header: key, state chip, branch, diff, files, author, dates", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls?inspect=pr:xtrm-dev/xtrm%23212");
    const el = await screen.findByTestId("inspector-drawer");
    const header = await within(el).findByTestId("pull-header");
    expect(within(header).getByLabelText("Pull request #212, open")).toBeTruthy();
    const chip = within(header).getByText("Open").closest("[data-slot='badge']") as HTMLElement;
    expect(chip.className).toContain("bg-chip-success");
    expect(within(header).getByText(/xt\/o8h2 → main/)).toBeTruthy();
    expect(within(header).getByText("+412")).toBeTruthy();
    expect(within(header).getByText("−88")).toBeTruthy();
    expect(within(header).getByText("3 files")).toBeTruthy();
    expect(within(header).getByText(/opened/)).toBeTruthy();
    // Restraint rule 3: the header control is a ghost, not a filled pill.
    const pill = within(header).getByTestId("github-pill");
    expect(pill.className).toContain("hover:bg-hover");
    expect(pill.className).not.toContain("bg-github");
    // Author, Branch and Change left the Overview: the header is their only home now.
    expect(within(el).queryByText("Change")).toBeNull();
  });
});
