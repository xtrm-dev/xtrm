# ADR-002 — Repository Project surface: status board, Jira links, and the Program rename

> Status: PROPOSED — scoping, no product code yet. Defaults are recorded in §10 as assumptions; one
> operator reply amends a record instead of stalling a tranche.
> Date: 2026-11-17
> Deciders: operator; recorded by the `xtrm-xt-pi-poxc` coordinator
> Work: new Substrate issues, proposed in §11 (not yet created)
> Numbering: xtrm-app ADR series (`packages/xtrm-app/docs/adr/`), separate from `docs/runtime/adr/`
> Related: XTRM-753 (earlier, narrower "Artifacts surface" draft — superseded by this scope), XTRM-394 (Console v2 GitHub surfaces)
> Amends: PRD §9, §34.7, §34.9; shell architecture §9.1, §9.3, §10

## 1. Context

The operator runs a **status board** ("Tabellone") for the `mercury/market-data` repository. It is a
published here.now site plus a JSON document store on the same site:

- one page, `https://velvet-breeze-fbm8.here.now`, published once and never republished;
- 414 records under `workers/`, `schedule/`, `followups/`, `questions/`, `answers/`, `archive/`,
  `lanes/`, `status/`, `board/`, `proposals/`;
- three writers: a mechanical sync (`status-board-sync.service`, 5-minute user timer), an hourly
  keeper, and the question CLI. The published page is private (401 without a bearer).

The board works, but it is one long page, it does not use the xtrm-app visual language, it is bound
to one repository, and its data reaches a reader as an opaque artifact rather than as typed records.

The operator asked to scope — before implementing — bringing the board into the app:

- it must respect the app's visual language and design tokens, not the artifact's;
- it must not be one huge page: it must be structured **per repository**, under a `project/` tree;
- the existing **Program** endpoint must be renamed and rewritten as that tree, with its
  sub-endpoints decided;
- this is the app's first **Jira** integration, so Jira identity and links must be durable, in the
  shape the GitHub integration already has: resolve issue keys/links, open an issue in Jira;
- later, notifications may surface in `src/agent/Activity.tsx` and its neighbours;
- the operator questions on the board must resolve per repository;
- the board is mainly for `market-data` today, so the model must generalise to any repository;
- new visualisations (a timeline) are expected, and they must use the existing design system.

Reported fact, verified against the live host: `~/.xtrm/product/market-data/` is the board state
directory for that repository, and the per-project integration settings live in
`~/.config/xtrm/project-management.json` under `projects.<name>`
(`status_board_site`, `jira_site`, `status_board_state_dir`, `answers_inbox`, `bot_inbox`, …).

### What the app has today (verified in code)

- `src/app/destinations.ts` — `ModeId` includes `"program"`; the rail entry is already **labelled**
  "Project" but routed globally at `/program`; `REPO_SECTIONS` also lists a `project` entry pointing
  at `/program`. `modeHref` cannot express a repo-relative mode path (`path ?? repoHref(repo, "/work/issues")`).
- `src/app/router.tsx` — root `/program` and repo child `/governance/program` both render
  `src/surfaces/ProgramSurface.tsx`.
- `ProgramSurface.tsx` renders a cross-repository, read-only governance snapshot: workstreams,
  assignments, decisions, recent commits, freshness badge.
- `src/adapters/program/live.ts` reads Console v1's `/api/programme`. The route is not missing: it is
  **gated off by a Console v1 feature flag**. Verified 2026-11-17: `vite.config.ts:9` defaults the proxy
  target to `127.0.0.1:3030`, production overrides it with `XTRM_CONSOLE_URL` from
  `~/.config/xtrm/xtrm-console-v2.sh:20`, and Console v1 (`bun`, bound to the tailscale IP
  `100.113.49.52:3030`) answers `GET /api/programme` with `404 {"error":"programme_dashboard_disabled"}`
  from `apps/console/src/server/programme/route.ts:166-168`, because
  `apps/console/src/server/routes/index.ts:141` requires `MERCURY_PROGRAMME_DASHBOARD_ENABLED === "1"`
  and nothing sets it. The app also defaults the adapter to fixture
  (`src/adapters/index.tsx:38-39`, `pick("VITE_XTRM_PROGRAM", "fixture")`), which is the intended
  default, not a defect.
  Two consequences: the Program surface has no live consumer today, and any new integration that reads
  through this snapshot would bind new work to Console v1, the package the Console v2 migration is
  retiring. This ADR therefore reads Jira through an app-owned bridge and does not depend on the v1
  programme snapshot at all.
