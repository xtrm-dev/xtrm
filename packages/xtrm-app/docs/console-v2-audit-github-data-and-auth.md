# Console v2 GitHub data path and authentication — decision report

Bead: XTRM-395. Epic: XTRM-394. Status: research only — no code changes, no OAuth/GitHub App registration.
Retrieval date for all external sources: 2026-09-16. Facts carry a cited source or a local `file:line` reference; everything else is marked **[inference]**.

## 1. Current path: what Console v1 actually does

Source: `~/dev/console/packages/core/src/github/` (`poller.ts` ~901 lines, `route-runtime.ts`, `token.ts`, `store.ts`).
Console v2 reads GitHub only through this backend (`packages/xtrm-app/src/adapters/github/live.ts` maps `/api/github/{repos,repos/stats,events}` DTOs and notes "The backend keeps owning fetch/cache/polling").

### 1.1 Polling volume per tracked repo per cycle

`GithubPoller` (`poller.ts`):

- Global tick `intervalMs` defaults to **5 min** (`poller.ts: constructor`, `start()`); per-repo gating via `isRepoDue()` + `getRepoActiveWindow()`: repos with activity in the last hour are due every **60 s**, repos idle > 24 h every **30 min**, otherwise every **10 min**. In practice the 5-minute tick is the effective cadence for active repos.
- Per due repo the poller issues **3 first-page REST GETs**: `pollIssues` (`GET /repos/{repo}/issues?state=all&since={watermark}`, `poller.ts: pollIssues`), `pollPullRequests` (`GET /repos/{repo}/pulls?state=all&sort=updated…`, `poller.ts: pollPullRequests`), `pollReleases` (`GET /repos/{repo}/releases`, `poller.ts: pollReleases`). Pagination beyond page 1 happens only while rows are newer than the watermark (`shouldStopOnWatermark`), so steady state is 3 requests/repo/cycle.
- Every first-page request is **ETag-gated** (`apiGetWithMeta`, `getIfNoneMatch`/`rememberEtag`; per-repo+endpoint ETags persisted in `RepoPollState`: `issue_etag`, `pr_etag`, `release_etag`). A `304 Not Modified` short-circuits the endpoint (`return { watermark: latest … successful: true }`).
- Extra requests only on genuinely new data: `fetchCompare` (1 GET per new PushEvent) and `fetchPullRequest` (1 GET per new PullRequestEvent) in `ingestEvents`.
- Concurrency is capped (`repoConcurrency`, clamped 1–8, default 4) and the poller serializes per worker; rate-limit backoff honors `Retry-After` / `X-RateLimit-Reset` and pauses when `remaining < 500` (`maybePauseForRateLimit`).

**Steady-state cost: 3 conditional GETs per repo per 5-minute cycle, and an authenticated `304` does not count against the primary rate limit** (see §2.2). So the steady-state primary-limit burn is **≈ 0 req/hour regardless of repo count**; only changed data costs requests (1 per changed endpoint page).

### 1.2 Staleness

- List data (issues/PRs/releases rows): up to **5 min** old for active repos (10 min / 30 min for quiet repos). Fine for lists and the Activity feed.
- Rich PR view: `getPrDetailPayload` (`route-runtime.ts`) fans out to **6 endpoints in parallel** (issue comments, PR reviews, review comments, commits, files, timeline), each paged up to 3 × 100 items (`githubApiPages`, maxPages 3) with a 2.5 s per-section timeout (`GITBOARD_PR_DETAIL_SECTION_TIMEOUT_MS`). Worst case **18 REST GETs per uncached PR view**, cached 60 s for open PRs / 10 min for closed (`OPEN_PR_DETAIL_CACHE_TTL_MS`, `CLOSED_PR_DETAIL_CACHE_TTL_MS`, 200-entry cap). **Missing today: check runs / commit statuses, mergeability (`mergeable`, `mergeable_state`), and diffs** — the PR view cannot show CI state or merge readiness without new fetches.
- Auth today: `getGithubToken()` (`token.ts`) reads `GITHUB_TOKEN` or shells out to `gh auth token`. Single shared token, no per-user identity, no refresh handling, read-only in practice. Write actions are impossible to attribute or scope per user.

