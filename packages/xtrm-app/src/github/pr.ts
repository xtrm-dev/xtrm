import { useMemo } from "react";
import { useIssueIndex, type ContextReference } from "../refs/references.tsx";
import { PR_STATES, prStateOf } from "../ui/pr-key.tsx";
import type { CheckState, PullDetailSection, PullRequestSummary, ReviewState } from "../adapters/types.ts";
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

/**
 * Thin wrappers over the one state model in `src/ui/pr-key.tsx` (§4.4): the dot is gone from the
 * list, but a few surfaces still render a dot and a word for the same resolved state.
 */
const STATE_TONE: Record<ReturnType<typeof prStateOf>, Tone> = {
  open: "active",
  draft: "neutral",
  merged: "accent",
  closed: "done",
  unknown: "muted",
};

export function pullStateTone(state: string | null, draft?: boolean | null): Tone {
  return STATE_TONE[prStateOf(state, draft)];
}

export function pullStateLabel(state: string | null, draft?: boolean | null): string {
  const key = prStateOf(state, draft);
  return key === "unknown" ? (state ?? "unknown") : PR_STATES[key].word.toLowerCase();
}

/**
 * Substrate refs for a pull request (§4.5), deduped by resolved issue: a locator and its flat ref
 * (`XTRM-300.1` / `XTRM-301`) point at the same row and must not render twice. Shared by the list
 * cell and the inspector, which is why it lives beside the other PR reads.
 */
export function usePrLinkedRefs(pull: { title: string | null; headBranch: string | null; body: string | null } | null): string[] {
  const index = useIssueIndex();
  return useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of extractIssueKeys(pull?.title, pull?.headBranch, pull?.body)) {
      const resolved = index.get(key)?.ref ?? key;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(key);
      }
    }
    return out;
  }, [pull?.title, pull?.headBranch, pull?.body, index]);
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

/**
 * Compact checks cell text: unknown stays a word (XTRM-857). A row with no checks reads "no checks"
 * since the checks cell became a pill (XTRM-1136); the em dash of XTRM-857 is superseded.
 */
export function checkShortLabel(state: CheckState | null): string {
  if (state === null) return "unknown";
  if (state === "none") return "no checks";
  return checkLabel(state).replace("checks ", "");
}

/** Mergeable row text; null means the row renders "—" (XTRM-857, F2). */
export function mergeableText(mergeable: boolean | null, mergeableState: string | null): string | null {
  if (!mergeableState) return null;
  if (mergeable === false) return `conflicts · ${mergeableState}`;
  if (mergeable === true) return `mergeable · ${mergeableState}`;
  return `unknown · ${mergeableState}`;
}

/**
 * The conversation merges issue comments, reviews and review comments, so a
 * failed fetch of any of the three leaves it incomplete: the drawer says
 * unavailable rather than "No conversation yet." (XTRM-857, F1).
 */
export function conversationUnavailable(sections: readonly PullDetailSection[]): boolean {
  return sections.some((section) => section === "comments" || section === "reviews" || section === "review_comments");
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

/** `all` is the mixed view: open, merged and closed together, newest activity first. */
export type PullView = "all" | "open" | "merged" | "closed";

/** The three states a pull request can be in: the disjoint members of the state filter. */
export type PullState = Exclude<PullView, "all">;

/** The default: every state on. An empty set is a deliberate "nothing", never "everything". */
export const ALL_PULL_STATES: ReadonlyArray<PullState> = ["open", "merged", "closed"];

export function pullViewOf(p: Pick<PullRequestSummary, "state">): PullState {
  return p.state;
}

export function filterPulls(
  pulls: PullRequestSummary[],
  states: ReadonlySet<PullState>,
  query: string,
): PullRequestSummary[] {
  const q = query.trim().toLowerCase();
  return pulls.filter((p) => {
    if (!states.has(pullViewOf(p))) return false;
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
