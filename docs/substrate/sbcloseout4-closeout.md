# sbcloseout4 closeout report — A1 terminal adversarial acceptance (XTRM-252.14)

Date: 2026-09-15. Executor lane, mirror `/var/tmp/xtrm252-a1-work` (merged-main archive).
Authority: ADR `docs/substrate/sbcloseout4-adr.md` §§84–98, §102–§103.
Evidence only — no runtime implementation; failures would be filed as child issues, none found.

## Verdict

§103 is mechanically true on the mirror with an isolated HOME: **15/15 checks pass**
(19/19 tests including the §85 second leg, the §102 invariant, the §103 record and the
negative-control guard), full `npm test` **662/662 pass, 0 fail**, `npx tsc --noEmit`
**exit 0**. The negative control proves the suite fails when §85 is broken and passes again
after restore. No child issues are filed by A1.

## Suite and reproduction

- Suite: `packages/substrate/tests/sbcloseout4-acceptance.test.ts` (new file; no existing
  symbol modified — new-file scope, no blast-radius analysis required beyond the
  `gitnexus query` concept search already performed for `sb init repository identity`).
- Runner (single documented command):
  ```text
  cd /var/tmp/xtrm252-a1-work/packages/substrate && \
    HOME=$(mktemp -d) SUBSTRATE_DB=$(mktemp -u) \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    node --test tests/sbcloseout4-acceptance.test.ts
  ```
  Wrapper: `packages/substrate/scripts/run-sbcloseout4-acceptance.sh`.
- Transcripts: `docs/substrate/sbcloseout4-acceptance-transcript.md` (per-check command +
  env + observed output), `docs/substrate/sbcloseout4-negative-control-transcript.md`.
- Isolation: fresh HOME + temp `--db`/`SUBSTRATE_DB` on every run; mirror CLI
  (`packages/substrate/cli/sb.ts` via node) only, never PATH `sb`; real `~/.xtrm/state.db`
  and real HOME never read or written; live worktree
  `/home/dawid/dev/xtrm/.xtrm/worktrees/xtrm-xt-pi-o3rq` untouched; everything left
  uncommitted in the mirror for coordinator integration (no commit/push/tag/branch).

## Per-check evidence (check → command → observed result → refs)

