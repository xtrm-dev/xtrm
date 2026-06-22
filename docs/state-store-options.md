---
title: state-store-options
date_created: Saturday, June 6th 2026, 5:48:54 pm
date_modified: Saturday, June 6th 2026, 10:00:00 pm
created: 2026-06-06T17:48
updated: 2026-06-09T01:35
---

![[Pasted image 20260606175047.png]]
# State Store & Deployment Tiers

> Status: design draft (2026-06-05).
> Resolves the recurring "SQLite vs Dolt vs Supabase for a shared store" question by
> separating it into **deployment tiers**. The storage choice is not one decision — it
> follows the tier (single user → team → company), all of which want web access to the
> console + DevOps + AgentOps optimization suite.
> Companion docs: `substrate_design_it.md` §13 (single-store + daemon), §17 (API faces),
> `specialist-agentops-suite.md` (the optimization suite this serves).
---

## 0. The realization

The earlier framing ("do you even need a shared DB?") assumed a single local user. That is
only the *smallest* edition. The real product spans a spectrum, and **every tier wants the
same web console** — work visualization + DevOps + the AgentOps optimization suite:
- **Solo, one machine** — one developer, local.
- **Solo, many machines** — same person, laptop + desktop + CI.
- **Team** — several people sharing a board, reviewing each other's specialist work.
- **Company** — many teams, many repos, central web access, roles/permissions.
The mistake is picking *one* store for all of them. The right move is a **two-tier
architecture** where the store scales with the tier, and the local runtime decision the
substrate doc already made (§13) stays intact at the bottom.
---

## 1. Two-tier architecture

```
            ┌─────────────────────────────────────────────┐
            │   SHARED / WEB TIER  (team, company)         │
            │   • web console (visualization)              │
            │   • DevOps + AgentOps optimization suite      │
            │   • auth (who sees what) · multi-user         │
            │   • realtime feed in the browser              │
            │   → Postgres / Supabase                       │
            └───────────────▲─────────────────────────────┘
                            │  projection / sync upward
                            │  (correlation by opaque ID, §13.1)
   ┌────────────────────────┴───────────────────────────────┐
   │   LOCAL RUNTIME TIER  (always present, authoritative)    │
   │   • sp / sb / channels · job lifecycle · worktrees       │
   │   • ONE daemon, ONE socket, ONE state.db per machine     │
   │   → SQLite (WAL)                                          │
   └──────────────────────────────────────────────────────────┘
```
**Bottom tier — local runtime (authoritative).** Unchanged from `substrate_design_it.md`
§13.2: one local SQLite (WAL) file behind one daemon, routing all projects/worktrees on the
machine by `project_id`. This is where the truth is written. It must stay local because the
whole §13.2 design exists to *avoid* the networked-server failure modes that burned bd
(Dolt corruption, "9 servers", "database not found in worktree"). Solo users never need
anything above this.
**Top tier — shared/web (projection).** When you cross into team/company, you need a place
that: serves a web console to many people, knows *who can see what*, and pushes live updates
into a browser. That is a fundamentally different store with different requirements (auth,
multi-user concurrency, realtime, a web API). The local SQLite runtime **projects/syncs
upward** into it; the shared tier is a **read-mostly projection plus team-level writes**
(comments, approvals, optimization decisions), never the source of truth for runtime state.
This is exactly the §17.3 "materialize vs read-live" fork applied at the deployment seam:
local stays read-live-authoritative; the team/company view is materialized upward.

**Bottom-tier ownership (decided 2026-06-06).** The local daemon, SQLite file, and Unix
socket protocol are owned by `packages/core/` in the xtrm monorepo. The daemon binary is
`xt daemon` (started idempotently). Domain packages (substrate, channels, specialists,
console) hard-import `@xtrm/core` at compile time for the `StateClient` library and
talk to the daemon over the socket at runtime — none of them opens `bun:sqlite` directly
on `state.db`. The same `StateClient` interface is intended to grow a `SupabaseStateClient`
implementation for the top tier so domain code stays unchanged across tiers. See
`monorepo-migration.md §3.0` for the package layout reasoning.
---

## 2. Storage per tier

