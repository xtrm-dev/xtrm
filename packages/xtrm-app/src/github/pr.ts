import type { ContextReference } from "../refs/references.tsx";
import type { CheckState, PullRequestSummary, PullState, ReviewState } from "../adapters/types.ts";
import type { Tone } from "../ui/primitives.tsx";

/** Canonical PR ref: `owner/repo#N`. Serialized as `@pr:owner/repo#N`. */
export interface ParsedPullRef {
  owner: string;
  repo: string;
  fullName: string;
  number: number;
}

const PULL_REF_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;

export function parsePullRef(ref: string): ParsedPullRef | null {
  const m = PULL_REF_RE.exec(ref.trim());
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, fullName: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

export const formatPullRef = (owner: string, repo: string, number: number) => `${owner}/${repo}#${number}`;

export const pullReference = (owner: string, repo: string, number: number): ContextReference => ({
  kind: "pr",
  ref: formatPullRef(owner, repo, number),
});

/** Issue keys in PR titles, branches, and bodies resolve to Substrate chips. */
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)\b/g;

export function extractIssueKeys(...texts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(ISSUE_KEY_RE)) {
      const key = m[1]!;
      // Guard the UTF-8 false positive the issue surface already documents.
      if (key === "UTF-8") continue;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

const GITHUB_PR_URL_RE = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/#?].*)?$/i;

/**
 * Substrate provenance PR strings resolve to PR chips. Accepts canonical
 * `owner/repo#N`, GitHub PR URLs, and bare `#N` / `N` (resolved against the
 * current repository). Returns null when the value is not a PR reference.
 */
export function parseProvenancePr(value: string, currentRepo: string): ContextReference | null {
  const text = value.trim();
  if (!text) return null;
  const direct = parsePullRef(text);
  if (direct) return { kind: "pr", ref: `${direct.fullName}#${direct.number}` };
  const url = GITHUB_PR_URL_RE.exec(text);
  if (url) return { kind: "pr", ref: `${url[1]}/${url[2]}#${Number(url[3])}` };
  const bare = /^#?(\d+)$/.exec(text);
  if (bare) return { kind: "pr", ref: `${currentRepo}#${Number(bare[1])}` };
  return null;
}

export function pullStateTone(state: PullState): Tone {
  switch (state) {
    case "open":
      return "active";
    case "merged":
      return "accent";
    case "closed":
      return "done";
  }
}

export function pullStateLabel(state: PullState, draft: boolean): string {
  if (state === "open" && draft) return "draft";
  return state;
}

export function checkTone(state: CheckState): Tone {
  switch (state) {
    case "passing":
      return "done";
    case "failing":
      return "danger";
    case "pending":
      return "accent";
    case "none":
      return "muted";
  }
}

export function checkLabel(state: CheckState): string {
  switch (state) {
    case "passing":
      return "checks passing";
    case "failing":
      return "checks failing";
    case "pending":
      return "checks pending";
    case "none":
      return "no checks";
  }
}

export function reviewLabel(state: ReviewState): string {
  switch (state) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes requested";
    case "commented":
      return "commented";
    case "pending":
      return "review pending";
    case "none":
      return "no reviews";
  }
}

export type PullView = "open" | "merged" | "closed";

export function pullViewOf(p: Pick<PullRequestSummary, "state">): PullView {
  return p.state;
}

export function filterPulls(
  pulls: PullRequestSummary[],
  view: PullView,
  query: string,
): PullRequestSummary[] {
  const q = query.trim().toLowerCase();
  return pulls.filter((p) => {
    if (pullViewOf(p) !== view) return false;
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q) ||
      p.headBranch.toLowerCase().includes(q) ||
      String(p.number).includes(q)
    );
  });
}

export type PullSort = "updated" | "created" | "comments";

export function sortPulls(pulls: PullRequestSummary[], sort: PullSort): PullRequestSummary[] {
  const rows = [...pulls];
  switch (sort) {
    case "created":
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "comments":
      rows.sort((a, b) => b.comments - a.comments || b.updatedAt.localeCompare(a.updatedAt));
      break;
    case "updated":
    default:
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
  }
  return rows;
}