- There is **no Jira adapter, route, surface, credential, or reference kind** anywhere in `src/` or
  `server/`. The only Jira presence is the `Jira` field on the Inspector (`item.jiraRefs`), fed by
  the fixture Program items.
- There is no timeline component in `src/`.
- Design tokens are `src/styles.css` (`--x-deep/sidebar/surface/raised/control`, ink ladder, hairline
  borders, violet accent, `--x-shadow-float/panel`, Figtree + Geist Mono, dark via `[data-theme]`).
  Primitives are `src/ui/primitives.tsx` (`Surface`, `Row`, `StatusDot`, `ContentPanel`, `SurfaceToolbar`,
  `EmptyState`, `LoadingState`, `ErrorState`, `SourceBadge`, `IconButton`, `Tip`, `Kbd`).

### Durable Jira substrate already exists

Substrate already defines the provider and the sync model; the app should use it, not invent a
second mapping:

- `packages/substrate/src/projections/types.ts` — `PROVIDERS = ["github", "jira"]`,
  `BINDING_MODES = ["projection", "intake", "mirror_read"]`,
  `SYNC_STATES = ["in_sync", "pending", "drift", "uncertain"]`, and
  `ExternalBinding { issueId, provider, remoteScope, remoteId, remoteKey, url, mode, lastPushedRevision, lastSeenRemoteVersion, mappedContentHash, syncState }`.
- `packages/substrate/src/service/integration-service.ts` — idempotent inbound intake, outbox with
  retry/backoff, drift proposals instead of silent overwrites, `validateJiraIntake({ remoteId,
  remoteKey, summary, description })`, and the stated rule "external effects are recorded, never
  guessed".
- `packages/substrate/src/service/provenance-service.ts:817` — provenance already reads
  `external_bindings` as `{ provider, remote_scope, remote_id, url }`.
- Missing today: no `sb` verb binds a Jira key, and the bridge exposes no Jira read. Those are gaps to
  close, not reasons to build a parallel store.

### Constraints

- PRD §34.7: the UI never reads or writes `~/.xtrm/state.db`; data arrives through typed adapters
  with a live implementation **and** a typed fixture, selected by configuration, never by a component.
- PRD §9: Program is governance, not a second task tracker; it must not copy executable issue state.
- PRD §34.9: "quiet · flat · restrained · professional · dense but readable; hairline borders; no card
  soup; no dashboard aesthetic; restrained XTRM violet accent".
- The board's ownership matrix: an integrating app "is expected to write at most `answers/<qid>` and
  read everything else. It must never write `created_by:"sync-jira"` events and never republish the page."
- here.now store rules: whole-document `PATCH`, 16 KB per record, one path = one record, last writer
  wins, `nextCursor` pagination, bearer auth, page is private.

## 2. Decision

### D1 — Project is the surface; Program is not a competing mode

The rail entry that is already labelled "Project" becomes a **repository-scoped destination** at
`/rep/:owner/:repo/project`. The global `/program` route is removed, and `/program` and
`/rep/:owner/:repo/governance/program` redirect to the selected repository's `project` root.

The cross-repository Programme read model (`/api/programme`) is **retired from navigation**. It has no
live data path (404 in production), the adapter runs on a fixture, and the PRD already forbids it from
duplicating executable work. If cross-repository governance becomes real, it returns as a separate
decision and route with its own contract. No third name is introduced now: the vocabulary is
**Project** (repository-scoped) and nothing else.

