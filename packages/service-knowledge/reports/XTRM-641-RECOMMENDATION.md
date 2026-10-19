# Recommendation: git-hook mechanism for service-knowledge freshness (XTRM-641)

Status: design recommendation, no implementation.
Scope: `packages/service-knowledge` consumer-side hooks. Non-goals: index schema
changes, consumer-repo edits.

## 1. Problem

Consumer-repo FTS5 indexes (`/.xtrm/cache/service-knowledge.sqlite`, gitignored)
and generated pages (umbrella `SKILL.md`) go stale after merges and never recover
without manual intervention. Observed case: registry last synced 2026-09-21 predates
the Library app; the umbrella page states "three services" while four are
registered; a fresh worktree has no FTS5 cache, so indexed queries cannot run
there at all.

The existing backstop (`install/git-hooks/post_merge_drift_sweep.py`, wired into
`.githooks/post-merge` by `install-service-knowledge.py --hooks-only`) did not
prevent this. Verified causes:

1. `post-merge` fires only on `git merge`. Rebase landings, `pull --rebase`,
   checkout/switch, worktree creation, `reset --hard`, and amend never fire it.
2. The sweep skips unless HEAD is on the default branch, and skips detached HEAD
   (the common xt-worktree state). Feature-branch merges never trigger.
3. Nothing rebuilds the gitignored FTS5 cache in a fresh clone/worktree until a
   default-branch merge happens inside that worktree.
4. The sweep rebuilds the index synchronously with no timeout, and runs an
   mtime-based drift scan (`scan_drift(..., use_gitnexus=False)`) that
   false-positives on fresh checkouts (all mtimes newer than `last_sync`) and
   reports whole-territory drift when `last_sync` is unset.

## 2. Recommended mechanism (two layers)

### Layer 1 (primary, authoritative): read-time freshness gate

Make staleness self-healing at read time so the trigger matrix stops mattering.

- Every read path (`index search`, `build_bundle`, `evidence_for_files`, the
  PreToolUse activator) compares `sk_index_state.source_ref` against `HEAD`.
- On mismatch, rebuild under a lock (single-flight across concurrent sessions),
  bounded by an explicit budget (proposed: 90 s, matching the dead
  `post_merge_reindex.py`'s `BUDGET_SECONDS`; measure on the reference corpus
  and set from data). On budget exhaustion, serve the stale index and record
  `retrieval_event{stale_served=1}`; never block the caller past the budget.
- This covers every landing path (merge, rebase, reset, checkout, new worktree,
  tarball) and fixes fresh clones/worktrees for free: absent cache = forced
  rebuild on first query.

### Layer 2 (advisory): touches-gated, marker-only git hooks

Keep three hooks: `post-merge`, `post-checkout`, `post-rewrite`. Each hook:

- Never builds the index. It writes or refreshes the pending marker
  (`.xtrm/.service-knowledge-drift-pending`) and prints a one-paragraph notice.
  Budget: exit in <1 s on no-touch; <2 s otherwise. Always exit 0. Never read
  stdin except where the hook protocol delivers SHAs (see S5 handling below).
- Applies the touches-gate in §3. No-touch = silent exit, no marker change.
- On touch = marker-only (no scan, no rebuild): the marker carries
  `trigger, range, reason, services, timestamp` (extend `drift.write_marker`).
  The cheap mtime scan moves out of the hook; reconciliation stays skill-driven
  (`/updating-service-knowledge`), which clears the marker only on full success.

Order matters: land Layer 1 first, extend triggers second. Adding two more
hooks around the current synchronous rebuild preserves the worst property
(unbounded post-merge latency) and multiplies install surface.

## 3. Definition: "touches service-knowledge"

Landing range per hook (no range resolvable = marker-only fallback, never a
full scan or rebuild):

| Hook | Range source | Missing-ref behavior |
|---|---|---|
| `post-merge` | `ORIG_HEAD..HEAD` | marker `reason=range-unknown`, no service list |
| `post-checkout` | argv `(prev HEAD, new HEAD, branch-flag)` | clone/fresh worktree = marker `reason=fresh-cache` |
| `post-rewrite` | argv/stdin SHAs (`amend`/`rebase`) | marker `reason=range-unknown` |

