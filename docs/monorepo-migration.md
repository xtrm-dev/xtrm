---
date_created: Friday, June 5th 2026, 11:13:49 pm
date_modified: Saturday, June 6th 2026, 10:00:00 pm
created: 2026-06-05T23:14
updated: 2026-06-09T01:35
title: monorepo-migration
---

# xtrm Monorepo Migration — Working Draft

> Status: exploration draft, revised 2026-06-06. Captures the git/worktree/packaging strategy
> for folding `xtrm-tools` (core), `specialists`, `gitboard` (console), and the greenfield
> `channels` + `substrate` packages into a single `xtrm` umbrella monorepo.
> Source of truth for the *design*: `~/second-mind/1-projects/xtrm/substrate/substrate_design_it.md`
> §"Layout del progetto" (the monorepo is already a committed design decision there).
> This doc covers the part the design is silent on: the git mechanics under a
> worktree-heavy workflow.

## 1. The monorepo is already decided

`substrate_design_it.md` §"Layout del progetto" commits to a five-package monorepo,
published as separate npm packages, importing each other in-repo:

| Package | Binary | Owns |
|---|---|---|
| **core** (ex `xtrm-tools`) | `xt` | bootstrap, **worktree management**, install/update/doctor, skills/hooks/policies SOT |
| **substrate** | `sb` | issues, containers, plans, collisions, validator, memory |
| **channels** | lib (+ `ch`) | channel primitive — messages, subscriptions, reducer |
| **specialists** | `sp` | specialist run, job lifecycle, tether, telemetry |
| **console** | web app | dashboard (read-only) |

Acyclic dependency graph:
`console → {all}`; `specialists → {channels, substrate, core}`;
`substrate → {channels, core}`; `channels → {}`; `core → {}`.

Runtime: **one daemon, one store, one socket** — `~/.xtrm/state.db` (SQLite WAL).
Separation is **ownership-in-code, not file separation**; tables are namespaced per
domain; correlation by opaque ID, never cross-domain FK. (§13.1–13.2)

The open question this doc answers: **git history + worktree mechanics**, which the
design does not specify.

## 2. Strategy: fresh umbrella, history-preserving per-package grafts

**Decision (revised 2026-06-06):** new `xtrm` repo at version `0.1.0`. The umbrella
is fresh; each package keeps its own history via `filter-repo` + merge.

### 2.1 Why fresh umbrella beats rename-in-place

An earlier revision of this doc proposed `specialists` → `xtrm` rename to preserve
`.beads`, `.claude/skills`, `.xtrm/hooks`, `docs/design/`, security pipeline configs.
That argument conflates two categories of asset:

| Asset class | Where it lives | Real loss with fresh umbrella? |
|---|---|---|
| **Configuration + docs** (`.beads` board, `.claude/skills`, `.xtrm/`, hooks, security configs, `docs/design`) | files in working tree | No — copy at first commit, zero loss |
| **Code history** (`git blame` on `src/specialist/forensic-events.ts`, archaeology of forensic envelope, MCP emitter, telemetry contracts) | git object database | Yes — *only if* you `git init` naively without grafting |

The fresh-umbrella + per-package-graft approach separates them correctly:

- **Umbrella `xtrm/` = fresh** — workspaces config, CI, docs/umbrella, fresh `.beads`
  init, skills/hooks/policies copied at first commit
- **`packages/* + apps/*` = grafted with full history** via
  `filter-repo --to-subdirectory-filter` + `merge --allow-unrelated-histories`

Result: `git log` on main tells "xtrm 0.1.0 — fresh start, by design". `git log
packages/specialists/src/specialist/forensic-events.ts` shows the full archaeology
of ub65d.2, redaction policy, MCP emitter, back to the first commit of that file.
**Zero loss where history matters; clean break where umbrella state was legacy mix.**

### 2.2 The earlier `specialists`-as-umbrella argument had a blind spot

The earlier revision said specialists "is the xtrm umbrella in everything but name"
because it carries `.beads`, `.claude/skills`, `.xtrm/hooks`, `docs/design/`. But:

