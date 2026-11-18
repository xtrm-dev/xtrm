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

// A segment may not start with a dot: `.`, `..` and `.hidden` would turn
// untrusted prose into path-like API reads (`/api/github/../../5`).
const PULL_SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9_.-]*";
const PULL_REF_RE = new RegExp(`^(${PULL_SEGMENT})/(${PULL_SEGMENT})#(\\d+)$`);

export function parsePullRef(ref: string): ParsedPullRef | null {
  const m = PULL_REF_RE.exec(ref.trim());
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, fullName: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

export const formatPullRef = (owner: string, repo: string, number: number) => `${owner}/${repo}#${number}`;

/** github.com address for a pull request; the chip's explicit "open outside the app" action. */
export const pullUrl = (fullName: string, number: number) => `https://github.com/${fullName}/pull/${number}`;

/** A bare `#N` in prose. It names no repository; the reading surface supplies one. */
export function parseBarePullNumber(ref: string): number | null {
  const m = /^#(\d+)$/.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

/**
 * A `pr` reference read from prose. A canonical `owner/repo#N` resolves as written; a bare
 * `#N` resolves against the repository that owns the reading surface, so the same number in
 * two surfaces never crosses repositories. Null when the text is not a pull-request reference.
 */
export function resolvePullReference(ref: string, ambientRepo: string): ParsedPullRef | null {
  const canonical = parsePullRef(ref);
  if (canonical) return canonical;
  const number = parseBarePullNumber(ref);
  return number === null ? null : parsePullRef(`${ambientRepo}#${number}`);
}

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

export function checkTone(state: CheckState | null): Tone {
  switch (state) {
    case null:
      return "muted";
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

export function checkLabel(state: CheckState | null): string {
  switch (state) {
    case null:
      return "checks unknown";
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

export function reviewLabel(state: ReviewState | null): string {
  switch (state) {
    case null:
      return "unknown";
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
      (p.headBranch ?? "").toLowerCase().includes(q) ||
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
      // An unknown comment count sorts last instead of pretending to be 0.
      rows.sort((a, b) => (b.comments ?? -1) - (a.comments ?? -1) || b.updatedAt.localeCompare(a.updatedAt));
      break;
    case "updated":
    default:
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
  }
  return rows;
}
