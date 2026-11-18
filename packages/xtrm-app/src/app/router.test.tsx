import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { MODES, PROJECT_SECTIONS, REPO_SECTIONS, destinationHref, modeHref } from "./destinations.ts";
import { createAppRouter } from "./router.tsx";

const REPO = { owner: "mercury", name: "market-data" };
const REPO_KEY = "xtrm.console.repo.v1";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router, history };
}

const projectItem = REPO_SECTIONS.flatMap((s) => s.items).find((i) => i.id === "project")!;

describe("Project destinations", () => {
  it("resolves the Project rail entry to the selected repository", () => {
    expect(destinationHref(REPO, projectItem)).toBe("/rep/mercury/market-data/project");
    expect(projectItem.path).toBeUndefined();
  });

  it("expresses a repo-relative mode path instead of the hardcoded Issues fallback", () => {
    const work = MODES.find((m) => m.id === "work")!;
    expect(modeHref(work, REPO)).toBe("/rep/mercury/market-data/work/issues");
    const research = MODES.find((m) => m.id === "research")!;
    expect(modeHref(research, REPO)).toBe("/research");
    // A mode with neither an absolute nor a repository-relative path keeps the Issues default.
    expect(modeHref({ id: "work", label: "Work", icon: "work", path: null }, REPO)).toBe("/rep/mercury/market-data/work/issues");
  });

  it("declares the ADR-002 D2 sub-routes under the repository Project root", () => {
    expect(PROJECT_SECTIONS.map((s) => s.repoPath)).toEqual([
      "/project",
      "/project/timeline",
      "/project/questions",
      "/project/workers",
      "/project/followups",
      "/project/jira",
      "/project/settings",
    ]);
  });

  it("no mode is the retired cross-repository surface", () => {
    expect(MODES.map((m) => m.id)).not.toContain("program");
    expect(MODES.map((m) => m.path)).not.toContain("/program");
  });
});

describe("retired routes redirect", () => {
  it("/program lands on the selected repository's Project root", async () => {
    localStorage.setItem(REPO_KEY, "mercury/market-data");
    const { router } = renderAt("/program");
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/mercury/market-data/project"));
    expect((await screen.findByRole("region", { name: "Overview" })).textContent).toContain("Overview is not part of this vertical");
  });

  it("/program without a selected repository lands on the repository picker, not a dead route", async () => {
    const { router } = renderAt("/program");
    await waitFor(() => expect(router.state.location.pathname).toBe("/repositories"));
    expect(await screen.findByRole("region", { name: "Repositories" })).toBeTruthy();
  });

  it("the repository governance route lands on the same repository's Project root", async () => {
    const { router } = renderAt("/rep/mercury/market-data/governance/program");
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/mercury/market-data/project"));
    expect(await screen.findByRole("region", { name: "Overview" })).toBeTruthy();
  });

  it("a Project section renders its typed coming-state until its own issue lands", async () => {
    const { router } = renderAt("/rep/mercury/market-data/project/workers");
    expect(router.state.location.pathname).toBe("/rep/mercury/market-data/project/workers");
    expect((await screen.findByRole("region", { name: "Workers" })).textContent).toContain("Project Workers arrive with XTRM-819");
    expect(screen.queryByText(/Program/)).toBeNull();
  });
});