- `.claude/skills` and `.xtrm/hooks` in `specialists` are **downstream installed
  copies** — the SOT lives in `xtrm-tools` (32 skills, 23 hooks, 12 policies, plus
  the `xt` install/update/sync pipeline).
- `docs/design/` is **split** — substrate design lives in `specialists/docs/design/
  substrate/`; xtrm-tools strategic docs live in `xtrm-tools/docs/design/ + plans/ +
  proposals/`. Neither repo has the full picture.
- `.beads` board in `specialists` is operationally active but **mixes three label
  conventions** (`forge-*`, `unitAI-*`, `xtrm-*`) from three separate work systems
  — its state is debt, not asset.
- The forensic/telemetry archaeology specialists *does* own uniquely is in `src/` —
  and that survives any graft via `filter-repo`.

A naive base choice between `specialists` / `xtrm-tools` / `gitboard` always
inverted some hierarchy. The fresh-umbrella approach makes the question moot.

### 2.3 GitHub asset migration (one-time cost)

The one real cost of fresh-umbrella vs rename-in-place is GitHub-level state. Each
of these is a one-time manual setup:

| Asset | Plan |
|---|---|
| Issues / discussions | Manual export-import for ones worth preserving; most current work is in `.beads`, not GitHub Issues |
| Secrets | Reconfigure on new repo (~15 min) |
| Branch protections | Reconfigure on new repo (~15 min) |
| Old repo URL redirect | Push deprecation note to each of the three legacy repos; users update remote once |
| Stars / watchers | Cosmetic; private-repo land, irrelevant |
| CI history | Irrelevant |

Single-user / private-repo context makes these costs marginal. They were
load-bearing in the original §2 argument only if the project had external
community following — which it doesn't.

## 3. The three grafts

All three legacy repos become grafted packages. No carve, no in-place rename, no
hierarchy inversion.

```bash
# pattern, run once per source repo

cd /tmp
git clone --no-local <source-repo> source-clone
cd source-clone
git filter-repo --to-subdirectory-filter <target-path>
# Case B (bloat): add --strip-blobs-bigger-than 1M --path dist --invert-paths

cd <xtrm-monorepo>
git remote add tmp-src /tmp/source-clone
git fetch tmp-src
git merge --allow-unrelated-histories tmp-src/main
git remote remove tmp-src
```

| Source repo | Target | filter-repo case | Notes |
|---|---|---|---|
| `xtrm-tools` | `packages/core/` | **Case B (huge bloat)** — `.git` is 287M, likely `cli/dist/` committed | Apply `--strip-blobs-bigger-than 1M --path dist --invert-paths` in the same filter pass |
| `specialists` | `packages/specialists/` | Case A (normal) | Preserves forensic/telemetry/MCP archaeology |
| `gitboard` | `apps/console/` | Case A (normal) | Preserves materializer + dashboard + bridge history; materializer code is bridge-disposable per substrate §17.4 but the integration knowledge stays |

Greenfield packages (no graft):

- `packages/channels/` — start at 0.1.0
- `packages/substrate/` — start at 0.1.0

### 3.0 Daemon binary and state engine ownership

`packages/core/` owns the **state engine + daemon process + socket protocol**
in addition to bootstrap/worktree/install/update. The daemon binary is
**`xt daemon`** (started idempotently by any CLI that needs the socket).
`sb`, `sp`, `ch` are CLI clients that talk to the daemon via Unix socket
(`~/.xtrm/state.sock`). No domain package (substrate, channels, specialists,
console) imports `bun:sqlite` directly — they all go through `@xtrm/core`'s
`StateClient` library at compile time and over the socket at runtime.

This separates two ownership axes that the earlier substrate design
conflated:

- **Infrastructure ownership** (file state.db, daemon engine, socket
  protocol, schema registry, transaction serialization) → `packages/core/`
- **Domain schema ownership** (containers/issues for substrate, channel_* for
  channels, specialist_jobs/forensic for specialists) → respective packages,
  each authoritative for its own namespaced tables, through the core API