| Tier | What it needs | Store | Why |
|---|---|---|---|
| Solo, one machine | local, fast, zero-ops | **SQLite + daemon** | the substrate design; nothing to add |
| Solo, many machines | shared state, still light, no team/web | **libSQL / Turso** (shared/replicated SQLite) | near drop-in with existing SQLite code; no heavy server |
| Team | web console, auth, multi-user, realtime | **Supabase (Postgres)** | bundles auth + realtime + API the web console needs |
| Company | all of the above + roles, scale, central web | **Supabase / Postgres** (managed or self-hosted) | mature, scalable, battle-tested |
Note the jump: **libSQL/Turso solves "one person, many machines" but does *not* give
auth/realtime/web-API.** The moment the console is multi-user and web-facing (team/company),
you need that bundle — which is precisely what Supabase adds on top of Postgres.
---

## 3. Why Supabase for the shared tier (not plain Postgres, not Dolt)

**vs Dolt — out, unless data-versioning becomes a product feature.** Dolt's only unique
value is git-style branch/merge/diff *on the data*. We don't want that (and bd already got
burned: immature, wonky, corruption). Crucially, the "track history / audit changes" need —
the *useful* part of versioning — is already met **without** Dolt: substrate §17 owns its
store and emits a monotonic `changesSince(cursor)` feed. We get change-tracking from a normal
DB; we do not need Dolt's storage engine. Dolt re-enters only if branch/merge-of-data is ever
a deliberate feature. It isn't today.
**vs plain Postgres — Supabase *is* Postgres**, plus the four things the multi-user web
console would otherwise force us to build by hand:
- **Auth** — registration, sessions, "who sees which project/repo" (essential for team/company).
- **Realtime** — row changes → websockets → the console updates live in the browser (this is
  the web equivalent of `sp feed`/`sb feed`).
- **Auto REST/GraphQL API** — the console reads/writes data with no bespoke backend.
- **Storage** — artifacts, plan files, reports.
Pick *plain* Postgres only if you want zero extra services and will build the API/auth/realtime
layer yourself anyway. For a console that must serve teams/companies, Supabase removes exactly
the backend you'd otherwise write.
**Speed/efficiency:** Postgres (under Supabase) is decades-mature and fast for this workload.
Dolt pays a performance tax for the history tracking we don't want. So "fast, efficient,
shared" points at Postgres, not Dolt.
---

## 4. How the AgentOps suite maps onto the tiers

