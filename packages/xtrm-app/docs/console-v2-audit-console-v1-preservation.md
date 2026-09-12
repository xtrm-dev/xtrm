# Console v1 → Console v2 preservation matrix — shell, repository, GitHub

> **Console v2 / ISSUE-140 audit artifact.** Read-only source inspection at a pinned revision.
> Audited source: `Jaggerxtrm/console` @ `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d` (clean worktree `/home/dawid/dev/console-wt/audit-main`)
> Every load-bearing claim carries a `path:line` reference and is tagged `VERIFIED` (read in source), `INFERENCE` (derived from cited facts), or `UNKNOWN`.
> Path convention: bare `types/...`, `stores/...`, `hooks/...`, `components/...` references resolve under `apps/console/src/` unless the path already starts with `packages/`, `apps/`, or `apps/console/src/`.
> Consumed by `adoption-audit.md`, `console-v2-migration-plan.md`, and `xtrm-gui-prd.md`.

---

**Audited SHA:** `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d` (VERIFIED via `git rev-parse HEAD`)
**Commit:** `chore(beads): run workspace in Dolt server mode`, 2026-09-12 04:10:49 +0200
**Worktree:** `/home/dawid/dev/console-wt/audit-main` (clean detached, origin/main)
**Audit date:** 2026-09-12
**Scope:** shell architecture, route/state architecture, repository discovery/selection/ordering, GitHub adapters/hooks/stores/routes/caches, GitHub surfaces (Activity, PRs, GitHub Issues, Releases, README, changelog, reports), client/server caching, server host routes, and the tests that pin this behavior.

**Out of scope (companion audit):** Beads materializer (`packages/core/src/materializer`, `packages/core/src/state/beads-*`), drawer/right-sidebar bead inspector (`pages/console/BeadSideDrawer.tsx`, `components/specialists/BeadActivityPane.tsx`), Program (Graph), Observability, Specialists, Graph. These are referenced by path and marked **covered by companion audit**; do not re-dispose them here.

**Disposition legend (exact):** `PRESERVE_AS_IS` | `EXTRACT_REUSE` | `ADAPT` | `REPLACE` | `DELETE_AFTER_CUTOVER`.
**Evidence tags:** `VERIFIED` = source read; `INFERENCE` = reasoned from source read; `UNKNOWN` = not determinable from this repo.

> Matrix column note: Console v2 (`xtrm-dev/xtrm`, `packages/xtrm-app`) was **not** in scope of this worktree. Target-surface entries are proposed labels (`INFERENCE`); exact v2 file paths are `UNKNOWN`.

---

## 2. Shell / route / state architecture summary

1. **Entry + boot.** `apps/console/src/dashboard/main.tsx:9` mounts `App` into `#root` under `StrictMode`. Static assets are served by the Bun host at `/console/*` (`apps/console/src/server/host.ts:93`, `:95`); Vite `base` is `/console/` (`apps/console/vite.config.ts:9`). — VERIFIED
2. **Dual shell/route model in one component.** `App` branches on `window.location.pathname`: `/legacy` and `/design-preview` render the **legacy** `DashboardShell` (`App.tsx:41`, `:42`); everything else renders the **IDE** `ShellApp` (`App.tsx:43`, `:46`). Two shells for the same product ship simultaneously. — VERIFIED
3. **IDE shell layout.** `ShellApp` = `TopBar` + `Sidebar` + `MainPane` + `RightSidebar` + `BeadSideDrawer` (`App.tsx:51-61`). Global data bootstrap happens here: `useGithubActivity({ includeLists: false })` (`:49`) and `useRepoTree()` (`:50`). — VERIFIED
4. **Legacy shell.** `DashboardShell` (`App.tsx:64`) renders a tab bar `[github|console|settings]` (`TABS`, `:20`) and `GithubPanel` for the github tab (`:137`). `DesignPreview` (`:184`) iframes raw HTML mocks `design-mocks/post-roadmap-console.html` and `operations-query-lab.html` imported as `?raw` (`:14-15`). — VERIFIED
5. **Route registration is string matching, not a router.** `routeTab(path)` (`App.tsx:235-248`) maps `/console/graph`, `/console/specialists`, `/console/observability`, `/console/programme`, `/beads/*` etc. to `TabId`. The `useEffect` in `App` (`:29-40`) syncs store surface/tab from the path but **only for `/console*`**; the GitHub surface has no URL route. — VERIFIED
6. **Shell store is the source of truth.** `useShellStore` (zustand) holds `repos`, `selection {surface, tab, repo}`, sidebar/drawer/theme/terminal state (`stores/shell.ts:67-98`, created `:100`). Selection + sidebar/drawer/theme persist to `localStorage` under `forge-*` keys (`:18-28`). — VERIFIED
7. **Surface/tab switch mutates state and pushes a URL.** `setSurface` resets the tab and repoints the repo to a repo that supports the surface (`shell.ts:116-128`); `setTab` calls `syncConsolePath` (`shell.ts:243-247`) which `history.pushState`s `/console/<tab>` only for the `console` surface. — VERIFIED
8. **Types are the shell contract.** `types/shell.ts:5` `Surface`, `:10` `GithubTab`, `:24` `GITHUB_TABS`, `:34` `BEADS_TABS`, `:40` `CONSOLE_TABS`, `:52` `DEFAULT_TAB`, `:77` `RepoNode`, `:92` `SidebarSelection`. GitHub tab set is exactly `activity|prs|issues|releases|readme|changelog|reports`. — VERIFIED
9. **MainPane is a surface/tab switchboard.** `MainPane` (`components/shell/MainPane.tsx:23`) picks by `selection.surface`/`selection.tab` (`:56-86`); the GitHub branch requires `repo.hasGithub` (`:57`), else `NoSide` (`:316`). Console/beads tabs route to `BeadsRepoView`, `Graph`, `Programme`, `Observability`, `Specialists`, `Operations`, `Explore` (companion-audit surfaces). — VERIFIED
10. **RepoNode aggregation is the shell's repo model.** `useRepoTree` (`hooks/useRepoTree.ts:67`) merges `apiClient.getRepos()` + `getRepoStats()` + `substrateApi.listProjects()`/stats/connection (`:75-91`) into `RepoNode[]`, including beads-only orphans (`:130-148`); it re-runs every 10 s (`REFRESH_MS`, `:12`, interval `:157`). Beads↔repo matching by name tail/normalization (`normalizeProjectKey`, `findBeadsSide`, `:29-43`). — VERIFIED
11. **Sidebar is the repo selector.** `Sidebar` (`components/shell/Sidebar.tsx:34`) filters `repos` by surface (`:43`), sorts by `lastActivityAt` desc with nulls last (`byRecencyDesc`, `:22-28`), and renders per-repo stat chips from `RepoNode.githubStats`/`beadsStats` (`:106-155`). Grouping is stubbed: `groupRepos` returns a single `"Ungrouped"` bucket (`:30-32`). — VERIFIED
12. **TopBar owns surface + tab + theme.** `TopBar` (`components/shell/TopBar.tsx:19`) renders surface switch (`:32-47`) and the per-surface tab strip (`GITHUB_TABS` vs `CONSOLE_TABS`, `:28`). — VERIFIED
13. **GitHub data path (IDE shell).** `MainPane.useGithubRepoData` (`MainPane.tsx:199`) holds a **module-singleton** `Map<string, GithubRepoData>` cache (`githubRepoCache`, `:109`) and lazy-loads one tab at a time (`events`/`prs`/`issues`/`releases`, `:253-272`), merged with live rows from `useGithubStore` (`:200-218`). Readme/changelog/reports are fetched by `RepoContentPanels` directly. — VERIFIED
14. **GitHub realtime path.** `useGithubActivity` (`hooks/useGithubActivity.ts:8`) loads core data with one `Promise.all` (`:36-47`); optional `includeLists` fans out `getPrs` + `getIssues` + N×`getReleases` (`:49-64`). It subscribes to WS channel `github:activity` via `useWebSocket` (`:107`) and applies `github:event.append`, `github:pr.upsert`, `github:issue.upsert`, `github:release.upsert`, `github:sync_hint` (`:78-105`). — VERIFIED
15. **WS transport.** `lib/ws.ts` `WsClient` (`:33`) is a ref-counted, reconnect-with-backoff, `resume`+`seq`-gap-aware client over `/ws` (`buildWsUrl`, `:181`); a single shared client is created by `hooks/useWebSocket.ts:7-13`. Server side is `createConsoleRealtime` (`server/ws/realtime.ts:19`) wrapping `RealtimeChannelRegistry`. — VERIFIED
16. **Server route registration.** `createConsoleApiRouter` (`server/routes/index.ts:74`) mounts all routers; the GitHub router is mounted **only when a DB exists** (`:126`, `if (options.db)`). Ownership prefixes are enumerated in `CONSOLE_API_ROUTE_PREFIXES` (`:61-72`), including `/api/github`. — VERIFIED
17. **GitHub background runtime.** `apps/console/src/server/index.ts:25` constructs `createGithubRuntime` and starts it in `startBackground` (`:53-56`) beside the console materializer runtime. `createGithubRuntime` (`server/github/runtime.ts:38`) gates on `SKIP_GITHUB_POLLER` (`:53`), discovers repos (`:63`, `discoverAndInsert`), constructs the poller (`:65`), optional startup backfill (`:70`), then `poller.start(username)` (`:75`). — VERIFIED
18. **HTTP host contract.** `buildApp` (`server/host.ts:80`) serves `/health` (`:83`), redirects `/`→`/console` (`:85`) and `/gitboard*`→`/console` 308 (`:90-91`), serves SPA at `/console` and `/console/*` with long-cache only for `assets/` (`:93-110`), then mounts API routes (`:112`). — VERIFIED