Why this matters for the migration: gitboard's current
`apps/gitboard/src/core/xtrm-store.ts` + `Materializer` is general-purpose
engine code that writes `substrate_*`, `specialist_*`, `github_*`,
`xtrm_forensic_events`. It is cross-domain by nature. When migrated, it lands
in `packages/core/state/` and `packages/core/materializer/`, not in
`packages/substrate/`. The split between infra and domain is already implicit
in gitboard's code organization — the migration makes it explicit.

See `state-store-options.md` for the bottom-tier (this daemon) vs top-tier
(future Supabase projection) two-tier architecture.

### 3.1 Skills/hooks/policies location

Open: do skills/hooks/policies live at **repo root** (umbrella, copied from
`xtrm-tools` at first commit) or **inside `packages/core/`** (their git-history
home)?

Preference: **repo root for the runtime-active copies** (`.claude/skills/`,
`.xtrm/hooks/`, `.xtrm/policies/` consumed by the orchestrator + hooks engine);
`packages/core/skills/, /hooks/, /policies/` as the **authored source** that the
`xt install` / `xt update` flow propagates to the active locations. Same pattern
that already exists today between `xtrm-tools/skills/` and consumer-repo
`.claude/skills/` — just intra-repo instead of cross-repo.

This makes `xt install` an idempotent internal operation: `xt install --self`
syncs `packages/core/skills/` → `.claude/skills/`, run on every fresh worktree
bootstrap.

Same pattern applies to the **state engine**: `packages/core/state/` holds
the daemon source; `xt daemon start` lights it up on `~/.xtrm/state.sock`,
idempotent (no-op if already running).

### 3.2 Channels dependency on core

The earlier design (rev11) declared channels `→ {}` (zero-dep leaf) on the
grounds that channels is "una primitiva di messaging pura che non sa nulla
dei worktree, quindi resta massimamente riutilizzabile". With state.db owned
by core, channels needs the StateClient to persist messages, so the DAG
becomes:

```
console → {all}
specialists → {channels, substrate, core}
substrate → {channels, core}
channels → {core}      ← was →{}
core → {}
```

**Decision (2026-06-06):** accept `channels → {core}`. The zero-dep purity
was a theoretical property; no external consumer uses channels outside xtrm
in any near-term horizon. If a future need emerges, the split is mechanical:
keep `@xtrm/channels` as a pure in-memory primitive (reducer/messaging types,
no persistence), and add `@xtrm/channels-state` as the adapter that brings
in `@xtrm/core` for persistence. Domain consumers (specialists, console)
import the adapter; embedded consumers can keep importing the pure library.
This split is **not done now** — it adds a sixth package and complicates the
DAG for a benefit no one will collect in the visible roadmap.

## 4. Diagnose xtrm-tools bloat before the graft

```bash
cd /tmp/xtrm-tools-clone
du -sh .git
git rev-list --count HEAD
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '/^blob/ {print $3/1048576" MB "$4}' | sort -rn | head -20
```

- 287M `.git` + 1078 commits → almost certainly **Case B (huge bloat)**.
- Confirm via top-blob output: if mostly `cli/dist/*.cjs` or similar built
  artifacts, Case B confirmed; apply the strip-blobs pass.
- If top blobs are source files, fall back to Case A (graft as-is).

`specialists` and `gitboard` should be Case A (normal); run the same diagnostic
before grafting to confirm.

## 5. Sequencing — gated by the worktree fleet, not by difficulty

The earlier §5 was built around an in-place carve (`git mv src
packages/specialists/src`) that would conflict catastrophically with open
worktrees and PRs. The fresh-umbrella approach removes that constraint: legacy
repos stay intact during the graft; their open branches/PRs continue to land in
their current location until each repo is sunset.

Revised sequence:

1. **Prep (no disruption to legacy repos).**
   - Run blob diagnostics on `xtrm-tools`, `specialists`, `gitboard` to confirm
     Case A/B.
   - Drain in-flight PRs in each legacy repo to a clean state per repo (no
     concurrent rebase pain — they can drain independently, in any order).
   - Inventory hardcoded `src/` paths in skills/hooks/CI/GitNexus/tsconfig
     across all three repos (path sweep).

2. **Create xtrm/ umbrella.**
   - `git init`, fresh.
   - First commit: `package.json` (workspaces), root `tsconfig.base.json`,
     `bunfig.toml`, `.beads` init, root `.claude/skills/` + `.xtrm/hooks/` +
     `.xtrm/policies/` copied from current xtrm-tools at HEAD, root
     `docs/design/` (merged from xtrm-tools/docs/design + specialists/docs/design
     + gitboard/docs/architecture), CI workflow stubs, README declaring 0.1.0.

3. **Graft core first** (root of the dep DAG).
   - filter-repo + merge from xtrm-tools, Case B scrub.
   - Reconfigure `xt` binary entrypoint to point at `packages/core/cli/dist`.
   - Verify `xt` builds and runs.

4. **Graft specialists.**
   - filter-repo + merge.
   - Path sweep: every reference to `src/`, `tests/` rewrites to
     `packages/specialists/src/`, `packages/specialists/tests/`.
   - `@xtrm/core` imports change from npm-published to `workspace:*`.
   - Verify `sp` builds and runs against in-repo `core`.

5. **Graft gitboard as `apps/console/`.**
   - filter-repo + merge.
   - Same path sweep for `apps/gitboard/` → `apps/console/`.
   - Workspace deps rewire to `@xtrm/core`, `@xtrm/specialists` from in-repo.
   - Verify the running Tailscale service rebuild path still works.

6. **Greenfield channels.**
   - `mkdir packages/channels`, scaffold, build v0.
   - specialists imports `@xtrm/channels` via `workspace:*`.

7. **Greenfield substrate.**
   - Same pattern, after channels lands.

Step 2 can happen at any time — it's a fresh repo with no dependencies on legacy
state. Steps 3–5 each need their respective legacy repo's open work drained, but
they can proceed independently (no shared rebase risk).

## 6. Worktrees under a (huge) monorepo

Worktrees are orthogonal to monorepo vs polyrepo: a worktree is a checkout of one
*branch* of the whole repo. The `feature/<issue-id>-<slug>` rule, `xt
claude`/`xt end`, and the `xt-merge` FIFO queue are unchanged — they operate on
branches, not packages.

Size impact is smaller than it feels:

- **History is shared across all worktrees** — same `.git` object store. A 500
  MB `.git` is paid **once** at clone, amortized across every worktree.
  Worktree N adds zero history.
- **Per-worktree cost = working tree + `node_modules`**, both scopable (see §7).
- **Single daemon / single store** (`~/.xtrm/state.db`, one socket) is shared
  across all projects *and worktrees* — explicitly designed to kill the bd "9
  servers" / "database not found in worktree" failures. The runtime is already
  worktree-aware.
- bd → substrate migration removes the `.beads/issues.jsonl`-churn-in-git
  problem.

The one real tax: **`node_modules` per worktree.** Two huge packages installed
into every worktree is where **pnpm** (global content-addressable store,
hardlinks, near-free per-worktree installs) may beat **bun**. Benchmark `bun
install` vs `pnpm install` into a fresh worktree once core + specialists are
packages; let the number decide.

## 7. Sparse worktree bootstrap (scope a worktree to one package)

`sparse-checkout` config is **per-worktree**
(`.git/worktrees/<name>/info/sparse-checkout`), so each worktree can carry a
different scope off the same object store. Use `--no-checkout` so the full huge
tree is never materialized.

```bash
git worktree add --no-checkout "$WT" "$BRANCH"
git -C "$WT" sparse-checkout init --cone
git -C "$WT" sparse-checkout set $SCOPE     # the magic line
git -C "$WT" checkout "$BRANCH"             # materializes only $SCOPE
```

Cone mode: **all top-level files come free** (`package.json`, `bunfig.toml`,
`tsconfig.base.json`, lockfile), but **top-level directories are excluded
unless listed.**