### 1.3 Volume math (worst case, everything changes every cycle)

| Load | Requests/hour vs primary limit (5,000/hr) |
|---|---|
| N=10 active repos, 5-min cadence, all endpoints dirty, 1 page each | 10 × 3 × 12 = **360/hr** |
| N=50 same assumptions | 50 × 3 × 12 = **1,800/hr** |
| + 20 rich PR views/hr (18 GETs each, uncached) | **+360/hr** |
| + proposed checks/mergeability per PR view (+2 GETs) | +40/hr at 20 views/hr |

Conclusion: even the pessimistic case fits comfortably in one user's 5,000/hr REST budget. The binding constraints are **staleness (5 min) and missing endpoints**, not rate limits — plus secondary limits (concurrency/points-per-minute) if views fan out harder, which the current caps already respect.

## 2. External evidence (current GitHub docs)

### 2.1 REST vs GraphQL cost and rate limits

- **REST primary limit: 5,000 requests/hour per authenticated user** (PAT, OAuth user token, GitHub App user-to-server token share the user's bucket). Source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- **GraphQL primary limit: 5,000 *points*/hour per user**, not per call; cost is computed from connection fan-out (`first:` argument sizes), e.g. a query touching 100 repos × 50 issues × 60 labels scores 51 points. Mutations cost more. One rich PR query (PR + reviews + comments + check runs + files) typically costs single-digit points — **roughly 5–10× cheaper than the equivalent 20 REST calls**. Source: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- **Secondary limits apply to both**: ≤ 100 concurrent requests, REST ≈ 900 points/min/endpoint, GraphQL 2,000 points/min; ≥1 s spacing between mutative requests. Source: same GraphQL rate-limit page; REST best-practices page below.

### 2.2 Conditional requests (ETag)

- "Making a conditional request **does not count against your primary rate limit if a 304 response is returned** and the request was made while correctly authorized with an `Authorization` header." Unauthenticated 304s *do* cost. Source: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- Same page advises: keep poll parameters stable (same filters/page size/sort) so responses stay cacheable; prefer narrow filtered queries over list-and-scan. **Note:** the current poller's `sort=updated&direction=desc` on pulls is the *unstable* order the docs warn about — reordered rows shift pages and defeat 304s on pages ≥ 2 **[inference]**. Page 1 ETags still hit when nothing changed.
- The poller's existing behavior (ETag everywhere, watermark short-circuit, `Retry-After`/`X-RateLimit-Reset` backoff, pause at `remaining < 500`) already follows this page's guidance.

### 2.3 Webhooks vs polling for a local app

- Docs recommendation is explicit: "**subscribe to webhook events instead of polling**… If you cannot use webhooks and you must poll, poll as efficiently as possible." Source: best-practices page above.
- Webhooks require a public delivery URL; local development uses a proxy (`smee.io`, `gh webhook --forward`). `smee.io` is documented as **development-only, not for production**. Sources: https://docs.github.com/webhooks/using-webhooks/handling-webhook-deliveries ; https://github.com/probot/smee.io
- **Fit assessment [inference]:** a webhook path would need either a publicly reachable Console host (we are a local-first desktop/web app) or a dependency on a relay service per user — operationally heavier than conditional polling whose steady-state cost is ~0. Webhooks remain the right answer only if sub-minute push freshness becomes a requirement.

### 2.4 OAuth device flow (no browser on the client)

- GitHub's OAuth implementation supports the **Device Authorization Grant "for apps that don't have access to a web browser"** — i.e. CLI/headless flows: `POST /login/oauth/access_token` with `device_code`, user enters an 8-char `user_code` at `github.com/login/device` (15-min expiry, ≥5 s poll interval, 50 code-submissions/hour/app). Source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps (also confirms the same device flow issues **GitHub App user tokens** when the client_id belongs to a GitHub App — see §2.5).
- `cli/oauth` (the Go library behind `gh`) implements exactly this flow. Source: https://github.com/cli/oauth
- Token rotation: OAuth apps can opt into **8-hour expiring access tokens + 6-month refresh tokens** (`offline_access` scope for gradual rollout). Source: same authorizing-OAuth-apps page.

### 2.5 GitHub App user-to-server tokens

- A user token (`ghu_…`) carries **the intersection of the app's permissions and the user's own access** — it can never exceed what the user could do. Default **8-hour expiry** with refresh token (6-month refresh lifetime); expiry is optional-toggleable. Source: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub's own guidance on that page: "**Consider building a GitHub App instead of an OAuth app**" — fine-grained permissions, per-repo install scoping, short-lived tokens.
- Rate limit for user tokens follows the user bucket (5,000 pts/hr GraphQL; REST user bucket). Source: GraphQL rate-limit page (§2.1).
- No app registration is performed in this task (non-goal); this option is evaluated for the migration sequence only.

### 2.6 Fine-grained PAT

- Same endpoint↔permission matrix governs fine-grained PATs and GitHub Apps. Repository permission names that matter here: **Pull requests, Issues, Contents, Checks, Actions, Metadata** (Metadata read is mandatory/auto-included). Representative mappings verified on the matrix page: `PUT /repos/{o}/{r}/pulls/{n}/merge` → Pull-requests **write**; `POST /repos/{o}/{r}/actions/runs/{id}/rerun` → Actions **write**; `GET /repos/{o}/{r}/pulls/{n}` → read. Source: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- Classic PAT / OAuth scope equivalents verified on the scopes page: **`repo`** = full read+write on code, commit statuses, PRs/issues; **`workflow`** additionally required to touch Actions workflow files; **`read:org`** for org membership context. Source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps

### 2.7 `gh` CLI token reuse (current auth)

- `gh auth login` supports browser and device-code flows (`--insecure-storage` flag exists because the default is the OS credential store, not plaintext). Source: https://cli.github.com/manual/gh_auth_login
- The Console v1 `gh auth token` reuse therefore inherits the OS-keychain storage of `gh` for free — the cheapest secure-enough credential for a local single-user backend today **[inference]**. Caveat: the token's scopes are whatever `gh` was granted (typically `repo`, `read:org`, `gist`, `workflow` depending on prompts) — **not auditable by the backend**, so write actions must defensively handle 403/404 (GitHub returns 404 for out-of-scope private resources; source: best-practices page, "Do not ignore errors").

### 2.8 How comparable local-first tools authenticate (public docs only)

- **`gh` CLI**: OAuth device flow or browser web flow, token in OS credential store (`gh auth login` manual, §2.7). PR actions (`gh pr create/merge/review/comment`, `gh run rerun`) all ride the same user token.
- **GitHub Desktop**: opens the system browser for OAuth web-flow login; username+password auth is not supported. Source: https://docs.github.com/en/desktop/installing-and-authenticating-to-github-desktop/authenticating-to-github-in-github-desktop
- **Claude Code desktop**: **evidence gap** — no public documentation found describing a GitHub-login/PR-action auth path for a Claude Code desktop client as of the retrieval date. It is therefore cited here as a *product analogy only* (agentic tool performing PR actions with user-attributed credentials), not as an auth pattern to copy. Any claim about its token handling would be unsupported — deliberately omitted.

## 3. Options comparison

| Dimension | A. Keep proxy (status quo + on-demand reads) | B. Direct REST from xtrm-app host | C. GraphQL from backend (proxy keeps ownership) | D. Webhooks (+ relay) | E. GitHub login: OAuth device flow, `gh`-scoped token | F. GitHub App user-to-server tokens |
|---|---|---|---|---|---|---|
| Freshness | Lists 5 min stale; on-demand PR detail fresh (60 s TTL open) | Same as A minus one hop (~ms) | Same as A; fewer round trips per view | Push, seconds | Same as A/C; identity becomes per-user | Same; + revocation webhook |
| Rate-limit cost/view | ~18–20 GETs per fresh PR view | Same | ~5–10 pts per rich PR query vs ~20 REST reqs | ~0 poll; pay per delivery + relay | Same as underlying API choice | Same as C |
| Impl. complexity | Low: add 2–3 passthrough endpoints (checks, mergeability, diff) with TTL | Medium: duplicate token/cache/rate-limit logic in xtrm-app; two GitHub owners | Medium: one query replaces 6-section fan-out; needs query design + cursor paging | High: public URL/relay per user, delivery verification, fallback poller anyway | Low–Medium: device-flow polling UI + OS-keychain storage; no registration needed if reusing `gh` scopes **[inference]** | High: app registration, install flow, 8-h refresh handling, per-repo installs |
| Security / storage | Single shared token (`GITHUB_TOKEN`/`gh`); unattributable writes | Token moves closer to UI; same storage problem | Same as A | Webhook secret per endpoint + relay trust | Per-user token in OS keychain; 8-h expiry + refresh available | Least privilege (fine-grained perms, per-repo installs); short-lived by default |
| Multi-repo / Tauri fit | Backend owns fan-out; Tauri just calls backend | Each client re-implements fan-out; bad for N repos and desktop | Best fit: backend batches N repos into few queries; Tauri unchanged | Relay must reach every desktop; poor offline fit | Works for CLI today; Tauri needs embedded browser/device-code UX | Best long-term desktop fit (per-install scoping), highest upfront cost |
| Write actions | Possible but unattributed + scope-unknown (handle 403/404) | Same, plus token handling in two places | Same as A | N/A (delivery only) | Attributed per user; scopes = granted set | Attributed + least-privilege; per-action perms auditable |

GraphQL-vs-REST for the *polling* path specifically: conditional-304 polling already costs ~0, so GraphQL's win is on **rich views** (one query vs 18–20 GETs), not on the poller. Do not rewrite the poller in GraphQL.

## 4. Recommendation

**Recommended path: A → E → C, with F as the later desktop-hardening step. The Console v1 backend stays the GitHub owner throughout.**

1. **Now (no auth changes): proxy + on-demand reads.** Keep the poller as the list/activity owner (its ETag+watermark design is already near-optimal per §2.2). Add backend passthrough endpoints for the three missing rich-view reads — check runs/statuses, single-PR `mergeable`/`mergeable_state`, and diff/files — reusing the existing 60 s/10 min TTL cache shape in `route-runtime.ts`. Fix the `sort=updated` page-≥2 cache churn (§2.2) opportunistically by keeping `since=`+watermark pagination as-is (already correct) and not widening page counts.
2. **Next: GitHub login via OAuth device flow (option E), still behind the backend.** Implement the device-code UX in xtrm-app, store the resulting user token in the OS keychain on the host (same posture as `gh` today, §2.7), and forward it per-request to the backend — never persist it in SQLite or logs. Keep `GITHUB_TOKEN`/`gh auth token` as the zero-setup fallback. This unlocks *attributed* write actions with no app registration.
3. **Then: GraphQL for rich views (option C), backend-owned.** Replace the 6-section REST fan-out with one PR query (reviews, comments, commits, files, check runs, mergeability) once login gives per-user quota attribution. Leave list polling on REST+ETag.
4. **Later (Tauri/multi-user): GitHub App (option F).** Register only when per-repo least-privilege installs or centralized revocation justify the 8-hour-refresh machinery. Explicitly **not** webhooks (option D) until sub-minute push freshness is a stated requirement — relay-per-desktop cost exceeds the benefit while 304 polling costs ~0.

### Rate-limit budget at the proposed cadence (validates the recommendation)

Assumptions: 5-min list cadence (unchanged), rich PR view = 20 REST GETs today / ~8 GraphQL pts after step 3, 20 PR views/hour (heavy single user).

| Tracked repos N | List polling (steady, all-304) | Lists worst-case (all dirty) | 20 PR views/hr (REST → GraphQL) | Total worst-case vs 5,000/hr |
|---|---|---|---|---|
| 10 | ~0 | 360 | 400 → ~160 pts | **760/hr (15%) → ~520 (10%)** |
| 50 | ~0 | 1,800 | 400 → ~160 pts | **2,200/hr (44%) → ~1,960 (39%)** |

Headroom holds to N≈100 repos before worst-case all-dirty polling approaches the primary limit — and steady state stays ~0 at any N. Secondary limits are covered by the existing concurrency cap (4) and serial workers; the GraphQL step must additionally cap query cost per view (avoid `first: 100` fan-outs per §2.1).

## 5. Minimum scopes / permissions per planned action

| Planned action | OAuth classic scope (option E, `gh`-style token) | Fine-grained PAT / GitHub App permission (options E–F) |
|---|---|---|
| Read PRs, issues, content, releases | `repo` (or `public_repo` for public-only) | Metadata (auto) + Contents: read, Pull requests: read, Issues: read |
| Read checks / commit statuses | `repo` (commit statuses included); `repo:status` alone suffices for statuses-only | Checks: read (+ Commit statuses: read for the legacy statuses API) |
| Read Actions runs (CI state) | `repo` | Actions: read |
| Create PR | `repo` | Pull requests: write (+ Contents: read to read base/head refs) |
| Merge PR | `repo` | Pull requests: write |
| Review / approve / request changes | `repo` | Pull requests: write |
| Comment (issue/PR/review thread) | `repo` | Issues: write and/or Pull requests: write (thread type dependent) |
| Re-run checks (`rerun` a run) | `repo` | Actions: write |
| Touch workflow files (any of the above when a diff includes `.github/workflows/`) | additionally `workflow` | additionally Workflows: write |
| Org context (list org repos/teams) | additionally `read:org` | Organization members: read / per-endpoint org perms |

Scope-verification sources: scopes page (§2.6) for `repo`/`workflow`/`read:org`; PAT-permission matrix (§2.6) for the fine-grained names and the merge/rerun endpoint mappings. Thread-type-dependent comment permission is **[inference]** from the matrix structure — verify against the specific endpoint docs at implementation time.

## 6. Migration sequence (backend stays the owner)

1. Add `GET /api/github/repos/{o}/{r}/pulls/{n}/checks`, `…/mergeability` (or extend PR-detail payload), `…/diff` passthroughs with the existing TTL cache; surface in Console v2 PR routes. No auth change.
2. Device-flow login: `POST /api/github/auth/device/start` (backend holds `client_id`, returns `user_code`+`verification_uri`), xtrm-app renders the code UX, backend polls `…/oauth/access_token` at ≥5 s intervals, stores token in host OS keychain; all GitHub calls take an optional per-request user token, defaulting to the shared token.
3. Gate write actions (create/merge/review/comment/rerun) on a present user token; map 403/404 to "insufficient scope" UI; log scope-check failures without logging tokens.
4. GraphQL rich-view query behind the same endpoints (REST fallback while rolling out); keep REST+ETag poller untouched.
5. (Deferred) Register a GitHub App when Tauri distribution or least-privilege installs demand it; reuse the device flow against the App `client_id` to mint `ghu_…` tokens (§2.4/§2.5) and add refresh-on-8h-expiry.

---
*Hermes-licensed/closed products were not used as sources. No secrets appear in this report. Open contradictions: none material — docs agree that conditional polling is ~free and webhooks are preferred only when push freshness justifies delivery infrastructure. Evidence gap: Claude Code desktop auth internals (§2.8).*