Consequence: PRD §9 and shell architecture §9.1/§10 are amended to say that *Project* is the
repository-scoped product surface, and that cross-repository governance is a separate, currently
absent concern.

### D2 — Route tree

All routes are under `/rep/:owner/:repo/project`. Drawers stay search parameters (§9.1), so records
open in the Inspector rather than as new pages.

| Route | Surface | Primary source | Writes |
|---|---|---|---|
| `/project` | **Overview** — now, next, attention (questions unanswered, blocked workers, due follow-ups), integration health | status board + Substrate | — |
| `/project/timeline` | **Timeline** — day-grouped agenda of `schedule/<day>` events (`window`, `pr`, `handover`, `incident`, `report`), with a now marker | status board | — |
| `/project/questions` | **Questions** — `questions/<owner>` rows, grouped by owner, per repository | status board | — (read-only in this tranche; XTRM-821 owns the write) |
| `/project/workers` | **Workers** — `workers/*`, live status, issue link, milestone, claim expiry | status board + Substrate issue link | — |
| `/project/followups` | **Follow-ups** — `followups/*` with refs | status board | — |
| `/project/jira` | **Jira** — issues bound to this repository's Jira project: key, summary, status, assignee, last sync state | Substrate bindings + Jira read | — (deep link only) |
| `/project/settings` | **Integration** — resolved binding (Substrate project, status-board site, Jira site/project), credential file *paths* (never values), sync health, mapping gaps | server-side resolution | — |

Rules for the tree:

- **Project is a repository section only** in this scope. It is reachable through the repository-scoped
  route and the existing sidebar section. Promoting it to a first-class rail mode later is a navigation
  change on top of an existing surface, not a rewrite, so this reversal costs one small commit.
- No page aggregates every record into one list. Each surface has one collection and one purpose;
  counts and cross-links live on Overview.
- `archive/*` is not a sub-route in the first slice. Archived workers appear only in Workers behind an
  explicit "include archived" control, because rotation is a sync concern, not a product surface.
- `status/<session>`, `board/next`, `proposals/<date>`, `lanes/config` are read by Overview only.
  They do not become routes until a surface needs them.
