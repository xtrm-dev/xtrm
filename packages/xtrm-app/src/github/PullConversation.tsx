import type { PullRequestComment, PullRequestReview, PullRequestReviewComment, ReviewState } from "../adapters/types.ts";
import { reviewLabel } from "./pr.ts";
import { Markdown } from "../ui/markdown.tsx";
import { Badge } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { AuthorAvatar, AuthorName } from "./identity.tsx";
import { ago } from "../ui/primitives.tsx";

// --- grouping ---------------------------------------------------------------

export interface ReviewThread {
  key: string;
  path: string;
  line: number | null;
  root: PullRequestReviewComment;
  replies: PullRequestReviewComment[];
}

export const threadLine = (c: Pick<PullRequestReviewComment, "line" | "originalLine">): number | null => c.line ?? c.originalLine ?? null;

const threadKeyFor = (path: string, line: number | null): string => `${path}:${line ?? "?"}`;

/**
 * Group code-anchored comments into threads. Each comment follows its
 * `inReplyToId` chain to an ultimate root; the thread key is the root's
 * (path, line ?? original_line). Same-line comments without `in_reply_to_id`
 * (the current backend shape) therefore thread together, outdated comments
 * (line null, original_line set) still group, and an explicit reply wins
 * over line differences. Same-line distinct roots merge: a deliberate
 * simplification while the backend omits reply links (SIMPLIFIED).
 */
export function groupReviewThreads(comments: PullRequestReviewComment[]): ReviewThread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const anchorOf = (c: PullRequestReviewComment): PullRequestReviewComment => {
    let cur = c;
    const seen = new Set<string>([cur.id]);
    while (cur.inReplyToId) {
      const parent = byId.get(cur.inReplyToId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      cur = parent;
    }
    return cur;
  };
  const groups = new Map<string, PullRequestReviewComment[]>();
  for (const c of comments) {
    const anchor = anchorOf(c);
    const key = threadKeyFor(anchor.path, threadLine(anchor));
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const threads: ReviewThread[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const root = sorted[0]!;
    const anchor = anchorOf(root);
    threads.push({ key, path: anchor.path, line: threadLine(anchor), root, replies: sorted.slice(1) });
  }
  threads.sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt));
  return threads;
}

// --- conversation ordering --------------------------------------------------

export type ConversationItem =
  | { kind: "comment"; id: string; author: string; body: string; url: string | null; at: string }
  | { kind: "review"; id: string; author: string; state: ReviewState; body: string; url: string | null; at: string };

/** Chronological merge of conversation comments and non-empty review summaries. */
export function buildConversation(comments: PullRequestComment[], reviews: PullRequestReview[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  for (const c of comments) {
    if (!c.body.trim()) continue;
    items.push({ kind: "comment", id: c.id, author: c.author, body: c.body, url: c.url, at: c.createdAt });
  }
  for (const r of reviews) {
    const body = r.body ?? "";
    if (!body.trim()) continue;
    items.push({ kind: "review", id: r.id, author: r.author, state: r.state, body, url: r.url, at: r.submittedAt ?? "" });
  }
  items.sort((a, b) => {
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at.localeCompare(b.at);
  });
  return items;
}

// --- presentation -----------------------------------------------------------

function When({ at, url }: { at: string; url: string | null }) {
  const label = at ? ago(at) : "—";
  const title = at ? new Date(at).toLocaleString() : undefined;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-ink-faint tabular hover:text-ink-muted hover:underline" title={title}>
        {label}
      </a>
    );
  }
  return (
    <span className="shrink-0 text-xs text-ink-faint tabular" title={title}>
      {label}
    </span>
  );
}

function Message({ author, at, url, badge, body }: { author: string; at: string; url: string | null; badge?: string; body: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <AuthorAvatar login={author} />
        <AuthorName login={author} className="text-sm text-ink" />
        {badge && <Badge size="xs">{badge}</Badge>}
        <span className="ml-auto">
          <When at={at} url={url} />
        </span>
      </div>
      <div className="border-l border-border-muted pl-3">
        <Markdown html>{body}</Markdown>
      </div>
    </div>
  );
}

/** Conversation section body: chronological comments + review summaries, then code threads. */
export function PullConversation({
  comments,
  reviews,
  reviewComments,
}: {
  comments: PullRequestComment[];
  reviews: PullRequestReview[];
  reviewComments: PullRequestReviewComment[];
}) {
  const items = buildConversation(comments, reviews);
  const threads = groupReviewThreads(reviewComments);
  if (!items.length && !threads.length) return <p className="text-sm text-ink-faint">No conversation yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((it) =>
            it.kind === "comment" ? (
              <li key={`c-${it.id}`}>
                <Message author={it.author} at={it.at} url={it.url} body={it.body} />
              </li>
            ) : (
              <li key={`r-${it.id}`}>
                <Message author={it.author} at={it.at} url={it.url} badge={reviewLabel(it.state)} body={it.body} />
              </li>
            ),
          )}
        </ul>
      )}
      {threads.map((t) => (
        <div key={t.key} className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
            <Icon name="file" size="xs" className="shrink-0" />
            <span className="min-w-0 truncate font-mono text-ink-muted">
              {t.path}:{t.line ?? "?"}
            </span>
          </div>
          <Message author={t.root.author} at={t.root.createdAt} url={t.root.url} body={t.root.body} />
          {t.replies.length > 0 && (
            <ul className="ml-3 flex flex-col gap-3 border-l border-border-muted pl-3">
              {t.replies.map((r) => (
                <li key={r.id}>
                  <Message author={r.author} at={r.createdAt} url={r.url} body={r.body} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