The optimization suite (`specialist-agentops-suite.md`) splits naturally across the seam, and
this is the answer to its open question §12 ("cross-repo aggregation — where does the store
live?"):
- **Capture stays local** — `sp-improve(<name>)` proposal beads + per-run telemetry/forensics
  are written by the local runtime, per machine, as work happens.
- **Aggregation, evaluation, golden-sets, console-driven eval runs go to the shared tier** —
  cross-repo, cross-user pooling (hundreds of runs/week across repos) needs the networked
  store. The web console's "fleet maturity view" + "proposal queue" + "run the suite" buttons
  read/write the shared tier.
So the AgentOps suite is *why* the shared tier exists for non-solo users, and the shared tier
is *where* the suite's cross-repo aggregation lands. They justify each other.
---

## 5. Decision tree

```
Need to share state at all?
├─ No (solo, one machine) ........................ SQLite + daemon   ← substrate §13, done
└─ Yes
   ├─ Just my own machines, no team/web ......... libSQL / Turso (shared SQLite, light)
   └─ Team / company web console (auth, realtime)  Supabase (Postgres)
        └─ Do I want git-style branch/merge of DATA?
           ├─ No (default) .......................  stay on Postgres
           └─ Yes (deliberate feature) ..........  only then consider Dolt
```
---

## 6. Why keep the runtime local even when the shared tier exists

- **The bd→Dolt lesson (§13.2):** a networked server *as the runtime* caused corruption and
  coordination failures. The shared tier is a projection, not the write path for job/container
  lifecycle.
- **Offline / solo resilience:** a developer must be able to work with no server reachable.
- **Clean seam:** the no-cross-domain-FK discipline (§13.1, correlation by opaque ID) makes
  projecting local rows upward into Postgres trivial — IDs are just strings; the shared tier
  stitches them in the reader, same pattern as the single-store join.
---

## 7. Migration / compatibility

- The codebase is SQLite today (`observability-sqlite.ts`, etc.). The shared tier is
  **additive** — a projection/sync target — so adopting it does **not** rewrite the runtime.
- **libSQL/Turso** is the lowest-friction "shared" step because it aims at SQLite
  compatibility (closest to existing code). It is the right answer for *solo-many-machines*,
  the wrong answer for *team web* (no auth/realtime/API).
- **Supabase** is introduced when (and only when) the console goes multi-user/web. Build the
  projection as a one-way sync from local `state.db` → Supabase tables, keyed by the same
  opaque IDs.---
created: 2026-06-06T17:48
updated: 2026-06-06T17:49
---

---

## 8. Open questions

- **Sync direction & conflict** — is the shared tier strictly read-only-projection, or do
  team writes (approvals, comments, optimization decisions) flow *back* down? Lean: team
  writes live only in the shared tier, correlated by ID, never overwriting local runtime rows.
- **Self-host vs managed Supabase** — self-host for data ownership (Docker compose) vs managed
  for zero-ops; company tier may demand self-host.
- **Auth model** — map specialist permission tiers (LOW/MEDIUM/HIGH) + SCRUTINY onto Supabase
  row-level security / roles for the web tier.
- **What exactly projects upward** — full runtime state, or a curated console/AgentOps view?
  (Ties to §17.3: curate, don't mirror everything.)
- **n8n's place** — orchestrates between `sp serve` (local script specialists) and the shared
  Supabase tier; it is glue, not a store.

## 9. Decision log

**2026-06-06 — Path 1 confirmed.** SQLite + custom `xt daemon` + Unix socket is the bottom
tier for the foreseeable horizon. Reasoning summary: solo-user UX values low resource
footprint (~50MB RAM vs ~500MB–1GB for local Supabase stack), instant startup, offline-first,
and avoidance of the bd→Dolt "networked runtime" failure mode. Top tier (Supabase) remains
the path for team/company, accessed via projection upward.

**Revisit candidates** (do not re-litigate without these triggers):

- **Path 3 (libSQL/Turso embedded + sync).** Same SQLite-compatible engine across both
  tiers, native bidirectional sync, removes the dual-schema cost. Rejected for now due to
  ecosystem maturity (libSQL is significantly younger than SQLite). Revisit if: (a) libSQL
  proves stable in production deployments comparable to Postgres, OR (b) the SQLite→Postgres
  schema drift in Path 1 becomes painful in practice (duplicated DDL maintenance, query
  divergence).

- **Path 5 (schema-portable multi-impl `StateClient`).** Postgres-compatible SQL subset,
  deploy choice at `xt init` (SQLite-light vs Supabase-local), domain code unchanged.
  Rejected for now due to three-impl maintenance + test surface (SQLite, Supabase-local,
  Supabase-cloud). Revisit if: (a) team-tier becomes concrete and solo+team UX divergence
  emerges as friction, OR (b) Path 1's projection sync logic grows beyond ~500 LOC and
  starts feeling like premature infrastructure.

Paths 2 (Supabase locally everywhere) and 4 (Supabase managed everywhere) are not on the
revisit list — their rejections are structural (resource overhead, offline-loss), not
maturity-bound.

---

## 10. Inbound references and Stage 0 rollback (added 2026-06-13)

This document is named as **owner-of** the kernel decisions by several other canonical docs.
The list below makes the inbound surface explicit so future edits here know which sibling
docs need a paired update.

### 10.1 Who points at this doc as owner

| Pointing doc | What it points at | What this doc owes them |
|---|---|---|
| [[substrate_design_it]] §13 (Modello dati / storage) | "Decisioni kernel: single-daemon/single-socket/single-db, WAL mode, lessons-learned dai per-progetto Dolt server di bd, locking model" | §0–§2 + §6 here cover all of these; ensure those sections stay authoritative if WAL/locking/file-layout changes |
| [[substrate_design_it]] §15 Stage 0 row | "Stage 0 = substrate store + shared daemon + Unix socket protocol + project registration + file-lock launch — owned by [[state-store-options]] + [[monorepo-migration]]" | §10.2 below specifies the Stage 0 rollback predicate substrate §13.8 cites |
| [[substrate_design_it]] §13.8 migration-gates Stage 0 row | "Stage 0 rollback = restart daemon from WAL backup. Trigger: corruption detection via integrity check fallita." | §10.2 below specifies *how* WAL backup + integrity check work in the kernel |
| [[monorepo-migration]] §5.1 Stage 0 rollback row | Identical to substrate §13.8 (mirror) | Same — §10.2 is the kernel-side authoritative version |
| [[monorepo-migration]] §3.0 + [[forensic-event-contract]] §4 | Both reference `packages/core/` as owner of the daemon binary, state engine, socket protocol | The bottom-tier ownership note in §1 covers this; if package ownership shifts, update both targets |
| [[temp_roadmap]] §A.2 (bridge cost framework) "keeper" class | bd-layer patches retire at substrate Stage 13 (bd→substrate data migration), not at substrate landing | §7 (Migration / compatibility) here is the kernel-side framing of that lifecycle — keep it aligned with temp_roadmap's runway math |

### 10.2 Stage 0 rollback — the kernel predicate

Substrate §13.8 names the Stage 0 rollback trigger as "corruption detection via integrity
check fallita" and the rollback mechanism as "restart daemon from WAL backup snapshot taken
pre-Stage." This section specifies what those mean operationally so the rollback gate is
testable, not aspirational.

**Pre-Stage backup obligation.** Before any Stage 0 schema migration runs, the daemon takes
a WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`), then a hot-copy of `state.db` to
`~/.xtrm/state.db.backup.pre-stage-<stage-id>-<utc-iso>`. The backup is taken under the
daemon's exclusive lock — concurrent writers are blocked for the duration. The backup file
is never modified after creation; its existence is the rollback target.

**Integrity check predicate.** Post-migration, the daemon runs `PRAGMA integrity_check` and
`PRAGMA foreign_key_check`. Both must return clean. Any error or warning row triggers the
rollback path. The check is non-optional and runs synchronously before the daemon accepts
new socket connections — a failed check means the daemon refuses to start, the operator
sees the failure immediately, and the rollback gate engages.

**Rollback mechanism.** Daemon stops, the live `state.db` (and its `-wal` / `-shm`
siblings) are renamed to `state.db.failed.<utc-iso>` (preserved for forensic analysis, not
deleted), the pre-Stage backup is renamed into place, and the daemon restarts. The
operator approval required by substrate §13.8 ("every rollback requires explicit operator
approval") is collected interactively at the daemon's startup banner — the daemon will not
auto-restore from backup without a fresh operator confirmation. Forensic event
`migration.rollback.triggered{stage:"0", trigger_condition:"integrity_check_failed",
evidence_refs:[failed_db_path, backup_path], operator_approval_id}` is written to the
restored state — this is the lineage record substrate §13.8 references.

**WAL safety.** SQLite WAL is durable across crashes but not across file corruption — if
the WAL itself is what failed integrity, the backup is the only recovery path. The
backup-before-migration discipline above ensures this is always possible. The Stage 0
runtime contract is: the kernel may lose at most one Stage's worth of state on rollback,
never more.

### 10.3 The "keeper" bridge class (cross-ref to temp_roadmap §A.2)

The `bd` → substrate data migration is Stage 13 in substrate §15. Per [[temp_roadmap]]
§A.2 "keeper" class, the `bd` read-only mirror in `state.db` is the unusual bridge that
survives substrate's landing event — it retires only when Stage 13 lands successfully, not
at Stage 0 / Stage 1. The kernel implications:

- The `bd` mirror writes into substrate-domain tables (`bd_legacy_*` prefix) via the
  daemon, but is **never** read by domain code at runtime — it is operator-facing only,
  served through `bd compat` commands that route to the daemon's read-only API.
- The mirror's retirement criterion (per [[monorepo-migration]] §5.1: "≥30 days from Stage
  13 cutover AND <5 `bd` query forensic events/week observed in `state.db`") is evaluated
  against forensic events the daemon writes when `bd compat` commands hit the mirror. This
  is the data-driven predicate; nothing else.
- When the mirror retires, the `bd_legacy_*` tables drop in a clean migration — the kernel
  guarantee of "schema for inactive features costs zero" (§1) means nobody pays for the
  empty tables in the meantime.