A landing **touches** service-knowledge when, for files in the range that are
git-tracked (`git ls-files` filter, reusing `_git_tracked_files`):

- (a) any path is the registry (`service-registry.json`), a skill body
  (`services/<id>/SKILL.md`), or the umbrella `SKILL.md`; OR
- (b) any path matches a registered territory glob for any service.

Drop the branch-name gate once this gate lands. Do not fall back to
`{main, master}` when `origin/HEAD` is unresolvable; skip with a debug line.
Treat detached HEAD (`branch == "HEAD"`) as eligible when the range touches.

Drift-cause tagging (hook writes, reconciler refines): prefer
`last_sync_ref..HEAD` diff scoping when refs exist (`reason=ref-range`); mtime
only as fallback (`reason=mtime-heuristic`). A `never_synced` service gets
`reason=initial-sync-needed`, not "merge caused drift".

## 4. Exact behavior, including failure modes

| Condition | Behavior |
|---|---|
| No registry present | Silent exit 0 (non-service repos unaffected). |
| Range does not touch (§3) | Silent exit 0. No marker write, no output. |
| Range touches | Write/refresh marker with `trigger, range, reason, services, timestamp`; one-paragraph notice to stdout; exit 0. |
| Marker already present | Refresh `timestamp`/`trigger`; preserve earliest `range` start (do not overwrite provenance). |
| `git` unavailable / argv unparsable / any exception | Marker `reason=range-unknown` or silent exit; exit 0 in all cases. Hooks never fail a merge, checkout, or rebase. |
| Concurrent landings | Marker write is last-writer-wins on a single small file; acceptable. The Layer-1 rebuild lock (not the hook) provides single-flight. |
| Fresh clone / new worktree | `post-checkout` writes `reason=fresh-cache` marker; Layer 1 rebuilds on first query. No mtime scan (avoids the false-positive storm). |
| `XTRM_AUTO_RECONCILE_DRIFT=1` set | Unchanged opt-in path, with §6 hardening. Default (unset): no subprocess, no network, no model calls from any hook. |
| `--no-verify` / hooks disabled | System degrades to Layer 1 only. Local search stays fresh via read-time rebuild; committed drift is caught by the CI check (§7). No silent staleness. |

Performance contract per hook invocation: zero subprocesses on the no-touch
path beyond `git rev-parse`/`git diff --name-only` (both <100 ms typical);
no Python interpreter start required for the gate itself — if the gate needs
territory-glob matching, precompute a pattern list the shell gate can apply,
following the `hook_prefilter.sh` precedent (fail-safe: any ambiguity defers
to running the hook body, and the hook body itself is marker-only).

## 5. Installer and worktree contract (fixes a live silent failure)

Verified in this worktree: `core.hooksPath=/home/dawid/dev/xtrm/.beads/hooks`
overrides the hooks dir, that directory does not exist, `.githooks/` is
absent, and the branch is a feature branch. Under this configuration the
installer reports success while no hook can ever fire.

- The installer must detect `core.hooksPath` and either install the chain
  there too or fail loudly. Never print `✓ activated` when no hook will fire.
- Chain snippets must not bake absolute install-time paths; resolve the
  `.githooks` source relative to the hook's own toplevel at runtime.
  (Runtime skill resolution already uses relative paths; the chain does not.)
- Linked worktrees (`git rev-parse --git-path hooks` →
  `.git/worktrees/<n>/hooks`) each need chaining. Document the per-worktree
  install requirement or ship `--all-worktrees` mode that iterates
  `git worktree list --porcelain`.
- Verify in the installer with a post-install self-check: resolve the active
  hooks dir exactly as git would, assert the chain marker is present in each
  of `post-merge, post-checkout, post-rewrite`, and report which worktrees
  are covered.

## 6. Auto-reconcile: harden or cut

The hook-invoked `sp script service-knowledge-sync` path (up to 600 s + 60 s
slack, `--allow-write-capable`, stdin inherited, no concurrency guard,
unbounded log append) contradicts the fast/non-interactive hook contract even
when opt-in. If retained:

