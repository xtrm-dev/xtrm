# Git hooks vs CI — where checks belong, when `--no-verify` is justified

**Class of tension**: repos in this ecosystem run heavyweight checks (full pytest matrix, OSV, semgrep, gitleaks, pyright) that were originally wired into local `pre-push` git hooks. As the check matrix grew, local hook execution became the bottleneck that motivated `--no-verify` as a routine. Every use of `--no-verify` is a case of the check-placement policy failing, not a case of the operator being sloppy. This doc explains where each class of check belongs and what makes `--no-verify` a valid escape versus a policy smell.

Related: `dependencies-updating.md`, `dependency-bump-policy.md`, `deploy-gap-pattern.md`, bead `mercury-market-data-vzmx` (P1 — migrate Mercury test suite from git hooks to self-hosted CI runner).

---

## The four check placements

Every quality check runs in exactly one of four places. Which one is a policy decision, not a preference.

| Placement | Fires on | Runtime budget | Failure blocks | Good for |
|---|---|---|---|---|
| **Editor / IDE** | keystroke | milliseconds | nothing | LSP diagnostics, format-on-save |
| **Pre-commit hook** | `git commit` | ~1 second | commit | trailing whitespace, secret-scan, lockfile parse, `.env` guard |
| **Pre-push hook** | `git push` | ~10 seconds | push | fast unit tests on touched files, lint on touched files |
| **CI** | `git push` reaches remote | minutes | merge | full test matrix, cross-platform build, OSV, semgrep, coverage, container build |

The runtime budgets are hard. A pre-commit hook that takes 20 seconds gets bypassed within a week. A pre-push hook that takes 3 minutes gets bypassed the first time someone pushes a hotfix at 2am. The bypass rate reflects the runtime-vs-purpose mismatch, not the operator's discipline.

## What went wrong in Mercury (until the vzmx migration lands)

The market-data repo's `pre-push` hook runs the full pytest matrix + OSV + semgrep. That includes:

- Tests that require Docker services (`mmd-timescaledb`, etc.) reachable on hostnames that only resolve inside compose networks. On a host without those services, the tests fail with hostname-unreachable — a false negative.
- OSV and semgrep — legitimate checks, but they take ~40 seconds and give no incremental signal on a hotfix.
- Half a dozen pre-existing broken tests (MCP version drift, host-only-broken imports) that nobody has time to fix during a P0 push.

Result: every routine push during `mmd-sprint 2026-07-03` used `--no-verify` (see the sprint-side friction section of `/tmp/mmd-sprint/eval-sprint.md`). The escape hatch became the default. The escape hatch is not the problem — the pre-push runtime budget is.

Fix path: `mercury-market-data-vzmx` — migrate the heavy checks to a self-hosted CI runner, and drop the pre-push checks that duplicate CI. The `--no-verify` habit disappears when the pre-push budget matches the pre-push runtime.

## When `--no-verify` IS justified

Not never. There are legitimate uses:

- **Emergency rollback.** Reverting a bad commit in production shouldn't wait for a full test matrix. The revert PR runs CI; CI catches the regression if the revert is wrong.
- **Hooks temporarily broken for reasons unrelated to the change.** MCP-version drift, hostname unreachable, an OSV database refresh throwing errors. If the hook's failure is on infra it depends on, not on the diff, `--no-verify` is fine — CI will re-run the check on the merge queue.
- **Docs-only, comment-only, or lockfile-only changes.** If the diff cannot possibly affect the tests the pre-push hook runs, running them is theatrical. This is a policy call for the repo's `CONTRIBUTING.md` to make explicit; do not assume.

Common misuse to avoid:

- Bypassing hooks because they're slow. The fix is fixing the hook, not the bypass. File the bead.
- Bypassing hooks on a P0 hotfix because "CI will catch it". If CI runs on the merge itself, yes. If CI only runs on PR-open and the hotfix is pushed to a long-lived branch, no — the check might not run again.
- Bypassing hooks to land a broken test alongside "the real fix". Land them separately. The broken test lands with `pytest.mark.xfail` or `pytest.mark.skip` and a bead ID in the reason.

## When to move a check from hook to CI

Move it when any of these hold:

- Its runtime pushes the pre-push budget past ~10 seconds on a typical diff.
- It requires external resources (Docker networks, cloud auth, external APIs) that are not reliably present on the developer host.
- Its false-positive rate on developer hosts is above ~5%. False positives train the operator to `--no-verify` reflexively.
- It is redundant with a CI job that runs anyway.

Keep it in the hook when:

- Its runtime is under a second on a typical diff.
- It's a check that must not be bypassed on merge — for example, a secret-scan that would block a leaked key from ever touching the remote.
- Its failure mode is deterministic and clearly indicates a real problem (lint of an actual bug, ruff of a syntax error).

## When to add a check to CI without adding it to a hook

Default. The hook should be a fast local safety net; CI is the authoritative gate. If a check is only meaningful with a full matrix (multiple Python versions, multiple OS, integration with a real database), it does not belong in a pre-push hook and should never have been there. Add it to CI, and if the check is high-value, block merges on it via required-status-checks.

## Enforcement — required status checks

CI-only checks need to actually block merges to be authoritative. Configure the repo:

```bash
# List the required checks the repo already has:
gh api repos/<owner>/<repo>/branches/master/protection --jq '.required_status_checks.contexts'

# Add a check (settings → branches → require status checks):
# UI is easier for one-offs; use `gh` for scripted setup.
```

Every check the pre-push hook covers that should also gate merges must be a required status check. Otherwise a PR that skipped local hooks and had a CI failure could still be merged with admin override — which is exactly the failure mode `--no-verify` is expected to catch on the way back around.

## The hostname-unreachable trap

Mercury's pytest suite includes tests that require Docker-compose services reachable by their compose-network hostname (`mmd-timescaledb`, `mmd-questdb`, etc.). Those hostnames don't resolve on the host. If the pre-push hook runs the full suite, those tests fail with `getaddrinfo failed` and the operator learns to `--no-verify`.

Two ways to fix without gutting the check:

1. **Segment the suite.** `pytest -m "not requires_compose"` for pre-push; the full suite runs in CI where the compose network exists.
2. **Provide a hostname-shim on the developer host.** `/etc/hosts` entry pointing the compose hostnames at `127.0.0.1`, so the tests find the containers when the operator has them running. This one is fragile across operator setups; prefer #1.

## When `--no-verify` is a smell in your review

If you are reviewing a PR and the PR body notes `--no-verify` used, ask:

- Was CI green on the same commits? If yes, the escape was equivalent to trusting CI — probably fine.
- Was one specific hook failing for infrastructure reasons? If yes, the bead should reference that failing hook.
- Did the `--no-verify` bypass a check that CI does NOT re-run? That's the failure mode to catch — the change lands unchecked.

## Service-knowledge split: Layer 1 vs CI (authoritative)

For service-knowledge drift the responsibility split is explicit and
non-overlapping (XTRM-641 §2/§7, XTRM-648):

- **CI gates committed drift (authoritative).** The `service-knowledge drift`
  required status check (`.github/workflows/service-knowledge-drift.yml` →
  `packages/service-knowledge/scripts/ci_drift_check.py`) runs the
  touches-gated, seconds-budgeted drift scan with **no gitnexus enrichment**
  and blocks merge on a dirty result or an umbrella/registry mismatch
  (Services table vs `service-registry.json`, missing `skill_path`).
  Reuses the B2 touches gate (`drift_detector.scan_drift` with
  `use_gitnexus=False`: tracked-only, territory-glob, `last_sync_ref..HEAD`
  ref-first). Read-only: never writes the pending marker, never builds the
  FTS5 cache.
- **Layer 1 gates local freshness (authoritative).** The read-time
  `source_ref`-vs-`HEAD` gate rebuilds the per-checkout FTS5 cache on first
  query under a budgeted single-flight lock. It covers every landing path
  hooks miss (rebase, `--no-verify`, fresh clone/worktree) and fixes fresh
  checkouts for free (absent cache = forced rebuild).
- **Hooks stay advisory marker-only.** `post-merge`/`post-checkout`/
  `post-rewrite` write/refresh `.xtrm/.service-knowledge-drift-pending` and
  print a notice; they never rebuild the index and never decide merges.
- **CI never attempts per-checkout FTS5 caches.** The cache is a gitignored
  derived artifact; repairing it in CI repairs nothing in any checkout.
  Freshness backstop claims about CI are a category error — Layer 1 is the
  freshness backstop, CI is the committed-drift backstop.

## Change log

- 2026-10-19: B5 (XTRM-648) documents the Layer-1-vs-CI split and ships the
  required committed-drift check (touches-gated, seconds-budgeted, no gitnexus
  enrichment; dirty or umbrella/registry mismatch blocks merge).
- 2026-07-03: initial version. Extracted from mmd-sprint 2026-07-03 (sprint-side friction section, EVAL follow-up). Cross-referenced with bead `mercury-market-data-vzmx`.
