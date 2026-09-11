# Specialists Compat — Private Gate for Public SHAs

Bead: `xtrm-6qu.7.1.1` · Workflow: `.github/workflows/specialists-compat.yml` ·
Harness: `.github/scripts/specialists-compat.sh`

## Why this exists

`xtrm` is private and `xtrm-dev/specialists` is public. Public CI cannot
install or vendor `@xtrm/substrate` (no credentials, no disclosure, no npm
publication). This private workflow is the only place where a public
Specialists commit meets the real substrate package: it checks out the
public repo at an exact pinned SHA, injects `packages/substrate` through
the neutral `WorkItemStore` seam (`XTRM_SUBSTRATE_DIR`), and runs the
Bun 1.3.14 integration/parity suite. The durable run URL plus the two
immutable SHAs gate the Specialists merge.

## SHA policy (fail closed)

- `specialists_sha` dispatch input must be a full 40-char lowercase commit
  SHA. Anything else fails at the first step.
- The SHA must be reachable on `xtrm-dev/specialists` origin. A commit that
  exists only on a local machine or an unpushed branch fails the checkout
  step by construction. Never substitute a branch name or a local path.
- After checkout the workflow verifies `git rev-parse HEAD == input SHA`
  and aborts on any difference.
- The xtrm side runs at the workflow's own commit (`github.sha`). Final
  gating runs must be on xtrm main at `f8b2ebf` (PR #172, Bun seam) or
  later: earlier SHAs lack the `.7.2` sameHolder claimed-path fix that the
  Specialists consumer-side strict checks assume, and pre-`f8b2ebf` SHAs
  lack the lazy `bun:sqlite`/`node:sqlite` driver seam the parity runtime
  requires. Do not call parity against a pre-`f8b2ebf` xtrm commit final.

## Pre-dispatch human review (required, no exceptions)

The workflow executes untrusted public code (install scripts, test
suites) on a runner that also holds the private tree, and the runner
has unrestricted network egress. No YAML structure removes that: a
malicious public SHA could read the private checkout and exfiltrate it
(F2 residual risk, accepted and stated here). The control is a human
review by a trusted operator BEFORE every dispatch:

- Provenance: who pushed the SHA, to which ref, and does the push
  match the expected Specialists lane/branch and author?
- Diff: review the full diff of the candidate SHA against the last
  gated Specialists SHA. It must contain only expected A7 boundary
  work (seam, parity tests, auth/provider fixes). Unexplained build,
  install-script, network, or filesystem-touching changes are a veto.
- Pin: dispatch the exact reviewed SHA (full 40-char), never a branch
  name. Re-review on any SHA change, however small.
- Acknowledge and record: before dispatching, write on `xtrm-6qu.7.1`
  (and later the Specialists PR) that you reviewed the provenance and
  diff of the exact SHA and that you acknowledge the F2 premise — the
  public code under test receives read access to the private tree on a
  runner with unrestricted egress, so only a reviewed SHA ever runs.
  No acknowledgment, no dispatch.

Live `workflow_dispatch` success/negative runs happen only after this
workflow merges to the default branch. The bead stays open through both
run URLs being recorded.

## Seam contract (agreed with the Specialists spec lane)

- Factory: `createWorkItemBoundary(ports)` from
  `src/activation/workitem-store.ts` (also exported from `src/lib.ts`),
  with ports `{ issues, provenance, store, gate }`.
- Opener alternative: `openWorkItemBoundary({ dbPath?, substrateDir? })`,
  which dynamic-imports from `substrateDir` or `XTRM_SUBSTRATE_DIR` and
  fails closed with `work_item_store_unavailable` unless every expected
  export is present. It also validates `package.json` name identity
  (`@xtrm/substrate`) before deep imports.
- Parity command (Bun 1.3.14):
  `XTRM_SUBSTRATE_DIR=<abs path to built @xtrm/substrate> bun --bun vitest run tests/integration/substrate-parity.test.ts`
  covering migration → create → view/check/bind revision+hash stability,
  A-claim/B-dispatch holder refusal, and journal. The suite skips without
  the env var so public CI stays green.

## Manual dispatch

0. Complete the pre-dispatch human review above. No review, no dispatch.
1. Confirm the candidate Specialists SHA is pushed and reachable. A bare
   `git ls-remote <url> <sha>` does NOT prove this (the pattern matches
   ref names, not commit objects). Use one of:
   - ref comparison: `git ls-remote <url> 'refs/heads/xt/spec-lane-a7-boundary'`
     must print the candidate SHA on that ref; or
   - exact fetch: in an empty scratch repo,
     `git fetch <url> <full-sha>` must succeed.
   Anything else means: do not dispatch, the run will (correctly) fail
   at checkout.
2. Actions → `specialists compat (private)` → Run workflow →
   `specialists_sha = <full SHA>` → Run.
3. Wait for green. A red run blocks the Specialists merge until the cause
   is fixed on the appropriate side.

## Result verification (what counts as a gate)

All required, all in one run:

- [ ] SHA gate: input format valid, `HEAD == input SHA` verified.
- [ ] Substrate identity: `package.json` name is `@xtrm/substrate`.
- [ ] Neutral imports: no static `node:sqlite`/`bun:sqlite` value import
      anywhere in substrate `src`/`cli`/`integrations`; lazy conditional
      `require()` only in `src/store/sqlite.ts` (mirrors
      `tests/sqlite-runtime.test.ts`).
- [ ] Parity suite green under Bun 1.3.14 with `XTRM_SUBSTRATE_DIR` set.
- [ ] Full Specialists suite green (provider parity, no regressions).
- [ ] Typecheck/build green; `bun install --frozen-lockfile` clean.
- [ ] Clean tree in both checkouts.
- [ ] Step summary records xtrm HEAD, Specialists HEAD, PASS, and the run URL.

Record the run URL and both SHAs on `xtrm-6qu.7.1` and on the Specialists
PR. Only pass/fail and bounded non-sensitive diagnostics leave this repo:
the workflow has no artifact-upload step, the dispatch SHA enters shell
only through the quoted `$SPECIALISTS_SHA` variable, and every step that
executes repo code redirects full output to runner-local `$RUNNER_TEMP`
logs while printing command name + PASS/FAIL only — failed assertions may
dump source snippets, so that output never reaches the log stream.

## Negative proof

Dispatch with a malformed SHA (e.g. `deadbeef`) or an unreachable SHA:
the run must fail at the SHA gate or the checkout step. A negative run
that passes is a workflow defect — file it before any merge-gating claim.
