// Fixture git activity (XTRM-757): deterministic commits so the fixture build
// and the tests see the same feed as a live console, without a checkout.

import type { GitActivityAdapter } from "../types.ts";

const BASE = Date.parse("2026-11-12T10:00:00Z");

const COMMITS = [
  { sha: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d", author: "w2w9", subject: "fix(console): name a shadowed sb", at: BASE - 12 * 60_000 },
  { sha: "2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e", author: "t0a7", subject: "feat(substrate): paged journal feed", at: BASE - 95 * 60_000 },
  { sha: "3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f", author: "w2w9", subject: "docs(plan): step 26 delivery record", at: BASE - 260 * 60_000 },
];

export const fixtureGitActivity: GitActivityAdapter = {
  source: "fixture",
  async commits(_repo, limit = 50) {
    return COMMITS.slice(0, limit);
  },
};