`$SCOPE` must be **harness baseline + transitive workspace-dep closure**:

- **Baseline (always):** `.claude` `.xtrm` `config` `.beads` `docs` — the agent
  session needs skills/hooks/specialist defs.
- **Closure, not just the leaf:** `workspace:*` resolves to on-disk packages,
  so a `substrate` worktree that omits `channels`/`core` fails to build. Scope
  = the package's transitive workspace deps.

Savings track the DAG:

| Target | Closure | Savings |
|---|---|---|
| `channels` (`→{}`) | just channels | maximal |
| `core` (`→{}`) | just core | maximal |
| `substrate` (`→{channels,core}`) | + channels + core | partial |
| `specialists` (`→{channels,substrate,core}`) | nearly all but console | minimal |

Leaf packages win big; high-fan-out packages barely benefit. Channels (next
work, zero-dep leaf) is best case.

### Bootstrap sketch (real home is `xt`, which owns worktree management)

```bash
#!/usr/bin/env bash
# xt-worktree-add <branch> <target-package>
set -euo pipefail
BRANCH="$1"; PKG="$2"; WT=".worktrees/$BRANCH"
BASELINE=(.claude .xtrm config .beads docs)         # harness, always present
closure() {                                          # transitive workspace-dep dirs
  node scripts/workspace-closure.mjs "$PKG"          # or: pnpm list --filter "$PKG..." --depth -1
}
SCOPE=("packages/$PKG" $(closure "$PKG") "${BASELINE[@]}")
git worktree add --no-checkout "$WT" "$BRANCH"
git -C "$WT" sparse-checkout init --cone
git -C "$WT" sparse-checkout set "${SCOPE[@]}"
git -C "$WT" checkout "$BRANCH"
pnpm -C "$WT" install --filter "@xtrm/$PKG..."        # filtered install matches sparse scope
                                                      # bun: bun install --filter
```

The bead carries a package scope (substrate §6 issue schema), so `xt` can derive
`$PKG` automatically rather than passing it.

### Limits (honest)

- Sparse-checkout shrinks the **working tree**, not `.git` (history is shared
  anyway) — it's purely a working-tree + `node_modules` optimization, which is
  exactly the cost that mattered.
- Cross-package beads widen the closure **on purpose** — that's the atomic
  cross-package commit the monorepo exists to enable. Don't fight it; scope
  should track real blast radius.

## 8. Commits, PRs, versioning

- **Commits:** path-scoped conventional commits (`feat(channels):`,
  `fix(substrate):`). Let a single commit span packages only when the change
  is genuinely cross-cutting.
- **PRs:** one PR per bead-branch (unchanged). CI runs affected-package
  builds/tests only (`bun --filter` / turbo/nx `--filter …[origin/main]`).
  Path-based CODEOWNERS per package.
- **Versioning (per-package, continued where applicable):**

| Package | First version in xtrm/ | Continues from |
|---|---|---|
| umbrella (`xtrm`) | `0.1.0` | fresh — manifest claim of new product |
| `@xtrm/core` | `0.8.5` | xtrm-tools current (continue increment) |
| `@xtrm/specialists` | `3.17.x` | specialists current (continue increment) |
| `@xtrm/console` | continues | gitboard last published version |
| `@xtrm/channels` | `0.1.0` | greenfield |
| `@xtrm/substrate` | `0.1.0` | greenfield |

Use **changesets** — each PR declares which packages bump; it generates
per-package CHANGELOGs/versions and tags (`@xtrm/channels@0.3.0`). The
`/releasing` skill grows per-package awareness. The cross-repo asset delivery
GitHub Actions that today sync skills/hooks/policies from `xtrm-tools` to
`specialists`/`gitboard` collapse into a single intra-repo build pipeline.

## 9. Open decisions

- **bun vs pnpm** — decided by the per-worktree `node_modules` benchmark (§6).
- **xtrm-tools history = Case A or B** — almost certainly B (287M `.git`);
  confirm via blob diagnostic (§4) and run the strip-blobs pass.
