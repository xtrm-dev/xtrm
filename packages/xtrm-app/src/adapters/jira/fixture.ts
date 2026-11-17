import { JiraError, type JiraAdapter, type JiraBinding, type JiraIssue, type JiraLinks, type JiraMissingReason, type JiraSearchPage } from "./types.ts";

// A small, realistic Jira slice for one repository (ADR-002 §3 JiraIssue shape). Issues and
// people are illustrative; the site is not the operator's tenant. The fixture mirrors the
// bridge's own contract — unbound repository, unbound issue, invalid key, foreign key — through
// the same typed errors the live adapter raises, so a surface behaves identically on either source.

/** The repository the fixture treats as Jira-integrated. */
export const FIXTURE_JIRA_REPO = "mercury/market-data";
export const FIXTURE_JIRA_PROJECT = "MMD";
export const FIXTURE_JIRA_SITE = "https://example.atlassian.net";

/** The key shape the bridge pins; a fixture key that would be refused live is refused here too. */
const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

const ISSUES: JiraIssue[] = [
  {
    key: "MMD-551",
    summary: "Ship the Project surface",
    status: "In Progress",
    assignee: "Console lead",
    url: `${FIXTURE_JIRA_SITE}/browse/MMD-551`,
    syncState: "in_sync",
    issueRef: "XTRM-816",
  },
  {
    key: "MMD-612",
    summary: "Nightly board sync drift",
    status: "To Do",
    assignee: null,
    url: `${FIXTURE_JIRA_SITE}/browse/MMD-612`,
    syncState: null,
    issueRef: null,
  },
  {
    key: "MMD-700",
    summary: "Jira chips on issue pages",
    status: "Done",
    assignee: "Quant reviewer",
    url: `${FIXTURE_JIRA_SITE}/browse/MMD-700`,
    syncState: "pending",
    issueRef: "XTRM-820",
  },
];

const keyProject = (key: string): string => key.slice(0, key.lastIndexOf("-"));

export function createJiraFixtureAdapter(opts: { repository?: string } = {}): JiraAdapter {
  const integrated = (opts.repository ?? FIXTURE_JIRA_REPO).toLowerCase();
  const bound = (repository: string): boolean => repository.toLowerCase() === integrated;

  const binding = (repository: string): JiraBinding => {
    const configured = bound(repository);
    return {
      repository,
      configured,
      reason: configured ? null : ("repo_not_bound" as JiraMissingReason),
      resolvedBy: configured ? "repo_slug" : "none",
      pmProject: configured ? "market-data" : null,
      substrateProject: configured ? "market-data" : null,
      site: configured ? FIXTURE_JIRA_SITE : null,
      project: configured ? FIXTURE_JIRA_PROJECT : null,
      boardId: configured ? "7" : null,
      tokenFile: configured ? "/home/operator/.config/xtrm/jira-token" : null,
      credentialPresent: configured,
    };
  };

  /** The same precedence the bridge enforces: unbound repo, invalid key, foreign project, absent. */
  const read = (repository: string, key: string): JiraIssue => {
    if (!bound(repository)) throw new JiraError("unbound", "repository has no jira binding", 404);
    if (!JIRA_KEY_RE.test(key)) throw new JiraError("bad_request", "jira request rejected", 400);
    if (keyProject(key) !== FIXTURE_JIRA_PROJECT) throw new JiraError("forbidden", "jira key is outside the bound project", 403);
    const issue = ISSUES.find((candidate) => candidate.key === key);
    if (!issue) throw new JiraError("not_found", "jira issue not found", 404);
    return issue;
  };

  return {
    source: "fixture",
    binding: (repository) => Promise.resolve(binding(repository)),
    async issue(repository, key) {
      return read(repository, key);
    },
    async search(repository, searchOpts): Promise<JiraSearchPage> {
      if (!bound(repository)) return Promise.reject(new JiraError("unbound", "repository has no jira binding", 404));
      const guard = searchOpts?.jql;
      if (guard && guard.trim() !== "" && guard.replace(/\s+/g, " ").trim().toUpperCase() !== `PROJECT = ${FIXTURE_JIRA_PROJECT}`) {
        throw new JiraError("bad_request", "jql is not supported beyond the bound project", 400);
      }
      return { issues: ISSUES, truncated: false, cachedAt: null };
    },
    async links(repository, keys): Promise<JiraLinks> {
      if (!bound(repository)) return Promise.reject(new JiraError("unbound", "repository has no jira binding", 404));
      const resolved: JiraIssue[] = [];
      for (const key of keys) {
        resolved.push(read(repository, key));
      }
      return { links: resolved, bindingsAvailable: true, cachedAt: null };
    },
  };
}

export const fixtureJira: JiraAdapter = createJiraFixtureAdapter();