| Check | Command (isolated HOME, mirror CLI) | Observed | Provenance / receipt refs |
|---|---|---|---|
| §84 fresh onboarding | `sb init` in fresh `git init -b main` repo; `issue create/list`; second `init` | deterministic `prj_a1service/A1SERVICE`, `baseBranch main`, `A1SERVICE-1`, idempotent re-init | `repository_bindings(local:<root> → prj_a1service)`, `checkout_links` alias |
| §85 isolation (release blocking) | `sb init` in A only; `issue list/ready/tree/claim/close` from uninitialized B; then init B | B fails closed `Run sb init`, leaks nothing; after init A=`[A1GAMMA-1]` B=`[A1DELTA-1]`; CLI demo `REPOA-1` vs `[]` | N/A (absence of cross-project rows is the evidence); error strings cite `sb init` |
| §86 worktrees | `git worktree add` linked + detached; init from feature worktree | one Project, `baseBranch main`, shared `[]` → `A1WT-1` visible everywhere | one `repository_bindings` row, one `projects` row |
| §87 multi-clone | real `git clone` ×2, `remote set-url` SSH vs HTTPS | one key `github.com/acme/a1shared`, one Project `prj_a1shared`, shared `A1SHARED-1` | one binding, `created=false/idempotent=true` on second init |
| §88 normalization | `normalizeRemote` + `sb init` per form; scan `repository_bindings` | one key `github.com/acme/a1tool`; no secret, no `@` persisted | binding rows (credential-free) |
| §89 collision | init `org-a/a1svc` vs `org-b/a1svc` | distinct deterministic IDs, stable re-init, distinct prefixes | two bindings, two projects, no rename |
| §90 adoption | seed `prj_a1adopt/A1ADOPT-1` + Journal finding, then `sb init` | `created=false/adopted=true`, refs unchanged, Journal ID reads back | `A1ADOPT-1`, Journal `jrn_…` preserved |
| §91 override | `SUBSTRATE_PROJECT=prj_repoa issue list` + `doctor` from uninitialized repo | intentional access succeeds; `doctor.initialized=false`, `effectiveOverride=prj_repoa`; later `init` binds | `doctor` JSON (`initialized`, `effectiveOverride`) |
| §92 3-session Journal | A: claim/note×3/checkpoint; B: resume/dispatch/result/receipt/close; C: show/journal/trace/resume | C reconstructs findings/decisions/result/validation/lineage/artifacts/closure without chat history | binding `bnd_…`, result `jrn_…`, receipt `rcp_…`, commit `a…a`, PR `github:acme/a1journey#7`, Closure `completed` |
| §93 coordinator capsule | root epic + 2 children with marker checkpoints; `issue resume <epic>` | capsule JSON contains neither `A1-CHILD-BLUEBERRY-41` nor `-42` | capsule child `checkpointRef`s (references, not bodies) |
| §94 provenance chain | dispatch with coordinator+specialist envelope; result; receipt+commit+PR; close with refs; `trace` | trace revision/hash match dispatch pins; binding/receipt/commit listed | `sess-a1-94`, `act-a1-94`/`att-1`/`ags-a1-94-1`, result `jrn_…`, receipt `rcp_…`, commit `b…b`, PR `github:acme/a1prov#3`, Closure `completed` |
| §95 zero-commit | research finding + bounded result + close, no `git commit` | `trace.commits=[]`, `closure.outcome=completed` | result `jrn_…`, Closure `completed` |
| §96 close matrix | close `completed/superseded/duplicate/cancelled` with reason+actor; reopen | durable outcome/reason/actor; `cancelled→cancelled` else `done`; reopen keeps prior Closure byte-identical | Closure rows `cls_…` (4), `XTRM_SESSION_ID=sess-a1-96` on envelope |
| §97 identity+retry | R4 env set; dispatch ×2 same activation new attempt; Journal finding | attempts `[att-1,att-2]` ordered distinct; entry carries `sess-a1-97/a1-97-session` | bindings `bnd_…`×2, `act-a1-97`, envelope session propagation |
| §98 no fabrication | bare note; minimal dispatch | note envelope null + IDs null; binding session/activation/attempt + envelope session/specialist null | N/A (absence is the evidence); known participant/workspace persist |
| §102 invariant | init→create→attest→claim→note→dispatch→result→receipt/commit→validate→close→resume/trace | revision/hash stable; validate/close/resume/trace all succeed | rev N + contract hash, `bnd_…`, `jrn_…`, `rcp_…`, commit `c…c`, Closure `completed` |
| §103 complete | one-command init; uninitialized-isolation; worktree/clone sharing; durable explain; resume; help/vocab/docs | all six bullets mechanically observed (see transcript) | cites the rows above; `JOURNAL_KINDS`/`CLOSURE_OUTCOMES` imports; six operator docs present |
| Negative control | temporarily reintroduce `only.length===1` shortcut in `resolveProject` | §85 fails (`0 !== 1`), guard fails; after restore 19/19 + tsc 0 | transcript `sbcloseout4-negative-control-transcript.md` |

Synthetic IDs are used throughout (`sess-a1-*`, `act-a1-*`, `github:acme/…`, SHAs
`a…a`/`b…b`/`c…c`): the durable linkage model is proven; live-provider wiring is
labelled UNVERIFIED in the transcript, not claimed.

## Child issues discovered

None. The suite is green on the mirror; the only failures seen during the lane were
suite-authoring bugs fixed inside the new test file itself (missing `--scrutiny LOW`,
missing `attest` before `claim`/`dispatch`, `journal append` returns `id` not `entryId`,
dispatch holder/activation agreement, §98 envelope expectations, guard comment filtering).
No runtime defect was found; per NON_GOALS nothing was fixed in `src/` or `cli/`.
P1 stretch (§§61, 81) and §99 non-goals were explicitly not gated and are not filed.

## Constraints honoured

Isolated HOME + temp store on every run; mirror CLI via node only; exact command/env/output
recorded per check; unknown labelled UNVERIFIED; no commit/push/tag/branch; no writes
outside the mirror; live worktree untouched; evidence only.