- **Tag handling for grafted packages** — recommend dropping old per-repo tags
  during filter-repo (`--tag-rename ''` or none kept) and adopting changesets
  per-package tags going forward (`@xtrm/core@0.8.6`, etc.). Avoids tag
  collision across grafts.
- **Skills/hooks/policies layout** — root active copies + `packages/core/`
  authored source (§3.1). Alternative: root-only with `xt` reading from
  `packages/core/` directly. Decide during step 2.
- **`.beads` board migration** — fresh init + selectively port only
  open-and-relevant + closed-significant epics (e.g. `ub65d`, `60w93`). Mass
  migration of all closed work creates the same legacy-mix debt the fresh
  umbrella was supposed to clear.
- **Bead naming convention in new repo** — uniform `xtrm-<5char>`. Drop
  `forge-*`, `unitAI-*` legacy prefixes. They were artifacts of separate work
  systems.
- **Path-sweep inventory** — enumerate every hardcoded `src/`, `apps/gitboard/`
  reference (skills, hooks, CI, GitNexus, tsconfig, deployment docs) per legacy
  repo before grafting that repo.

## 10. Next actions

- [ ] Run blob diagnostic on `xtrm-tools` clone → confirm Case B + tune strip
  parameters.
- [ ] Path-sweep inventory per legacy repo.
- [ ] Decide bun vs pnpm from benchmark (small test: graft just core into a
  scratch xtrm-test repo, measure `bun install` vs `pnpm install` in a fresh
  worktree).
- [ ] Drain in-flight PRs in `xtrm-tools` → start graft (`packages/core/`).
- [ ] Drain in-flight PRs in `specialists` → graft (`packages/specialists/`).
- [ ] Drain in-flight PRs in `gitboard` → graft (`apps/console/`).
- [ ] Greenfield `packages/channels/` — first leaf, lowest-risk, validates the
  workspace plumbing.
- [ ] Greenfield `packages/substrate/`.
- [ ] Implement sparse worktree bootstrap in `xt` (`workspace-closure` +
  filtered install).
- [ ] Push deprecation notes to legacy repo READMEs once each is sunset.

## 11. State store alternatives considered

The `packages/core/` state engine (§3.0) commits to **SQLite + custom daemon +
Unix socket** as the bottom tier. This was a deliberate choice between five
options. Recording them here so future revisits do not re-litigate without
context.

| Path | Bottom tier | Top tier | Decision |
|---|---|---|---|
| **1 — SQLite + `xt daemon` + socket** *(chosen)* | SQLite WAL local + custom daemon | Supabase Postgres (projection upward) | **selected 2026-06-06** |
| 2 — Supabase locally via `supabase-cli` | Supabase Docker compose locally (~500MB–1GB RAM, 10–30s startup) | Supabase hosted | rejected: bottom-tier overhead too high for solo dev UX; violates bd→Dolt "no networked runtime" lesson at a milder severity |
| 3 — libSQL/Turso embedded + sync | libSQL embedded (SQLite-compatible) + sync to Turso server | libSQL server or Supabase | **revisit candidate** — same engine across tiers, native sync; rejected for now due to ecosystem maturity (libSQL is younger than SQLite); reconsider if dual-schema cost of Path 1 emerges in practice |
| 4 — Supabase managed everywhere | — (always cloud) | Supabase hosted | rejected: no offline, no local privacy, vendor dependency |
| 5 — Schema-portable, multi-impl `StateClient` | Choice at `xt init`: SQLite-light or Supabase-local | Supabase hosted | **revisit candidate** — single mental model of schema (Postgres-compatible subset), deploy choice at boot; rejected for now due to three-impl maintenance + test surface; reconsider if Path 1 dual-schema bottom-vs-top drift becomes painful |

See `state-store-options.md` for the full reasoning. Path 3 and Path 5 are
the most defensible revisit candidates if the dual-schema cost of Path 1 +
top-tier Supabase becomes load-bearing.
