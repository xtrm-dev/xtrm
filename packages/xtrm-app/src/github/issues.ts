import type { GithubIssueSummary } from "../adapters/index.tsx";
import type { Tone } from "../ui/primitives.tsx";

export type IssueView = "open" | "closed";

export const issueStateTone = (state: GithubIssueSummary["state"]): Tone => (state === "open" ? "active" : "done");
export const issueStateLabel = (state: GithubIssueSummary["state"]) => (state === "open" ? "open" : "closed");

/** `owner/repo#N`, the same shape PR references use. Kept distinct from XTRM issue keys. */
export const githubIssueRef = (repo: string, number: number) => `${repo}#${number}`;

/** github.com address for a GitHub-tracker issue; the chip's explicit "open outside" action. */
export const githubIssueUrl = (fullName: string, number: number) => `https://github.com/${fullName}/issues/${number}`;

const GH_ISSUE_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;

export function parseGithubIssueRef(value: string): { fullName: string; number: number } | null {
  const m = GH_ISSUE_REF.exec(value.trim());
  return m ? { fullName: m[1]!, number: Number(m[2]) } : null;
}

export function filterIssues(rows: GithubIssueSummary[], view: IssueView, query: string): GithubIssueSummary[] {
  const q = query.trim().toLowerCase();
  return rows.filter((i) => {
    if (i.state !== view) return false;
    if (!q) return true;
    return (
      i.title.toLowerCase().includes(q) ||
      i.author.toLowerCase().includes(q) ||
      String(i.number).includes(q) ||
      i.labels.some((l) => l.toLowerCase().includes(q))
    );
  });
}