---

## 3. Repository / GitHub capability matrix

| capability | current owner path:line | backend/data source | current quality/defects | disposition | target Console v2 surface |
|---|---|---|---|---|---|
| Repository discovery (GitHub) | `packages/core/src/github/discover.ts:94` `discoverAndInsert`; `:16` `discoverViaGhCli`; `:42` `discoverViaApi`; wired `server/github/runtime.ts:63` | `gh repo list --json nameWithOwner,isPrivate,pushedAt` then REST `/user/repos?sort=pushed` fallback; token via `github/token.ts:1` | Working. `gh`-first is fast but shells out; `filterRepos` (`:80`) drops `pushed_at=null` and defaults `maxAgeDays=180`; private filtered by default-allow. No incremental/soft-delete of vanished repos. — VERIFIED | `EXTRACT_REUSE` | xtrm-app repo registry provisioning (`INFERENCE`) |
| Repository discovery (on-disk projects) | `packages/core/src/runtime/project-scanner.ts:18` `ProjectScanner` | Filesystem scan for `.beads/` up to depth 3, excludes `node_modules/.git/dist/build` (`:12-16`, `:67-84`) | **Not GitHub repo discovery.** This is the Beads project scanner; produces `BeadsProject[]` for the substrate (companion audit). Do not conflate with GitHub discovery. — VERIFIED | `EXTRACT_REUSE` (beads half: companion audit) | n/a — companion audit |
| Repository selection | `components/shell/Sidebar.tsx:34`; `stores/shell.ts:138` `setRepo`; `MainPane.tsx:41-47` | `useShellStore.selection.repo` (persisted) + `RepoNode[]` from `useRepoTree` | Selection is a bare `fullName` string; `MainPane` keeps a one-entry `lastSelectedRepoRef` cache (`:28`, `:42-47`) so the pane does not flash empty while `useRepoTree` re-fetches. No URL route for the GitHub surface (`App.tsx:29-40` only routes `/console*`), so deep links to a repo are impossible. — VERIFIED | `REPLACE` (shell state) + `EXTRACT_REUSE` (selection semantics) | xtrm-app shell route/param state (`INFERENCE`) |
| Repository ordering by activity | `components/shell/Sidebar.tsx:22` `byRecencyDesc` (IDE shell); `components/github/RepoSidebar.tsx:25` `sortByLastEvent` (legacy shell) | `RepoNode.lastActivityAt` = max(GitHub `RepoStat.last_event_at`, beads `stats.last_activity_at`) computed `useRepoTree.ts:118`, from `store.ts:420` `MAX(created_at)` excluding `Watch/Fork/MemberEvent` | Two independent sort implementations for the same concept. `last_event_at` excludes social events but is event-stream bound (`github_events`), so a repo with only PR/release activity outside the polled window can rank stale. — VERIFIED (two impls, query) / INFERENCE (staleness) | `EXTRACT_REUSE` (the query) + `REPLACE` (duplicate sort UI) | xtrm-app activity-ordered repo list (`INFERENCE`) |
| Sidebar grouping | `RepoSidebar.tsx:84-89` (legacy, by `group_name`); `Sidebar.tsx:30` (IDE, hardcoded `"Ungrouped"`) | `github_repos.group_name` column (`database.ts:134`) | Data model supports groups; IDE shell ignores it and renders a single bucket. `RepoNode.groupName` is carried but unused in the IDE shell (`types/shell.ts:80`). — VERIFIED | `ADAPT` | xtrm-app repo list grouping (`INFERENCE`) |
| PR counts / activity | definition `packages/core/src/github/store.ts:411` `getRepoStats` (`:416-417`); route `server/routes/github.ts:85`; list `store.ts:561` `getPrs`, route `:150`; poll `poller.ts:490` `pollPullRequests` | `github_prs` table (`database.ts:141`) + 24 h `PullRequestEvent` aggregation | **Defect: counts are not open-PR counts.** `prs_open` = `PullRequestEvent` with `action='opened'` in the last 24 h (`store.ts:416`); `prs_closed` = closed/merged last 24 h. `GithubChips.openPRs` (`types/shell.ts:58`) and `RepoNode.githubStats.openPRs` (`useRepoTree.ts:108`) misname that as "open". Sidebar tooltips are honest ("opened today", `Sidebar.tsx:127`), the field name is not. No true open-PR total anywhere. `getPrs` sorts by `updated_at DESC` only. — VERIFIED | `ADAPT` (fix semantics + naming) | xtrm-app PR surface with real open-count (`INFERENCE`) |
| PR detail (reviews/files/timeline) | `packages/core/src/github/route-runtime.ts:91` `getPrDetailPayload`; sections `:182` `fetchPrDetailSections`; route `server/routes/github.ts:176`; UI `components/github/PrTimeline.tsx:248` `PrExpandedBody`, fetch `:262` | GitHub REST: `issues/:n/comments`, `pulls/:n/reviews`, `pulls/:n/comments`, `pulls/:n/commits`, `pulls/:n/files`, `issues/:n/timeline` (`route-runtime.ts:184-189`) | Strong design: `Promise.allSettled` + per-section `AbortController` timeout (`GITHUB_PR_DETAIL_SECTION_TIMEOUT_MS`, default 2500 ms, `:164-180`), partial payload with per-section `errors` map (`:193-214`), cached only when error-free (`:121-124`). Cache key includes `updated_at` (`:144`), TTL 60 s open / 10 min closed (`:31-32`). — VERIFIED | `EXTRACT_REUSE` | xtrm-app PR detail (server fetcher reused) (`INFERENCE`) |
| Commits / activity feed | ingest `poller.ts:672` `ingestEvents`, `:173` `transformCommits`, compare enrichment `:327` `fetchCompare`; store `store.ts:129` `insertCommit`, `:271` `getCommits`; route `server/routes/github.ts:69`; UI `components/github/ActivityTimeline.tsx:16` `commitBodyLines` | `github_events` + `github_commits` (`database.ts:91`, `:113`); `PushEvent` payload + GitHub Compare API | Activity is event-stream based and bounded: `pollUser` reads `/users/:u/events?per_page=100` (`poller.ts:800`) and backfill is configurable pages (`:216`, default 3) — the user-events endpoint only exposes ~300 events / ~90 days, so older activity is unrecoverable. **Write-on-read defect:** `GET /api/github/commits` calls `enrichCommitMessages` (N network commits) inline in the request handler (`routes/github.ts:69-83`, `store.ts:426`). — VERIFIED | `EXTRACT_REUSE` (ingest) + `ADAPT` (enrichment off the read path) | xtrm-app activity surface (`INFERENCE`) |
| GitHub Issues (NOT XTRM issues) | poll `poller.ts:435` `pollIssues`; store `store.ts:626` `upsertIssue`, `:650` `getIssues`; route `server/routes/github.ts:197`; UI `components/github/IssueTimeline.tsx` | `github_issues` (`database.ts:164`) from `/repos/:r/issues?state=all&since=<watermark>` | Poll path is correct: watermark on `updated_at`, ETag on page 1, skips rows with `pull_request` (the issues endpoint mixes PRs), max 20 pages (`:453-487`). **Naming collision:** the GitHub tab label is `"Issues"` (`types/shell.ts:27`) and the XTRM/console feed tab label is **also** `"Issues"` (`types/shell.ts:35`, `:41`). Both render in the same TopBar. Must be disambiguated in v2. — VERIFIED | `EXTRACT_REUSE` (poller/store) | xtrm-app "GitHub Issues" surface, explicitly distinct from XTRM issues (`INFERENCE`) |
| Releases | poll `poller.ts:548` `pollReleases`; store `store.ts:685` `upsertRelease`, `:710` `getReleases`; route `server/routes/github.ts:163`; UI `components/github/ReleaseTimeline.tsx` | `github_releases` (`database.ts:196`) from `/repos/:r/releases` | Corrected path: dedicated table + per-repo watermark/ETag, drafts (`published_at=null`) skipped (`:580`), max 5 pages. Comment at `store.ts:710-714` documents the fix for the old event-window bug. `created_at` is mirrored from `published_at` and flagged as a known simplification (`store.ts:706`). — VERIFIED | `EXTRACT_REUSE` | xtrm-app releases surface (`INFERENCE`) |
| README / changelog | `packages/core/src/github/readme.ts:62` `fetchRepoFile`; `:97` `listRepoDir`; `route-runtime.ts:62` `isAllowedMarkdownPath`, `:75` `getMarkdownFile`; route `server/routes/github.ts:216`; UI `RepoContentPanels.tsx:15` `ReadmeView`, `:19` `ChangelogView`, `:23` `MarkdownView` | GitHub Contents API v3, base64-decoded; **allowlist is exactly `README.md` + `CHANGELOG.md`** (`route-runtime.ts:62-64`) | Solid: 10 min TTL cache, 200-entry prune, 2 s timeout (`readme.ts:17-19`, `:35-55`), repo-existence check **before** outbound fetch (`isKnownGithubRepo`, `route-runtime.ts:70`; route `github.ts:221`). TOCTOU auth is by `github_repos` membership. — VERIFIED | `EXTRACT_REUSE` | xtrm-app repo docs panel (`INFERENCE`) |
| Changelog | same as README; `RepoContentPanels.tsx:19` | `CHANGELOG.md` via Contents API | No parsed changelog model (no entry/version extraction); raw markdown only. `RepoDossier` (`RepoDossier.tsx:20`) has a changelog tab but is **unreferenced** (see §5). — VERIFIED | `ADAPT` | xtrm-app changelog surface (`INFERENCE`) |
| Reports | `route-runtime.ts:83` `getReportSummaries`, `:79` `getReportFile`; route `server/routes/github.ts:230`, `:241`; UI `RepoContentPanels.tsx:49` `ReportsView`, `:116` `ReportMeta` | `.xtrm/reports/*.md` via Contents API dir listing + file fetch | **Defect:** `getReportSummaries` hardcodes `frontmatter: null` (`route-runtime.ts:88`) while `ReportMeta` renders `session_date/branch/commits/issues_closed/...` from frontmatter (`RepoContentPanels.tsx:116-135`); `parseFrontmatter` exists (`readme.ts:128`) but is never called on this path. Report metadata therefore never displays. Filename allowlist is `/^[\w.-]+\.md$/` (`route-runtime.ts:66`). — VERIFIED | `ADAPT` (wire frontmatter) | xtrm-app reports surface (`INFERENCE`) |
| API / client caching | client `lib/client.ts:17` `ApiClient` (no cache, no dedupe); IDE repo cache `MainPane.tsx:109` `githubRepoCache`; zustand `stores/github.ts:60`; server PR-detail `route-runtime.ts:34` `prDetailCache`; server file/dir `readme.ts:20-21` | `fetch` + per-process `Map`s | **Three overlapping caches** for the same GitHub data (module singleton + zustand store + server maps) with different eviction rules; no request dedupe, no SWR/query library, no ETag-aware client cache. `useGithubActivity` has no interval; `useRepoTree` polls every 10 s. Cache correctness is guarded by defensive merge (`MainPane.tsx:133-197`) and empty-response guards (`stores/github.ts:131`, `:139`, `:147`). — VERIFIED | `ADAPT` | single xtrm-app query layer (`INFERENCE`) |
| Shell state | `stores/shell.ts:67-98` `ShellState`, `:100` `useShellStore`; selectors `:236-241` | zustand + `localStorage` (`forge-*` keys, `:18-28`) | Carries github tab state, repo list, drawer/sidebar/terminal/theme. Contains **terminal output buffer** (`terminalOutput`, sliced to 2000, `:230`) and **beads inspector target** (`sidebar.beadId/jobId`, `:76`) — mixing unrelated domains in one store. Persisted keys use stale `forge-*` naming. — VERIFIED | `REPLACE` | xtrm-app shell store, domain-split (`INFERENCE`) |
| Route registration | `App.tsx:235` `routeTab`, `:29-40` effect, `:41-43` legacy split; `server/routes/index.ts:61-72` prefixes, `:74` factory, `:126` github mount; `server/host.ts:85-110` static/`/console` | `window.location.pathname` string matching on the client; Hono `app.route` on the server | No client router library; GitHub surface is unaddressable. Legacy `/legacy` + `/design-preview` routes ship mock HTML into production (`App.tsx:14-15`, `:42`, `:184-211`). Server GitHub router silently absent when `db` is null (`routes/index.ts:126`). — VERIFIED | `REPLACE` (client routing) + `EXTRACT_REUSE` (server prefix contract) | xtrm-app router + route registry (`INFERENCE`) |
| Polling / realtime of GitHub data | poller loop `poller.ts:864` `start`, `:648` `pollRepos`, `:605` `isRepoDue`, `:409` `getRepoActiveWindow`; publish `poller.ts:416`/`:420`; client `useGithubActivity.ts:78-107`, `useRepoTree.ts:12/157`; server `server/ws/realtime.ts:19` | In-process `setInterval` (default 5 min, `poller.ts:215`); WS channel `github:activity` (`ports.ts:21`) | Adaptive per-repo window 1 min (active <1 h) → 10 min → 30 min (idle >24 h) (`:409-414`); repo concurrency clamp 1–8 (`:220`); rate-limit pause ladder (Retry-After → 403/429 → remaining<500 ⇒ 60 s pause, `:249-279`) publishes `github:source_health` (`:420`). Repo poll state (watermarks + ETags) is **persisted** and survives restart (`store.ts:341`, `:323`; test `github-poller.test.ts:43`). Weakness: in-process interval means no leader election beyond the writer lease; `useRepoTree` external 10 s poll is separate from and faster than the poller cadence. — VERIFIED | `EXTRACT_REUSE` (poller) + `ADAPT` (client subscription) | xtrm-app realtime client over existing channel contract (`INFERENCE`) |
| GitHub API client package | `packages/api-client/src/index.ts:5` `ApiClient`, `:25` `WsClient` | none — placeholder | **Stub.** Methods return `fetch` results; `WsClient.connect/subscribe/close` are empty bodies (`:28-38`). No package imports it in the audited paths; the live client is `apps/console/src/dashboard/lib/client.ts:156`. — VERIFIED | `DELETE_AFTER_CUTOVER` (stub) | none |
| GitHub write gate | `server/routes/github.ts:268` `isGithubWriteAllowed`; `routes/github.ts:103`, `:119`, `:129` | `isAllowedConsoleWriteRequest` (`packages/core/src/runtime/console-write-policy.ts`) with host/origin/token/trusted-peer checks | Consistent with `/api/sources` mutation gating (`routes/sources.ts:43`). Host header is rewritten from the socket peer, not trusted from the client (`server/host.ts:220-225`). — VERIFIED | `EXTRACT_REUSE` | xtrm-app write policy (`INFERENCE`) |
| GitHub source health | `poller.ts:420` `publishGithubSourceHealth`, `:249` `maybePauseForRateLimit`; event name `ports.ts:19` `github:source_health` | GitHub rate-limit headers | Publishes `fresh`/`degraded` with `rate_limit {remaining, limit, reset_at}` (`:889-895`). No client consumer found for `github:source_health` in `useGithubActivity` (only event/pr/issue/release/sync_hint are handled, `useGithubActivity.ts:78-105`). — VERIFIED | `ADAPT` (add consumer or drop) | xtrm-app source-health surface (`INFERENCE`) |

