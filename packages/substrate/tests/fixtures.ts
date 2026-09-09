// Recorded provider payload fixtures for Phase 10 contract tests (F38-F43).
// Shapes mirror the documented GitHub/Jira webhook surfaces; no live calls.

export const GITHUB_ISSUE_OPENED = {
  action: "opened",
  issue: {
    id: 3001001,
    number: 241,
    title: "Sub-issue projection support",
    body: "Native sub-issue relationships for the programme board.",
    html_url: "https://github.com/xtrm-dev/xtrm/issues/241",
  },
  repository: { full_name: "xtrm-dev/xtrm" },
};

export const JIRA_WEBHOOK_CREATED = {
  webhookEvent: "jira:issue_created",
  issue: {
    id: "10042",
    key: "ISSUE-92",
    fields: {
      summary: "Programme milestone tracking",
      description: "Portfolio-level projection of the Substrate epic.",
    },
  },
};

export function remoteEdit(scope: string, remoteId: string, version: string, mapped: { title?: string; body?: string }) {
  return { remoteScope: scope, remoteId, remoteVersion: version, mapped };
}
