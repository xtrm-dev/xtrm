import { Badge } from "../ui/badge.tsx";
import { GithubMark } from "../ui/github-mark.tsx";
import { cx } from "../ui/primitives.tsx";

/** App accounts are `name[bot]` on GitHub (`github-actions[bot]`, `dependabot[bot]`). */
export const isBotLogin = (login: string) => /\[bot\]$/i.test(login.trim());

const BOX = { md: "size-6", sm: "size-5" } as const;

/** GitHub's own convention: app accounts show the octocat mark, people show an initial.
 * The backend sends no avatar URLs, so a letter is the best human stand-in. */
export function AuthorAvatar({ login, size = "md" }: { login: string; size?: "md" | "sm" }) {
  if (isBotLogin(login)) {
    return (
      <span aria-hidden className={cx("flex shrink-0 items-center justify-center rounded-full bg-control text-ink-muted", BOX[size])}>
        <GithubMark size={size === "sm" ? "micro" : "xs"} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cx("flex shrink-0 items-center justify-center rounded-full bg-control font-medium text-ink-muted", BOX[size], size === "sm" ? "text-2xs" : "text-xs")}>
      {(login.slice(0, 1) || "—").toUpperCase()}
    </span>
  );
}

/** Login with the mark for app accounts, so a bot reads as a bot where the name is shown as text. */
export function AuthorName({ login, className }: { login: string; className?: string }) {
  return (
    <span className={cx("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate">{login}</span>
      {isBotLogin(login) && <Badge size="xs" tone="muted">app</Badge>}
    </span>
  );
}

/** Compact inline identity for a table row or a detail grid: avatar plus login. */
export function AuthorInline({ login }: { login: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <AuthorAvatar login={login} size="sm" />
      <AuthorName login={login} />
    </span>
  );
}