- default timeout 120 s (operator-raisable), `stdin=DEVNULL` with proof that
  `sp script` has no prompt path, single-flight lockfile, log rotation for
  `.service-knowledge-auto-reconcile.log`.

Otherwise cut it in favor of the marker + next-session reconciliation, which
is the same outcome without the category error.

Unchanged either way: the hook never consults or mutates canary state.
Canary stays fail-closed and disabled by default (`canary/state.py`); the hook
only *detects*, the reconcile path *decides* under canary policy.

## 7. CI backstop, correctly scoped

Per `docs/devops/git-hooks-vs-ci-policy.md`, the authoritative gate for
*committed* drift is a CI required check: run the touches-gated drift scan
(`service-knowledge drift`, seconds-budgeted, no gitnexus enrichment) and
block merge on a dirty result or a stale umbrella/registry mismatch.

CI cannot fix the local FTS5 cache (gitignored derived artifact per
checkout). Do not present CI as the freshness backstop; Layer 1 is the
freshness backstop, CI is the committed-drift backstop.

## 8. Deletions and cleanups bundled with this work

- Delete `install/git-hooks/post_merge_reindex.py`: unwired by the installer
  (zero references outside packaging metadata), checks wrong registry paths
  (`registry.json`), and duplicates the sweep's embedded rebuild. Assert no
  references remain in installer, docs, or tests.
- Correct the umbrella's "Drift sync runs post-merge on master" line during
  the next regeneration to describe the actual contract (touches-gated
  `post-merge`/`post-checkout`/`post-rewrite` markers + read-time rebuild).

## 9. Rollout

1. **Layer 1**: read-time `source_ref`-vs-`HEAD` check with locked, budgeted
   lazy rebuild; telemetry on stale-served and rebuild duration.
2. **Hook slim-down**: strip the synchronous rebuild and mtime scan from
   `post_merge_drift_sweep.py`; marker-only with §3 touches-gate on
   `ORIG_HEAD..HEAD`.
3. **Trigger extension**: add `post-checkout` and `post-rewrite` with argv
   discipline per §3; installer covers all three hooks + self-check (§5).
4. **CI check**: required status check for committed drift; scope documented
   per §7.
5. **Delete** `post_merge_reindex.py`; update umbrella wording.
6. **Decide** auto-reconcile: harden per §6 or cut.

Validation per phase: existing suites (`tests/test_drift_cli.py`,
`tests/test_cli_smoke.py`, `index/tests/test_post_merge.py`) plus new cases
for argv parsing (checkout/rewrite args, missing refs), `core.hooksPath`
override loud failure, per-worktree chaining, rebuild budget exhaustion, and
the `--no-verify`/hooks-disabled degradation path.

## 10. Open questions (for implementation)

1. Read-time rebuild budget: measure `index.build` on the largest consumer and
   set the 90 s proposal from data; specify lock location and stale-served UX.
2. Marker consumer contract: who clears on partial reconcile, and does the
   pending marker block or merely advise the reconciler?
3. `last_sync` vs `last_sync_ref` precedence when both exist but disagree
   (clock skew, cherry-pick).
4. Worktree contract default: per-worktree install vs `--all-worktrees`.
5. Auto-reconcile SLO and non-interactive proof (see §6).
6. Platform-repo `.githooks` precedent is an unverified assumption in this
   environment; confirm whether consumers use `.githooks` + `core.hooksPath`
   chaining or stock `.git/hooks` before finalizing §5 wording.

## 11. Field evidence: darth-feedor consumer (2026-10-19, read-only probe)

Probed `~/projects/mercury/darth-feedor` (branch `main`, 12 registered
services) to close open questions. Findings, all observed, not inferred:

- **The post-merge hook is dead, not weak.** `.githooks/post-merge` invokes
  the absolute legacy path
  `.xtrm/skills/default/service-skills/install/git-hooks/post_merge_drift_sweep.py`,
  which does not exist: the umbrella was renamed to `service-knowledge` and
  the `[ -f ... ]` guard makes the hook a silent no-op. No sweep has fired
  since the rename migration. This single fact explains the case-study
  staleness better than trigger coverage: there is no trigger at all.
  Lesson for §5: the installer must re-resolve (not just chain) hook bodies
  after the `service-skills` → `service-knowledge` rename, and the
  post-install self-check must execute (or checksum) the resolved body.
- **Marker without consumer = silent staleness (S8, live).** A pending marker
  for `release-flow` (1 file, written by the `drift` CLI — message format
  matches `cli/drift.py`, not the hook) has sat unreconciled since Oct 4/5
  (~2 weeks). Advisory markers do not self-heal; this is the Layer-1
  justification from production data.
- **Reconcile stamps the registry but not the umbrella.** Registry
  `last_sync`/`last_sync_ref` values are current (Oct), while the umbrella
  table still shows July/September stamps. The reconcile path must
  regenerate the umbrella (SEMANTIC block preserved) whenever it stamps
  `last_sync_ref`, or the umbrella's freshness column is permanently wrong.
- **Index lags HEAD.** `sk_index_state.source_ref = adae531` vs HEAD
  `f11ea350`. A Layer-1 read-time gate would have rebuilt on first query
  after the merge; nothing did.
- **Hook wiring precedent (§5/Q6, now verified).** This consumer uses
  `.githooks/` + `core.hooksPath=.githooks` with a `.bd-sync` sibling
  convention (`post-merge.bd-sync`, `pre-push.bd-sync`). So the §5 contract
  must cover the `core.hooksPath` + rename-migration interaction explicitly:
  re-running `install`/`update` after a rename must rewrite stale absolute
  paths in `.githooks/*`.

## 12. Operator additions (platform session, 2026-10-19)

1. **Rebuild-cost datum (B1).** Full index rebuild on platform (71 items)
   took 152 ms wall. The 90 s budget has ~600x headroom — keep the budget,
   but measure the largest consumer before finalizing.
2. **Touches-gate is tracked-files-only (B2/B3).** Agent harnesses
   constantly drop untracked scratch dirs (`.pi/structured-returns`,
   `.specialists/settlements`). The deploy guard's porcelain lesson applies:
   gate on `git diff --name-only` filtered by `git ls-files`, never on
   untracked files.
3. **Regen convergence confirmed (B4 safety).** An umbrella regen restored a
   missing `release-flow` envelope nobody asked about — regeneration
   converges toward the registry rather than destroying data. Cite for B4.
4. **Marker reads must be live (B2).** A stale PENDING banner persisted in
   session context while `status` said absent — sessions snapshot drift at
   start. Readers must re-read the marker at use time, never rely on
   session-start snapshots.
5. **Retrieval gap, filed separately (backlog).** `per-page search box focus
   ring` returned zero hits (AND-semantics plus hyphen tokenization) while
   shorter phrasings routed fine. Normalize hyphens/case wherever matching
   logic is touched. Semantic-block preservation held in practice (hand edit
   survived regen).

## Evidence base

Reviewed in-repo: `install/git-hooks/post_merge_drift_sweep.py` (full),
`install/git-hooks/post_merge_reindex.py` (full),
`install/install-service-knowledge.py` (hook wiring), `scripts/drift_detector.py`
(`scan_drift`, tracked-file filter, enrichment cap), `scripts/hook_prefilter.sh`
(fail-safe precedent), `scripts/umbrella_generator.py` (SEMANTIC block,
provenance block), `cli/common.py` (`apply`, hook wiring, cache/telemetry
handling), `cli/drift.py`, `cli/status.py`, `cli/index_cmd.py`,
`cli/canary_cmd.py`, `canary/state.py`, `docs/devops/git-hooks-vs-ci-policy.md`,
live `git config core.hooksPath` / `--git-path hooks` / branch state.
Critique: overthinker activation `act:685b7809-569` (XTRM-641), adopted:
read-time freshness as primary, marker-only hooks, S2 installer loud failure,
S9 CI scoping, S7 auto-reconcile hardening-or-cut, dead-file deletion.
