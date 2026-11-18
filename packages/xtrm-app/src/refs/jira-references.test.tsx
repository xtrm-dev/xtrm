import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters, type Adapters, type SubstrateAdapter } from "../adapters/index.tsx";
import { JiraError, type JiraAdapter, type JiraBinding, type JiraIssue } from "../adapters/jira/types.ts";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

const REPO = "xtrm-dev/xtrm";
/** Generous: the whole-surface render under a loaded host outlives the 1s default. */
const SLOW = { timeout: 8000 };
const SITE = "https://example.atlassian.net";

function jiraIssue(key: string, over: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key,
    summary: `${key} summary`,
    status: "In Progress",
    assignee: "ada",
    url: `${SITE}/browse/${key}`,
    syncState: "in_sync",
    issueRef: null,
    bindingsAvailable: true,
    ...over,
  };
}

/** A repository bound to one Jira project that carries exactly these issues. */
function boundJira(issues: JiraIssue[]): JiraAdapter {
  const binding: JiraBinding = {
    repository: REPO,
    configured: true,
    reason: null,
    resolvedBy: "explicit",
    pmProject: "prj_xtrm",
    substrateProject: "prj_xtrm",
    site: SITE,
    project: "XTRM",
    boardId: "1",
    tokenFile: "~/.config/xtrm/jira-token",
    credentialPresent: true,
  };
  return {
    source: "fixture",
    async binding(repository) {
      return repository === REPO ? binding : { ...binding, configured: false, reason: "repo_not_bound" };
    },
    async issue(repository, key) {
      const found = issues.find((i) => i.key === key);
      if (!found) throw new JiraError("not_found", `${key} is not in the bound Jira project`, 404);
      return found;
    },
    async search() {
      return { issues, truncated: false, bindingsAvailable: true, bindingsReason: null, cachedAt: new Date().toISOString() };
    },
    async links(_repository, keys) {
      return { links: issues.filter((i) => keys.includes(i.key)), bindingsAvailable: true, bindingsReason: null, cachedAt: null };
    },
  };
}

function renderIssuePage({ problem, jira, ref = "XTRM-301" }: { problem?: string; jira: JiraAdapter; ref?: string }) {
  const substrate = createFixtureSubstrate();
  const wrapped: SubstrateAdapter =
    problem === undefined
      ? substrate
      : {
          ...substrate,
          async getIssue(issueRef, projectId, opts) {
            const issue = await substrate.getIssue(issueRef, projectId, opts);
            return { ...issue, contract: { ...issue.contract, problem } };
          },
        };
  const history = createMemoryHistory({ initialEntries: [`/rep/${REPO}/work/issues/${ref}`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const adapters: Adapters = { ...fixtureAdapters, substrate: wrapped, jira };
  render(<RouterProvider router={createAppRouter({ adapters, history, queryClient })} />);
}

describe("provider-aware references", () => {
  it("resolves a bare key both providers hold to Substrate, while @jira forces Jira", async () => {
    renderIssuePage({ problem: "Bare XTRM-301 and forced @jira:XTRM-301.", jira: boundJira([jiraIssue("XTRM-301", { issueRef: "XTRM-301" })]) });
    const problem = await screen.findByRole("region", { name: "Problem" }, SLOW);

    // The bare key exists in both providers: Substrate wins, so no Jira chip may claim it.
    const bare = await waitFor(() => {
      const el = problem.querySelector<HTMLElement>('[data-reference="@issue:XTRM-301"]');
      if (!el) throw new Error("the bare key did not resolve to the Substrate chip");
      return el;
    }, SLOW);
    expect(bare.tagName).toBe("BUTTON");

    const forced = await waitFor(() => {
      const el = problem.querySelector<HTMLAnchorElement>('[data-jira-key="XTRM-301"]');
      if (!el) throw new Error("the forced @jira: key did not resolve to a Jira chip");
      return el;
    }, SLOW);
    expect(forced.getAttribute("data-jira-key")).toBe("XTRM-301");
    expect(forced.getAttribute("href")).toBe(`${SITE}/browse/XTRM-301`);
  });

  it("renders a Jira chip for a bare key with no Substrate issue", async () => {
    renderIssuePage({ problem: "Shipped in MMD-551 yesterday.", jira: boundJira([jiraIssue("MMD-551")]) });
    const problem = await screen.findByRole("region", { name: "Problem" }, SLOW);
    const chip = await within(problem).findByRole("link", { name: /MMD-551/ }, SLOW);
    expect(chip.getAttribute("data-jira-key")).toBe("MMD-551");
  });

  it("keeps an unresolved key as prose, never a dead chip", async () => {
    renderIssuePage({ problem: "Bound MMD-551 and unknown NOPE-42.", jira: boundJira([jiraIssue("MMD-551")]) });
    const problem = await screen.findByRole("region", { name: "Problem" }, SLOW);
    await within(problem).findByRole("link", { name: /MMD-551/ }, SLOW);

    expect(problem.textContent).toContain("NOPE-42");
    expect(problem.querySelector('[data-reference*="NOPE-42"], [data-jira-key="NOPE-42"]')).toBeNull();
  });

  it("shows the bound Jira issue, with its remote status, on the Substrate issue page", async () => {
    renderIssuePage({ jira: boundJira([jiraIssue("XTRM-301", { issueRef: "XTRM-301", status: "In Review" })]) });

    const status = await screen.findByTestId("jira-chip-status", {}, SLOW);
    expect(status.textContent).toBe("In Review");
    const chip = screen.getByRole("link", { name: /XTRM-301/ });
    expect(chip.getAttribute("href")).toBe(`${SITE}/browse/XTRM-301`);
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(chip.getAttribute("rel")).toBe("noreferrer");
  });
});