---

## 3b. Surface → endpoint map (verified)

| Console v1 surface | component | endpoint(s) | client call |
|---|---|---|---|
| GitHub / Activity | `ActivityTimeline` via `MainPane.tsx:306` | `GET /api/github/events?repos=<r>&limit=200` (`routes/github.ts:46`) | `client.ts:46` `getEvents` |
| GitHub / Pull Requests | `PrTimeline` via `MainPane.tsx:307` | `GET /api/github/prs?repo=<r>&limit=200` (`routes/github.ts:150`) | `client.ts:94` `getPrs` |
| PR expanded detail | `PrTimeline.tsx:248` `PrExpandedBody` | `GET /api/github/prs/:owner/:repo/:n/detail` (`routes/github.ts:176`) | `client.ts:108` `getPrDetail` |
| GitHub / Issues | `IssueTimeline` via `MainPane.tsx:308` | `GET /api/github/issues?repo=<r>&limit=200` (`routes/github.ts:197`) | `client.ts:112` `getIssues` |
| GitHub / Releases | `ReleaseTimeline` via `MainPane.tsx:309` | `GET /api/github/releases?repo=<r>&limit=50` (`routes/github.ts:163`) | `client.ts:122` `getReleases` |
| GitHub / README | `ReadmeView` `RepoContentPanels.tsx:15` | `GET /api/github/repo/:owner/:name/markdown?path=README.md` (`routes/github.ts:216`) | `client.ts:131` `getRepoMarkdown` |
| GitHub / Changelog | `ChangelogView` `RepoContentPanels.tsx:19` | same, `path=CHANGELOG.md` | `client.ts:131` |
| GitHub / Reports list | `ReportsView` `RepoContentPanels.tsx:49` | `GET /api/github/repo/:owner/:name/reports` (`routes/github.ts:230`) | `client.ts:135` `listRepoReports` |
| GitHub / Report body | `ReportsView` expanded row | `GET /api/github/repo/:owner/:name/reports/:filename` (`routes/github.ts:241`) | `client.ts:139` `getRepoReport` |
| Shell / repo list + chips | `Sidebar.tsx:34` | `GET /api/github/repos` (`:93`), `GET /api/github/repos/stats` (`:85`), beads `/api/substrate/*` | `client.ts:74` `getRepos`, `:147` `getRepoStats` |
| Legacy summary bar | `StatsHeader.tsx:16` | `GET /api/github/summary?period=today` (`:142`) | `client.ts:90` `getSummary` |
| Legacy activity shell load | `useGithubActivity.ts:36-47` | `/events`, `/repos`, `/contributions` (`:137`), `/summary`, `/repos/stats` | `client.ts:86` `getContributions` |

