// Live git activity (XTRM-757): one bridge read, one `git log` on the machine
// that owns the checkout. The console never runs git itself.

import type { GitActivityAdapter } from "../types.ts";

interface WireGitLog {
  ok?: boolean;
  error?: string;
  commits?: Array<{ sha: string; author: string; subject: string; at: number }>;
}

export const liveGitActivity: GitActivityAdapter = {
  source: "live",
  async commits(repo, limit = 50) {
    const res = await fetch(`/xtrm-api/substrate/git-log?repo=${encodeURIComponent(repo)}&limit=${limit}`);
    const body = (await res.json()) as WireGitLog;
    if (body.ok === false) throw new Error(body.error ?? "git log failed");
    return body.commits ?? [];
  },
};