- A repository with no integration binding renders one honest `EmptyState` ("This repository has no
  Project integration"), not an empty shell with fake sections.

### D3 — Project is a composition, not an adapter

`Project` has no single upstream. It is composed of typed adapters:

- **`statusBoard`** (new) — the here.now document store for one binding, read-mostly.
- **`jira`** (new) — Jira Cloud reads for one bound site/project, plus Substrate binding reads.
- **`substrate`** (existing) — issue, readiness, claim, journal, provenance for linked issues.
- **`portfolio`** (renamed from `program`) — the retired cross-repository snapshot. Kept only as a
  typed fixture and a module with no route while D1 stands; deleted when no code references it.

Each new adapter ships an interface, a **live** implementation, and a **typed fixture**, selected by
`VITE_XTRM_*` configuration (`src/adapters/index.tsx`). Components never learn the data source.
Overview and Workers compose `statusBoard` + `substrate`; Jira links are resolved through `jira`.

### D4 — Two new same-origin bridge plugins, no new service

- `server/status-board-api.ts` → `/xtrm-api/status-board/*`
- `server/jira-api.ts` → `/xtrm-api/jira/*`

Both follow the `substrate-cli.ts` pattern (a Vite plugin serving on the UI's own port), because the
browser cannot hold the credentials and the upstreams are private or CORS-hostile. Rules:

- credentials are read **server-side at request time** from the paths in the resolved binding
  (`status_board_key_file`, `jira_token_file`); values are never logged, returned, embedded in an
  error string, or included in a build artifact;
- read endpoints are an explicit allowlist; unknown paths are 404, not proxied;
- bounded caching: the board changes on a 5-minute mechanical cadence, so reads may cache for at most
  60 s and must send a freshness marker — `cachedAt`, the timestamp at which the upstream data was
  fetched (the cache entry's `at`), so a read served from the cache does not advance it; Jira reads
  cache for 30 s per issue;
- the only write is `PATCH answers/<qid>`, gated by a per-request check that the target path starts
  with `answers/`; every other write verb is refused at the route;
- the bridge is the only component that talks to here.now or Jira. No token, site key, or Jira
  endpoint appears in the client bundle.

### D5 — Jira durability: Substrate `external_bindings` is the link authority

The app does **not** get a Jira mapping table. A repository's Jira project and the issue↔Jira links
are durable Substrate state:

- binding row: `provider: "jira"`, `remoteScope: <site>:<projectKey>`, `remoteId: <numeric issue id>`,
  `remoteKey: <KEY-N>`, `url: <browse url>`, `mode: "mirror_read"` for a read-only link (the default),
  `mode: "intake"` only if Jira-originated issues are imported;
- `syncState` (`in_sync | pending | drift | uncertain`) is displayed as provenance, not inferred by
  the UI;
- the app reads bindings through the Substrate bridge. Two bounded reads are missing and must be
  added to the typed service and the CLI:
  1. list bindings for a project scoped by provider and remote scope;
  2. bind an existing issue to an external key (`sb provenance` today supports only `pr`).

**Non-goal, explicitly:** no Jira writes from the app in this scope. "Open the issue in Jira" is a
deep link in a new tab. Creating, commenting, transitioning, or labelling Jira issues stays out until
a later contract decides authority, idempotency, and audit.

### D6 — Reference resolution becomes provider-aware

Extend `src/refs/references.tsx` with a `jira` kind and an explicit `@jira:KEY-123` form.

Resolution order for a bare key (for example `ISSUE-551`, which is a real Jira key in this programme
and also matches the current Substrate issue-key pattern):

1. the reading repository's Substrate issue index;
2. the repository's bound Jira project;
3. otherwise render as prose (today's behaviour).

Consequences: a bare key must never produce a dead chip, and `@jira:` forces Jira when both resolve.
The chip shows the key and a status tone **only when the remote status has been fetched**; it never
invents a status from a record field.

### D7 — One integration binding, resolved server-side, from existing per-project settings

No new configuration format and no dual configuration. The bridge resolves, in order:

1. environment override (`PM_PROJECT`/`PM_*` for the sync; `XTRM_PROJECT_<NAME>_*` for the app if needed);
2. `~/.config/xtrm/project-management.json` → `projects.<name>` (already holds `status_board_site`,
   `jira_site`, `status_board_state_dir`, `answers_inbox`, `jira_token_file` defaults);
3. built-in defaults;
4. absent → the surface renders the "not integrated" state.

The repository is mapped to a project name by `projects.<name>.repo_slug` (for example
`mercuryintelligence/market-data`), then `repo_name`, then an explicit request parameter or `PM_PROJECT`
override. Verified on the canonical host: each project entry already carries `repo_slug`, `repo_name`,
`sb_project_id`, `sb_prefix`, `status_board_site`, `status_board_state_dir`, `status_board_key_file`,
`status_board_unit`, `status_board_status_overrides` and `jira_project`/`jira_board_id`, and `defaults`
carries `jira_site`, `jira_token_file`, `timezone`, `operator_handle`. No `sb` call and no heuristic is
needed to resolve the binding, and no new key is introduced. The same file drives the sync timer and
the app, so the board the app reads and the board the sync writes cannot diverge by configuration.

The app never reads the state directory (`state.json`, `drift.jsonl`, `sync.log` contents) through the
browser. Health is served by the bridge as a small typed object: `configured`, `site`, `stateDir`,
`lastSyncOkAt`, `driftCount`, `unitActive`, `unitActiveReason` — derived server-side, cached briefly.
`unitActive` is tri-state: `true`/`false` come from `systemctl --user is-active`, and `false` is
published only for a unit systemd reports as not running. `null` means the bridge did not verify the
unit, and it carries a named reason in `unitActiveReason` (`unit_not_found`, `probe_timeout`,
`non_user_session`, `probe_failed`): an unverified unit is never rendered as "the sync is down".

### D8 — Write ownership and conflict behaviour (deferred tranche)

The first tranche is **read-only against the board**. The design below is retained so the deferred
tranche does not re-open the design, but no write route ships until XTRM-821 is authorised, with an
audit trail and a retention rule. Read-only cannot corrupt board state; writing can.

- When authorised, the app writes **only** `answers/<qid>`: `{ answer, comment, at, by }`, `by` = the
  operator handle from the binding.
- Flow: read the record, render the current `updatedAt`, submit, then `PATCH` the whole doc with the
  same `path` and `doc`. If the record changed since the read (or the PATCH returns a newer
  `updatedAt`), the UI keeps the typed answer, shows "the question changed, review and resend", and
  never overwrites silently.
- Submission is idempotent per answer attempt (client-generated attempt id stored in the doc's
  `comment`/metadata only if the schema allows; otherwise the retry re-reads and re-PATCHes).
- Degraded states: board unreachable or stale beyond 60 minutes → read-only with a banner. Never a
  write against unverified freshness.
- Explicitly forbidden: republishing the page, writing `schedule/*` events, writing
  `created_by:"sync-jira"`, deleting records, editing questions.

### D9 — Visual contract

Every surface uses the existing tokens and primitives. No new colour, no new surface level, no card
container around a list.

- rows: `Row` (density `list`), hairline separators, hover-revealed secondary actions;
- status: `StatusDot` with existing tones; status is always text next to the dot, never colour alone;
- headers: `SurfaceToolbar` with the surface title, count, provenance (`SourceBadge`-style), refresh;
- empty/loading/error: the existing `EmptyState`, `LoadingState`, `ErrorState`;
- metadata: `--x-ink-muted`/`--x-ink-faint`, mono only for keys, SHAs, paths;
- accent: violet for selection, focus, references, and attention; nothing else;
- dark and light are both first-class; screenshots accompany each implementation issue.

New components, built from the primitives, all in `src/project/`:

| component | purpose |
|---|---|
| `ProjectShell` | repo-scoped section header, tab strip, binding health |
| `AttentionList` | Overview's ranked attention rows (question, blocked worker, due follow-up) |
| `DayGroup` / `EventRow` / `NowMarker` | Timeline agenda; a Gantt-style lane chart is explicitly deferred |
| `QuestionRow` / `AnswerComposer` | Questions and the single write path |
| `WorkerRow` | Workers, with issue chip and claim expiry |
| `FollowUpRow` | Follow-ups, with typed refs |
| `JiraRow` / `JiraChip` | Jira issue rows and inline links |
| `IntegrationState` | configured / not integrated / stale / degraded |

Registry-first applies (ADR-001 Decision 6): each implementation issue records which registry
components it searched before hand-building one.

### D10 — Notifications arrive later, through the same adapter boundary

The first slice exposes a stable change signal from `statusBoard` (new or changed `questions/*` and
`answers/*` records since a cursor) and from `jira` (new bindings and status changes). `Activity.tsx`
and its Frame plumbing consume that signal in a later, separately contracted issue. No new transport,
daemon, or websocket is introduced now.

## 3. Data model sketch (app types)

```text
ProjectBinding   { repository, substrateProject, statusBoard?: { site, stateDir }, jira?: { site, projectKey } }
ProjectHealth    { configured, lastSyncOkAt, driftCount, unitActive, unitActiveReason, stale }
BoardRecord<T>   { path, id, createdAt, updatedAt, doc: T }
Worker           { name, kind, where, runtime, issue, task, status, milestone, milestoneAt, ctxPct, claimUntil, reportsTo, note }
ScheduleEvent    { id, at, end?, ref, label, status, note, noteSrc?, url?, kind: "window"|"pr"|"handover"|"incident"|"report", createdBy }
Question         { id, ref, by, q, rec, why, at, owner }
Answer           { qid, answer, comment, at, by }
FollowUp         { ref, title, plain, status, priority, area, owner, when, refs }
JiraIssue        { key, summary, status, assignee, url, syncState, issueRef? }
```

Mapping rules: `doc` may arrive as an object or a JSON string (normalise once, in the adapter);
missing fields stay absent rather than being rendered as empty strings; unknown `kind`/status values
render neutrally and are logged as a contract gap, never coerced.

## 4. Freshness and health

| condition | UI |
|---|---|
| binding absent | `IntegrationState` "not integrated", no data calls |
| last sync ok < 15 min | normal, no badge |
| 15–60 min | quiet "last synced 34 min ago" in the toolbar |
| > 60 min, unit inactive (`unitActive: false`), or read error | read-only banner; writes disabled |
| unit unverified (`unitActive: null` + reason) | quiet "sync status unverified" beside the last sync; never the banner, never "down" |
| drift count > 0 | Overview attention row; link to the drift file summary (server-rendered counts only) |

The app never claims freshness it did not verify: the health object is server-derived and carries its
own timestamp (`checkedAt`), and every cached read carries `cachedAt`, the time the upstream data was
fetched rather than the time it was served, so a read can state its own age. An unverified unit state
is `null` with a reason, never `false`.

## 5. Security and privacy

- Bearer values exist only in the bridge process, read from files at request time.
- The bridge returns `401`/`502` with a generic message; it never echoes the upstream body or the key.
- A test asserts that built assets contain neither `here.now` API keys nor the Jira token, and that no
  client module imports the credential reader.
- Write routes are POST/PATCH only, require a same-origin `Origin`/`Sec-Fetch-Site` check, and refuse
  any path not under `answers/`.
- Read routes accept only the documented record paths; no arbitrary upstream URL is joined from input
  (SSRF guard).

## 6. Alternatives considered

- **Keep the artifact and embed it in an iframe.** Rejected: the page is private (401), it is one
  long page, it cannot be themed, and links inside it cannot open app drawers.
- **Rebuild the artifact's page as one app route.** Rejected: violates the "per-repo, structured"
  requirement and the "no single huge page" instruction, and duplicates a page instead of modelling
  records.
- **Mirror board records into Substrate.** Rejected: dual-write, last-writer-wins drift, and it
  contradicts the ownership matrix. The board keeps its own store; Substrate keeps issue authority;
  Jira links live in Substrate because that is where external identity already belongs.
- **An app-local Jira mapping table.** Rejected: Substrate already has `external_bindings`, sync
  states, drift, and provenance reads. A second table would be a second authority.
- **Keep Program global and add Project beside it.** Rejected: two overlapping surfaces, and Program's
  only data path is a Console v1 feature flag that is off and belongs to a package being retired.
- **Reuse Console v1's programme snapshot as the Jira or project data source.** Rejected: it is a
  governance projection behind a v1 flag, it carries no Jira identity, and depending on it would make
  the new surfaces inherit v1's retirement schedule.
- **Write Jira issues from the app now.** Rejected for this scope: no decided authority, idempotency,
  or audit model; the read-only link closes the operator's stated need.

## 7. Phasing

Each phase ships with its fixture, the live implementation behind configuration, typecheck, targeted
tests, and light/dark screenshots. No phase waits on another's UI.

1. **Scope** — this ADR (done); defaults recorded in §10.
2. **Bridge and adapters (read)** — `status-board-api.ts`, `jira-api.ts`, `statusBoard` and `jira`
   typed adapters with fixtures, binding resolution, health object, plus the Substrate binding read
   and Jira bind verb. No UI changes.
3. **Route and navigation rename** — Project as a repo-scoped destination, redirects, rail and
   sidebar, Program retired from nav, route tests, doc amendments.
4. **Overview** — the first composed surface, read-only.
5. **Timeline** — day-grouped agenda with now marker.
6. **Workers + Follow-ups + Jira surface**, plus Jira chips on Substrate issue pages and `@jira:`
   references.
7. **Deferred tranches** — answer writing (XTRM-821) and Activity notifications (XTRM-822),
   each separately authorised.

## 8. Risks

| risk | mitigation |
|---|---|
| Most repositories have no binding; the surface looks broken | explicit "not integrated" state; Overview hides project sections when unbound |
| here.now API drift or outage | adapter contract test against one live read; bounded cache; degraded read-only |
| Whole-doc PATCH loses a concurrent answer | read-before-write, `updatedAt` compare, explicit conflict UI |
| `ISSUE-*` key collision | provider-aware resolution (D6) with an explicit test fixture |
| Token leaks through logs, errors, or the bundle | file-only reads in the bridge, generic errors, asset test |
| Repo → project-name mapping gaps | Settings surface shows the resolved name and the source of resolution; no silent default |
| Project surface drifts from PRD §9 | ADR amendment recorded; cross-repo governance explicitly out of scope until re-decided |
| `vite preview` serves a stale build during acceptance | build before screenshots (documented trap) |

## 9. Evidence standard for acceptance

- Typecheck and targeted tests green; no new failures outside XTRM-745.
- Real read against the live board for `mercury/market-data`: one page of every surface, with its
  record count matching the store's count for that collection.
- Light and dark screenshots, side by side, per surface.
- Read-only tranche: no write request is made by any surface (assert with a fetch spy), and the
  Questions surface states that answering stays in the board until XTRM-821 lands.
- One repository without a binding renders the unintegrated state.
- Production deploy verified by artifact (unit active, pin equal, 200, capabilities), recorded on
  XTRM-784 — not by commit message.

## 10. Assumptions awaiting confirmation

None of these blocks the work. Each is recorded, taken as a default, and reversible at the stated cost.

| # | decision | default taken | reversal cost | why this default is safe |
|---|---|---|---|---|
| 1 | Retire the global Program mode | Retire the **Program** label and route; keep the surface as Project. No third name. | One label/route commit. | The rail label was already "Project"; the only data path is a Console v1 flag that is off. |
| 2 | Repo section vs rail mode | **Repository section only** (`/rep/:owner/:repo/project`). | One navigation commit on an existing surface. | It is additive: promoting to a rail mode later reuses the surface. |
| 3 | Answer writing | **Read-only** in the first tranche; write deferred to XTRM-821 with audit and retention. | A permission expansion, not a rewrite. | Read-only cannot corrupt board state; the board still accepts answers. |
| 4 | Jira writes | **Read-only links + open in Jira.** | Requires an explicit, later authorisation. | Writes touch an external system holding other people's data; the read-only link closes the stated need. |

Only item 4 is operator-level. Items 1–3 are recorded engineering defaults; a reply can amend any of
them.

## 11. Work decomposition (created)

Epic **XTRM-811**; children below. `blocked by` names the sibling in this table. `blocks` edges run blocker → blocked.

| issue | work | blocked by |
|---|---|---|
| XTRM-812 | Bridge `status-board-api.ts` — allowlisted reads, health, no writes | — |
| XTRM-813 | Adapter `statusBoard` (live + fixture) | .1 |
| XTRM-814 | Substrate bounded external-binding read + Jira bind verb | — |
| XTRM-815 | Jira read path — bridge + typed adapter | .3 |
| XTRM-816 | Route/nav rename, Program label retired, doc amendments | — |
| XTRM-817 | Project Overview + attention list + integration health | .2, .4, .5 |
| XTRM-818 | Project Timeline (day-grouped agenda) | .6 |
| XTRM-819 | Project Workers + Follow-ups | .6 |
| XTRM-820 | Project Jira surface + chips + `@jira:` refs | .6 (and .4) |
| XTRM-821 | **Deferred:** answer writing with conflict + audit | .6 |
| XTRM-822 | **Deferred:** Activity notifications | .6 |

XTRM-812 closes on local evidence. The deployed-console verification its contract defers is **XTRM-823** (discovered-from XTRM-812), so the last unproven item has its own owner instead of keeping the bridge open in progress.

XTRM-811 relates to the earlier, narrower XTRM-753 draft (Artifacts surface with two-way here.now
sync), which this scope supersedes in direction without closing it.