All rows `VERIFIED` in source.

---

## 4. Explicit "reuse as-is" list (proven adapters / fetchers / caches / readers)

All paths relative to repo root. Export names are the public symbols.

**GitHub ingestion + persistence (server-side, framework-agnostic).**
- `packages/core/src/github/poller.ts:199` `GithubPoller` (plus `:78` `transformEvent`, `:173` `transformCommits`). Reuse the whole class: ETag + watermark per endpoint (`:435`, `:490`, `:548`), adaptive due-window (`:605`), rate-limit pause (`:249`), persisted poll state (`:632`), concurrency clamp (`:648-659`). It depends only on a `bun:sqlite` `Database` and the `GithubActivityPublisher`/`GithubAdapterLogger` ports (decoupled by design). — VERIFIED
- `packages/core/src/github/store.ts` — all DAO functions: `insertEvent` `:101`, `insertCommit` `:129`, `upsertRepo` `:154`, `ensureRepo` `:177`, `updateRepo` `:185`, `getEvents` `:218`, `getEvent` `:265`, `getCommits` `:271`, `getCommit` `:301`, `getRepos` `:307`, `getRepoPollState` `:323`, `upsertRepoPollState` `:341`, `updateCommitFullMessage` `:374`, `updateEventEnrichment` `:388`, `getRepoStats` `:411`, `enrichCommitMessages` `:426`, `getContributions` `:450`, `getSummary` `:463`, `upsertPr` `:531`, `getPrs` `:561`, `getPr` `:586`, `upsertIssue` `:626`, `getIssues` `:650`, `getIssue` `:675`, `upsertRelease` `:685`, `getReleases` `:710`. — VERIFIED
- `packages/core/src/github/database.ts:211` `createDatabase` (+ `SCHEMA` `:17`, idempotent migrations `:214-234`). Owns `github_events`, `github_commits`, `github_repos`, `github_prs`, `github_issues`, `github_repo_poll_state`, `github_releases`. — VERIFIED
- `packages/core/src/github/discover.ts:16` `discoverViaGhCli`, `:42` `discoverViaApi`, `:80` `filterRepos`, `:94` `discoverAndInsert`. — VERIFIED
- `packages/core/src/github/token.ts:1` `getGithubToken`, `:8` `getAuthenticatedUsername`. — VERIFIED
- `packages/core/src/github/ports.ts:23` `GithubActivityPublisher`, `:27` `GithubAdapterLogger`, `:13` `GithubAdapterEventName`, `:21` `GithubAdapterChannelName`, `:41`/`:47` no-op defaults. This is the correct seam for v2 (the poller never imports Hono or React). — VERIFIED
- `packages/core/src/github/route-runtime.ts:91` `getPrDetailPayload` (with `:182` `fetchPrDetailSections`, `:216-255` mappers), `:36` `githubApi`, `:51` `githubApiPages`, `:62` `isAllowedMarkdownPath`, `:66` `isAllowedReportFilename`, `:70` `isKnownGithubRepo`, `:75` `getMarkdownFile`, `:79` `getReportFile`, `:83` `getReportSummaries`. — VERIFIED
- `packages/core/src/github/readme.ts:62` `fetchRepoFile`, `:97` `listRepoDir`, `:123` `clearReadmeCache`, `:128` `parseFrontmatter`. — VERIFIED
- `packages/core/src/github/index.ts:1-8` barrel — the single import surface used by the app (`server/routes/github.ts:5-30`). — VERIFIED

