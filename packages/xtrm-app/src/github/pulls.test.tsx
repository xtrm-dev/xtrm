import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { fixturePulls } from "../adapters/github/fixture.ts";
import { extractIssueKeys, filterPulls, parseProvenancePr, parsePullRef, sortPulls } from "./pr.ts";

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

  it("filters by view and query, sorts by updated/created/comments", () => {
    const pulls = fixturePulls("xtrm-dev/xtrm");
    expect(filterPulls(pulls, "open", "").every((p) => p.state === "open")).toBe(true);
    expect(filterPulls(pulls, "merged", "").every((p) => p.state === "merged")).toBe(true);
    expect(filterPulls(pulls, "closed", "").every((p) => p.state === "closed")).toBe(true);
    expect(filterPulls(pulls, "open", "XTRM-301").map((p) => p.number)).toEqual([212]);
    expect(filterPulls(pulls, "open", "xt/o8h2").map((p) => p.number)).toEqual([212]);
    const byComments = sortPulls(pulls, "comments");
    expect(byComments[0]!.comments).toBeGreaterThanOrEqual(byComments[1]!.comments);
    const byUpdated = sortPulls(pulls, "updated");
    expect(byUpdated[0]!.updatedAt >= byUpdated[1]!.updatedAt).toBe(true);
  });
});

describe("Pull requests surface", () => {
  it("lists PRs with Open/Merged/Closed views, filter, and sort", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/pulls");
    expect(await screen.findByRole("region", { name: "Pull requests" })).toBeTruthy();
    // Open view shows the XTRM-301 PR with its linked issue chip.
    expect(await screen.findByText("feat(XTRM-301): rail keyboard model v2")).toBeTruthy();
    expect(screen.getByText("#212")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Merged/ }));
    expect(await screen.findByText("feat(XTRM-94): Substrate Documentation vNext")).toBeTruthy();
    expect(screen.queryByText("feat(XTRM-301): rail keyboard model v2")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /^Open/ }));
    fireEvent.change(screen.getByLabelText("Filter pull requests"), { target: { value: "XTRM-305" } });
    expect(await screen.findByText("fix(XTRM-305): silence virtual-bead spam")).toBeTruthy();
    expect(screen.queryByText("feat(XTRM-301): rail keyboard model v2")).toBeNull();
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
});
