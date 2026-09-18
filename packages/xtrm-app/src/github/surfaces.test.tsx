import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { mapIssue, mapRelease, parseLabels } from "../adapters/github/live.ts";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { filterIssues, parseGithubIssueRef } from "./issues.ts";
import { splitFrontmatter } from "./ContentSurface.tsx";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

const repo = "/rep/xtrm-dev/xtrm";
const row = (wire: Partial<Parameters<typeof mapIssue>[0]> = {}) =>
  mapIssue({ repo: "xtrm-dev/xtrm", number: 7, title: "t", body: null, state: "open", author: "octocat", url: "u", comment_count: null, label_names: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z", closed_at: null, ...wire });

describe("github issue and release mapping", () => {
  it("parses labels and degrades a malformed list to none", () => {
    expect(parseLabels('["bug","ui"]')).toEqual(["bug", "ui"]);
    expect(parseLabels("not json")).toEqual([]);
    expect(parseLabels(null)).toEqual([]);
  });

  it("maps issue rows with explicit fallbacks", () => {
    expect(row({ label_names: '["bug"]', comment_count: 4 })).toMatchObject({ number: 7, state: "open", labels: ["bug"], comments: 4 });
    // An unknown state is not invented: anything other than closed reads as open.
    expect(row({ state: "reopened" }).state).toBe("open");
    expect(row().comments).toBe(0);
  });

  it("falls back to the tag when a release carries no name, and builds the url", () => {
    const r = mapRelease({ id: 9, repo_full_name: "xtrm-dev/xtrm", tag_name: "v1.2.0", name: "  ", body: null, author_login: null, published_at: null, html_url: null });
    expect(r).toMatchObject({ id: "9", name: "v1.2.0", url: "https://github.com/xtrm-dev/xtrm/releases/tag/v1.2.0", notes: null });
  });

  it("filters by state, title, author and label", () => {
    const rows = [row({ number: 1, title: "Drawer bug", label_names: '["ui"]' }), row({ number: 2, title: "Docs", state: "closed" })];
    expect(filterIssues(rows, "open", "").map((i) => i.number)).toEqual([1]);
    expect(filterIssues(rows, "open", "ui").map((i) => i.number)).toEqual([1]);
    expect(filterIssues(rows, "closed", "").map((i) => i.number)).toEqual([2]);
    expect(filterIssues(rows, "open", "nothing")).toEqual([]);
  });

  it("parses owner/repo#N references and rejects bare keys", () => {
    expect(parseGithubIssueRef("xtrm-dev/xtrm#41")).toEqual({ fullName: "xtrm-dev/xtrm", number: 41 });
    expect(parseGithubIssueRef("XTRM-41")).toBeNull();
  });
});

describe("GitHub Issues surface", () => {
  it("lists open issues, is labelled distinctly from XTRM Issues, and inspects one in the drawer", async () => {
    const router = renderAt(`${repo}/code/issues`);
    expect(await screen.findByRole("region", { name: "GitHub Issues" })).toBeTruthy();
    expect(screen.getByText("GitHub tracker, not XTRM Issues")).toBeTruthy();
    expect(await screen.findByText("Drawer keyboard trap when maximized")).toBeTruthy();
    // Closed issues stay out of the open view.
    expect(screen.queryByText("Flaky release smoke on slow disks")).toBeNull();

    fireEvent.click(screen.getByText("Drawer keyboard trap when maximized"));
    const drawer = await screen.findByTestId("inspector-drawer");
    expect(await within(drawer).findByRole("heading", { name: "Drawer keyboard trap when maximized" })).toBeTruthy();
    expect(within(drawer).getAllByText("bug").length).toBeGreaterThan(0);
    // The drawer names the kind so a GitHub issue is never mistaken for an XTRM contract.
    expect(within(drawer).getByTitle("GitHub issue")).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ inspect: "gh-issue:xtrm-dev/xtrm#41" });
  });

  it("switches to closed and filters", async () => {
    renderAt(`${repo}/code/issues`);
    fireEvent.click(await screen.findByRole("tab", { name: /Closed/ }));
    expect(await screen.findByText("Flaky release smoke on slow disks")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter GitHub issues"), { target: { value: "zzz" } });
    expect(await screen.findByText(/No closed GitHub issues matching/)).toBeTruthy();
  });
});

describe("Releases surface", () => {
  it("renders the timeline with notes and turns issue keys in notes into reference chips", async () => {
    renderAt(`${repo}/code/releases`);
    expect(await screen.findByRole("region", { name: "Releases" })).toBeTruthy();
    expect(await screen.findByText("0.4.0 — inspector motion")).toBeTruthy();
    expect(screen.getByText("latest")).toBeTruthy();
    // A release with no name falls back to its tag; one with no notes says so.
    // No name: the heading falls back to the tag, so the tag appears as heading and badge.
    expect(screen.getAllByText("v0.2.0")).toHaveLength(2);
    expect(screen.getByText("No release notes.")).toBeTruthy();
    const chip = await screen.findByRole("button", { name: /^XTRM-300\.1 / });
    expect(chip.getAttribute("data-reference")).toBe("@issue:XTRM-301");
  });
});

describe("Repository content surface", () => {
  it("splits report frontmatter from prose and leaves a plain document untouched", () => {
    const parsed = splitFrontmatter("---\nsession_date: 2026-09-18\nbranch: main\n---\n# Report\n\nBody.");
    expect(parsed.fields).toEqual([["session_date", "2026-09-18"], ["branch", "main"]]);
    expect(parsed.body).toBe("# Report\n\nBody.");
    expect(splitFrontmatter("# Plain\n")).toEqual({ fields: [], body: "# Plain\n" });
  });

  it("renders the README and switches to CHANGELOG and to a session report", async () => {
    renderAt(`${repo}/code/content`);
    expect(await screen.findByRole("region", { name: "Repository content" })).toBeTruthy();
    expect(await screen.findByText("Agent-first operating environment.")).toBeTruthy();

    fireEvent.click(screen.getByText("CHANGELOG"));
    expect(await screen.findByText(/GitHub Issues, Releases and Repository content surfaces/)).toBeTruthy();

    fireEvent.click(await screen.findByText("2026-09-17-4890f38"));
    await waitFor(() => expect(screen.getByText(/Closed XTRM-397 with tests/)).toBeTruthy());
  });
});