**Client transport + realtime.**
- `apps/console/src/dashboard/lib/ws.ts:33` `WsClient`, `:181` `buildWsUrl`, `:16` `UNSUBSCRIBE_GRACE_MS`; `hooks/useWebSocket.ts:15` `useWebSocket`, `:39` `_resetSharedClient`. Protocol-correct reconnect/resume/seq-gap handling; reuse unchanged. — VERIFIED
- `apps/console/src/dashboard/lib/client.ts:17` `ApiClient` / `:156` `apiClient` — the **endpoint contract** (paths, query params, response envelopes) is the spec to preserve even if the class is replaced (`:46` `getEvents`, `:74` `getRepos`, `:94` `getPrs`, `:104` `getPr`, `:108` `getPrDetail`, `:112` `getIssues`, `:122` `getReleases`, `:131` `getRepoMarkdown`, `:135` `listRepoReports`, `:139` `getRepoReport`, `:147` `getRepoStats`). — VERIFIED
- `apps/console/src/dashboard/lib/markdown.tsx` `renderPrBodyText` — used by PR bodies, README, changelog and reports (`RepoContentPanels.tsx:3`, `:43`). — VERIFIED

**Read/fetch helpers that encode real correctness work.**
- `apps/console/src/dashboard/hooks/useRepoTree.ts:29` `normalizeProjectKey`, `:33` `findBeadsSide`, `:45` `beadsSourceFromConnection`, `:19` `beadsChipsFromStats` — beads↔repo name matching and source-chip derivation (companion audit for the beads inputs, but the matcher itself is GitHub-side). — VERIFIED
- `apps/console/src/dashboard/lib/ws.ts` seq/resume semantics plus server `packages/core/src/runtime/realtime.ts` `RealtimeChannelRegistry` (referenced `server/ws/realtime.ts:4-5`). — VERIFIED

**Server host + route ownership contract.**
- `apps/console/src/server/routes/index.ts:53` `CONSOLE_PHASE2_ROUTE_PREFIXES`, `:61` `CONSOLE_API_ROUTE_PREFIXES`, `:74` `createConsoleApiRouter` — the enumerated namespace contract (pinned by `phase3-route-ownership.test.ts:12`). — VERIFIED
- `apps/console/src/server/host.ts:123` `createConsoleHost`, `:80` `buildApp`, `:21` `ConsoleHostHooks` — pure-construction host with injectable hooks. — VERIFIED

---

## 5. Explicit "replace" list (stale shell / page-specific UI architecture)

| path:line | what it is | why it must be replaced | note |
|---|---|---|---|
| `apps/console/src/dashboard/App.tsx:64` `DashboardShell`, `:20` `TABS`, `:148-233` (`SYSTEMS`, `TRACE_LINES`, `NODES`, `FEED`, `PanelTitle`, `MetricCard`) | Legacy second shell | A parallel shell competes with `ShellApp` and is reachable at `/legacy` (`:41`). `PanelTitle`/`MetricCard` and the `SYSTEMS`/`TRACE_LINES`/`NODES`/`FEED` consts are hardcoded fake data with **no renderer** (dead). — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/App.tsx:184` `DesignPreview`, `:14-15` raw imports | iframed design mocks shipped to prod | Loads `../../design-mocks/*.html?raw` into an `iframe srcDoc` at `/console/preview` and `/console/design-preview`. Build-time bloat + untrusted-adjacent HTML path. — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/App.tsx:235` `routeTab`, `:27-44` path branching | hand-rolled string router | Cannot address GitHub repos; duplicates tab knowledge that already lives in `types/shell.ts:24-55`. — VERIFIED | `REPLACE` |
| `apps/console/src/dashboard/components/github/GithubPanel.tsx:81` `GithubPanel` (+ `:18` `TabBar`, `:14` `SOCIAL_TYPES`) | Legacy GitHub page | A **second full GitHub UI** (repo rail + stats + tabbed timelines) duplicating `MainPane`'s GitHub branch. Owns its own tab state (`:85`) and its own tab bar (`:18-79`). Derives `ownerUsername` from the first event's actor (`:110`) and filters repos by that — wrong whenever the event stream mixes actors. — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/components/github/RepoSidebar.tsx:47` `RepoSidebar` (+ `:20` `filterOwnRepos`, `:25` `sortByLastEvent`, `:36` `relativeTime`) | Legacy repo rail | Only consumer is the legacy `GithubPanel` (`:152`). Re-implements repo sort/filter and a second resize/persist path (`localStorage["sidebar-width"]`, `:49-61`) that conflicts with `stores/shell.ts` sidebar width. `filterOwnRepos` (`:20`) and `ownRepos` owner-prefix filter (`:81`) mis-scope org repos. — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/components/github/RepoDossier.tsx:20` `RepoDossier` | repo readme/changelog/reports modal | **Unreferenced** anywhere in `src` or `tests` (grep-confirmed). Third presentation of readme/changelog/reports. — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/components/github/StatsHeader.tsx:16` `StatsHeader` | summary stat bar | Only used by legacy `GithubPanel` (`:165`). Renders `Summary` for `today` only. — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/stores/shell.ts:67` `ShellState` | monolithic shell store | Mixes GitHub shell state with terminal buffer (`:79`, `:229-233`) and beads inspector target (`:76`, `:185-212`), and persists under legacy `forge-*` keys (`:18-28`). — VERIFIED | `REPLACE` |
| `apps/console/src/dashboard/components/shell/MainPane.tsx:109` `githubRepoCache`, `:133-197` merge helpers, `:199` `useGithubRepoData` | page-local GitHub cache | Module-singleton `Map` outside React/zustand lifecycle; three parallel caches (see matrix). Correctness is hand-maintained via timestamp merges. — VERIFIED | `REPLACE` (move into one query layer) |
| `apps/console/src/dashboard/hooks/useGithubActivity.ts:49-64` release fan-out | per-repo `getReleases` fan-out | `Promise.all(repos.map(getReleases))` on mount when `includeLists`; O(repos) requests, no pagination guard. — VERIFIED | `ADAPT` / replace with a single release query |
| `packages/api-client/src/index.ts:5`/`:25` | placeholder `ApiClient`/`WsClient` | Empty implementations; nothing imports it in the audited app. — VERIFIED | `DELETE_AFTER_CUTOVER` |
| `apps/console/src/dashboard/lib/resource-migration.md` | migration note doc | Not code; verify before deleting. — VERIFIED (exists) | `UNKNOWN` (content not audited) |

---

## 6. Cutover hazards

1. **Deleting `GithubPanel` before `MainPane`'s GitHub branch is proven.** The legacy shell at `/legacy` (`App.tsx:41`) and the design-preview route are the only reason `GithubPanel`, `RepoSidebar`, `StatsHeader`, `EventDetail`, `RepoDossier` are bundled. `ia-restructure.test.tsx` and `GithubPanel.test.tsx` assert on `GithubPanel` current behavior. Removing it without removing/repointing those tests breaks the suite. — VERIFIED
2. **Deleting `githubRepoCache` before the replacement query layer exists.** Its whole purpose is instant tab-switch rendering; `MainPane.github-cache.test.tsx` pins seven behaviors including "shows cached rows immediately on tab switch" (`:156`) and "keeps cached PR rows when slow fetch resolves empty" (`:168`). A naive replacement that re-fetches on mount regresses these. — VERIFIED
3. **Dropping the `GithubActivityPublisher`/`GithubAdapterLogger` ports.** `server/github/runtime.ts:65-69` injects the Console realtime registry and the host logger; `github-runtime.test.ts:102` pins "passes the Console realtime publisher into the GitHub poller". Removing the ports couples the poller to the host. — VERIFIED
4. **Renaming/moving `prs_open`/`openPRs` without a contract migration.** The value is produced by SQL in `store.ts:411-424`, shaped into `RepoNode.githubStats` (`useRepoTree.ts:107-112`), and pinned by `github-store.test.ts` and `github.test.ts:53`. Changing the meaning to a true open count requires reseeding semantics, not just a rename. — VERIFIED
5. **Removing the server-side `prDetailCache`.** `github-detail-cache.test.ts:94` pins "caches complete PR detail responses by PR updated timestamp", and the route deliberately skips caching when any section errored (`route-runtime.ts:121-124`). Deleting it sends 6 GitHub API calls per PR expand and burns rate limit already managed by `poller.ts:249`. — VERIFIED
6. **Replacing `localStorage` shell persistence without a migration.** Persisted keys `forge-5w9:selection`, `forge-gud9:drawer*`, `forge-70el:sidebar*`, `forge-vk47:theme` (`stores/shell.ts:18-28`) hold `SidebarSelection` shaped by `types/shell.ts:92`. Old clients will rehydrate with unknown surfaces/tabs after cutover unless keys are migrated or versioned. Pinned by `stores/shell.test.ts`. — VERIFIED
7. **Deleting the `/gitboard` 308 redirect.** `server/host.ts:90-91` deliberately uses a fixed literal target (comment `:87-89`) to avoid an open redirect. Any external bookmark to `/gitboard` breaks if removed. Pinned indirectly by `server/console-host.test.ts` and `deployment-contract.test.ts`. — VERIFIED
8. **Removing `/api/github/*` prefixes from `CONSOLE_API_ROUTE_PREFIXES`.** `phase3-route-ownership.test.ts:12` asserts the array contains `/api/github`. Also `routes/index.ts:126` mounts the router only `if (options.db)`; v2 must preserve or explicitly change the DB-absent behavior (currently 404 for all `/api/github/*`). — VERIFIED
9. **Deleting `useRepoTree`'s 10 s interval while the poller keeps a 5 min loop.** The sidebar's `lastActivityAt`, stat chips and beads-source labels refresh on the 10 s client interval (`useRepoTree.ts:157`); the server poller's default `intervalMs` is 5 min (`poller.ts:215`) with adaptive per-repo gating (`:409`). Removing the client refresh makes the sidebar visibly stale up to 5+ minutes. — VERIFIED
10. **Renaming the WS channel or event names.** Channel `github:activity` and events `github:event.append|pr.upsert|issue.upsert|release.upsert|sync_hint` are declared in `ports.ts:13-21`, published in `poller.ts:786`, `:540`, `:482`, `:597`, `:101` (sync hint path), and consumed in `useGithubActivity.ts:80-102`. A one-sided rename silently stops live updates with no error. — VERIFIED
11. **Dropping `enrichCommitMessages` from `GET /commits` without a replacement.** The stored `message` is truncated for messages ≥70 chars with no newline (`isTruncated`, `store.ts:370`); `updateCommitFullMessage` (`:374`) and the `message_full` column (`database.ts:216`) exist only because the route enriches on read (`routes/github.ts:77`). Removing the call without a background enricher leaves permanently truncated commit messages. — VERIFIED
12. **Assuming `GithubChips.openIssues`/`openPRs` are real open counts in v2.** Any v2 surface that displays them as "open" will be wrong today; see hazard 4 and the matrix row. — VERIFIED

---

## 6b. Defect register (reproduction-ready)

| id | defect | evidence | impact |
|---|---|---|---|
| D1 | Report frontmatter never rendered | `route-runtime.ts:88` returns `frontmatter: null`; `RepoContentPanels.tsx:116-135` reads it | Reports list shows names only; `session_date/branch/commits/issues_closed` metadata is dead UI |
| D2 | `openPRs`/`openIssues` are 24 h event counts, not open counts | `store.ts:416-418`; types `types/shell.ts:57-62`; mapping `useRepoTree.ts:107-112` | Any v2 label reading "open" is factually wrong; no true open-PR/open-issue total exists anywhere |
| D3 | GitHub Issues and XTRM issues share the tab label `"Issues"` in one TopBar | `types/shell.ts:27` (GitHub) vs `:35`/`:41` (XTRM feed) | Operator cannot tell the two systems apart; wrong-system navigation risk |
| D4 | `GET /api/github/commits` performs outbound enrichment inside the request | `routes/github.ts:69-83` → `store.ts:426` | Read latency scales with truncated-message count; consumes GitHub rate budget the poller also depends on |
| D5 | Legacy `GithubPanel` derives `ownerUsername` from the first event's actor, then filters repos by that prefix | `GithubPanel.tsx:110`; `RepoSidebar.tsx:81`; `filterOwnRepos` `:20` | Org/other-actor repos are filtered out of the legacy rail; wrong actor ⇒ almost empty UI |
| D6 | Two competing repo sort implementations | `Sidebar.tsx:22` `byRecencyDesc` vs `RepoSidebar.tsx:25` `sortByLastEvent` | Ordering diverges between shells for the same data |
| D7 | `apps/console/src/dashboard/components/github/RepoDossier.tsx:20` unreferenced | grep over `apps/console/src` + `tests` returns only its own definition | Dead code shipped in the bundle; third readme/changelog/reports presentation |
| D8 | `/legacy` and `/design-preview` ship hardcoded mock data and raw design-mock HTML in production | `App.tsx:14-15`, `:41-42`, `:148-211` | Bundle bloat; `SYSTEMS`/`TRACE_LINES`/`NODES`/`FEED` are rendered nowhere |
| D9 | `packages/api-client` is an unused stub | `packages/api-client/src/index.ts:5`, `:25`; no importer found in audited paths | Dead package conveying a false "shared API client" impression |
| D10 | `github:source_health` is published but never consumed | published `poller.ts:420`/`:428`; handled events list `useGithubActivity.ts:80-102` excludes it | Rate-limit degradation is invisible in the UI |
| D11 | `/api/github/*` silently absent when `db` is null | `routes/index.ts:126` `if (options.db)` | In a DB-less deployment the whole GitHub surface 404s with no startup error |
| D12 | Three overlapping GitHub caches with different eviction | `MainPane.tsx:109`; `stores/github.ts:60`; `route-runtime.ts:34`; `readme.ts:20-21` | Cache invalidation is per-layer and cannot be reasoned about globally |

All rows `VERIFIED` in source.

---

## 7. Test / behavioral baseline

Run from repo root (`bun install` first). Console package: `cd apps/console && bun run test` (i.e. `bun run --filter @xtrm/console test` from root, `vitest run`). Core package: `bun run --filter @xtrm/core test`. There is **no top-level `bun test` for Bun's runner**; the project uses Vitest.

**Must keep passing — GitHub server/poller/discovery:**
- `apps/console/tests/server/github-poller.test.ts` — `GithubPoller` extends core, shared `transformEvent`/`transformCommits`, and **persisted ETags/freshness across poller instances** (`:43`).
- `apps/console/tests/server/github-discover.test.ts` — `discoverAndInsert` filters+persists; private-repo filter contract (`:35`).
- `apps/console/tests/server/github-runtime.test.ts` — start-once/stop-idempotent, startup backfill ordering, `SKIP_GITHUB_POLLER` gate, degraded-on-auth-failure with credential redaction, shutdown race, realtime publisher injection (`:102`).
- `apps/console/tests/server/routes/github.test.ts` — read methods/envelopes/pagination/404s, legacy publisher + structured logger, durable repo writes, update/soft-delete, hostile-origin/missing-proof/non-loopback rejection, markdown/report validation-before-network, PR detail caching.
- `apps/console/tests/server/routes/github-detail-cache.test.ts` — partial detail with section errors on timeout, cache-by-updated-timestamp, README allowlist, unknown-repo rejection before fetch, report listing without fetching bodies.
- `apps/console/tests/server/phase3-route-ownership.test.ts` — `CONSOLE_API_ROUTE_PREFIXES` contains `/api/github`.
- `packages/core/tests/github-poller.test.ts` and `packages/core/tests/github-store.test.ts` — core store/poller behavior.
- `packages/core/tests/github/*.retired-host-contract.test.ts` (`discover`, `poller`, `poller-loop`, `store`) — retired-host parity contracts.

**Must keep passing — client GitHub surfaces/state/caching:**
- `apps/console/tests/dashboard/components/shell/MainPane.github-cache.test.tsx` — per-tab lazy load, no cross-tab fetch, cached render on switch, stale-empty and rejected-fetch guards, releases warm switch, stale HTTP must not beat live data.
- `apps/console/tests/dashboard/components/github/GithubPanel.test.tsx`, `RepoSidebar.test.tsx`, `StatsHeader.test.tsx`, `ActivityTimeline.test.tsx`, `EventDetail.test.tsx`, `ReleaseTimeline.test.tsx` — legacy GitHub components (delete these tests **with** the components at cutover, not before).
- `apps/console/tests/dashboard/hooks/useGithubActivity.test.ts` — core load without list fan-out, WS upserts applied immediately, sync-hint refresh preserving visible rows, error-with-rows retention, `preserveVisibleState` semantics.
- `apps/console/tests/dashboard/hooks/useRepoTree.matching.test.ts` — repo↔beads name normalization/matching.
- `apps/console/tests/dashboard/stores/github.test.ts`, `github-upsert.test.ts` — store reducers incl. empty-response retention and upsert ordering.
- `apps/console/tests/dashboard/stores/shell.test.ts` — shell persistence, surface-repo coercion, drawer clamp.
- `apps/console/tests/dashboard/lib/client.test.ts` — API client URL/query shaping.
- `apps/console/tests/dashboard/hooks/useWebSocket.test.tsx`, `apps/console/tests/dashboard/lib/ws.test.ts` — WS client semantics.
- `apps/console/tests/dashboard/perf/dashboard-performance-budget.test.ts` — `DASHBOARD_SLOW_PATHS` includes `/api/github/prs`; realtime budget stricter than slow-log budget; fetch-count instrumentation for `/api/github/events`.
- `packages/core/tests/runtime-realtime.test.ts` — realtime channel registry.

**Smoke commands (host-level):** `apps/console/package.json` scripts `smoke:host`, `smoke:api-contract`, `smoke:lifecycle`, `smoke:realtime` (`bun run --filter @xtrm/console smoke:<name>`).

**Lint/typecheck:** `bun run --filter @xtrm/console lint` (tsc `--noEmit`).

**Companion-audit-owned tests (do not dispose here):** everything under `apps/console/tests/dashboard/components/beads/**`, `.../pages/console/**`, `.../components/specialists/**`, `.../server/programme/**`, `.../server/routes/specialists*`, `.../server/routes/observability*`, `.../server/routes/graph*`, `packages/core/tests/materializer*`, `packages/core/tests/observability*`.

---

## 8. Open questions

- `UNKNOWN` — Exact Console v2 target paths/surface names in `xtrm-dev/xtrm` `packages/xtrm-app`. Matrix "target surface" cells are proposed labels only.
- `UNKNOWN` — Whether v2 keeps the Bun/Hono host + `CONSOLE_API_ROUTE_PREFIXES` contract (`server/routes/index.ts:61`) or replaces the server tier; this decides whether `createConsoleApiRouter` is `EXTRACT_REUSE` or `REPLACE`.
- `UNKNOWN` — Whether v2 retains the `bun:sqlite` GitHub schema (`packages/core/src/github/database.ts:17`) or migrates to the Dolt/state DB. The poller DAO signature (`Database` from `bun:sqlite`) would need a port abstraction if so.
- `UNKNOWN` — Whether the realtime WS protocol (`lib/ws.ts` seq/resume/boot_id) is carried into v2 or replaced by a new transport. Channel/event names in `ports.ts:13-21` are the current contract.
- `UNKNOWN` — Whether legacy `/legacy` and `/design-preview` routes have external users. No telemetry reference found in this worktree.
- `UNKNOWN` — Intended semantics for `GithubChips.openPRs`/`openIssues` in v2: rename to `*Today`, or implement true open counts (requires new queries; `github_prs`/`github_issues` already store full state, so a count is feasible at `store.ts:561`/`:650`).
- `UNKNOWN` — Whether `github:source_health` (`ports.ts:19`) has any intended consumer; none exists client-side today.
- `UNKNOWN` — Content and status of `apps/console/src/dashboard/lib/resource-migration.md`.
- `UNKNOWN` — Whether `RepoContentPanels.ReportMeta` frontmatter rendering (`RepoContentPanels.tsx:116`) is intended to be wired to `parseFrontmatter` (`readme.ts:128`) or removed; today it is dead rendering.

---

## 9. Recommended cutover sequence (ordered to avoid §6 hazards)

1. **Land the v2 query layer first**, beside `githubRepoCache` and `useGithubActivity`. Do not delete either until `MainPane.github-cache.test.tsx` has an equivalent v2 test passing (hazard 2).
2. **Freeze the server contracts**: `CONSOLE_API_ROUTE_PREFIXES` (`routes/index.ts:61`), all `/api/github/*` response envelopes (`routes/github.ts`), WS channel/events (`ports.ts:13-21`), and the `bun:sqlite` GitHub schema (`database.ts:17`). These are the reuse surface; changing them is a separate, later decision (hazards 4, 5, 8, 10).
3. **Extract `packages/core/src/github` wholesale into v2** (poller + store + discover + readme + route-runtime + ports + token). Couple it only to the ports interfaces; the Console realtime registry adapts to `GithubActivityPublisher` (hazard 3).
4. **Build the v2 GitHub surfaces** (Activity, PRs, GitHub Issues, Releases, README, changelog, reports) on the reused core, and rename the GitHub-Issues surface so it cannot be confused with XTRM issues (D3).
5. **Wire `github:source_health` to a v2 source-health surface**, or stop publishing it (D10).
6. **Move commit enrichment off the read path** into the background poller before removing it from the route (hazard 11, D4).
7. **Only then** delete the replaced items (§5) and, in the same change, delete the tests that pinned them: `GithubPanel.test.tsx`, `RepoSidebar.test.tsx`, `StatsHeader.test.tsx`, `EventDetail.test.tsx` (hazard 1).
8. **Migrate or version the `forge-*` localStorage keys** in the same release that ships the v2 shell (hazard 6).
9. **Retain** `/gitboard` → `/console` 308 and `/console` SPA serving until an explicit decision records their retirement (hazard 7).
10. **Decide defects D1, D2, D7, D8, D9 explicitly** (fix / carry / delete). Do not carry them silently into v2.

---

## Appendix A — Primary sources inspected (shell + repository + GitHub)

Server: `apps/console/src/server/index.ts` (136), `host.ts` (225), `routes/index.ts` (190), `routes/github.ts` (285), `routes/sources.ts` (78), `routes/shell.ts` (22), `github/runtime.ts` (108), `github/discover.ts` (9), `github/poller.ts` (31), `ws/realtime.ts` (125).
Core: `packages/core/src/github/{poller(902),store(745),database(236),route-runtime(255),readme(139),discover(126),ports(51),token(19),index(9)}.ts`; `runtime/project-scanner.ts` (132); `state/read-models/sources.ts` (123).
Client: `dashboard/App.tsx` (248), `main.tsx` (13), `stores/{shell(247),github(154)}.ts`, `hooks/{useRepoTree(163),useGithubActivity(127),useWebSocket(42)}.ts`, `lib/{client(156),ws(187)}.ts`, `components/shell/{Sidebar(159),TopBar(135),MainPane(329),RightSidebar(84)}.tsx`, `components/github/{GithubPanel(250),RepoSidebar(281),RepoContentPanels(142),RepoDossier(104),StatsHeader(44),ActivityTimeline(446),PrTimeline(493),IssueTimeline(254),ReleaseTimeline(133)}.tsx`, `types/{shell(96),github(224)}.ts`.
Config/entry: `package.json`, `apps/console/package.json`, `apps/console/vite.config.ts`.
Tests: enumerated in §7 (full list from `find` over `apps/console/tests` and `packages/*/tests`).
