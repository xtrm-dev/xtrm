# A1 terminal acceptance transcript (XTRM-252.14, ADR sbcloseout4 §§84-98, §102-§103)

Base: merged-main mirror `/var/tmp/xtrm252-a1-work` (archive of 47093d4 with git-init shim;
`packages/substrate/node_modules` symlinked). No commits in the mirror; all changes left
uncommitted for coordinator integration.

Suite: `packages/substrate/tests/sbcloseout4-acceptance.test.ts` (19 tests).
Runner: `packages/substrate/scripts/run-sbcloseout4-acceptance.sh`.
Closeout: `docs/substrate/sbcloseout4-closeout.md`.
Negative control: `docs/substrate/sbcloseout4-negative-control-transcript.md`.

## Isolation (mandatory, observed)

Every acceptance run sets HOME to a fresh temp directory and uses a temp store path, so the
real `~/.xtrm/state.db` and the real `~/.config` are never read or written.

- Test harness (`tests/helpers.ts` `repoEnv`, used by every test in the suite):
  `HOME=<mktemp -d sb-home-…>`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`,
  `SUBSTRATE_PROJECT` deleted, `SUBSTRATE_DB=<mktemp -d sb-db-…>/state.db`, explicit
  `--db <temp>` on every CLI call.
- Single documented run command (from `packages/substrate`):
  ```text
  HOME=$(mktemp -d) SUBSTRATE_DB=$(mktemp -u --suffix=-a1-state.db) \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    node --test tests/sbcloseout4-acceptance.test.ts
  ```
  Wrapper: `./scripts/run-sbcloseout4-acceptance.sh [transcript-path]`.
- Mirror CLI invoked as `node /var/tmp/xtrm252-a1-work/packages/substrate/cli/sb.ts …`
  (in-process `runCli` in tests; subprocess `node cli/sb.ts` in the demos below).
  Never the PATH `sb` (`/home/dawid/.nvm/versions/node/v24.15.0/bin/sb`, an older
  main-checkout build). Observed `which sb` during the demo pointed at the PATH build;
  the suite never invoked it.
- Live-store check during the demo: with `HOME=/var/tmp/tmp.C7IwOst9XX` (temp),
  `ls ~/.xtrm/state.db` reported `No such file or directory` under that temp HOME.
  The real HOME was never exported during any run.

## Baseline (observed)

```text
$ cd /var/tmp/xtrm252-a1-work/packages/substrate && npm test
ℹ tests 662
ℹ suites 177
ℹ pass 662
ℹ fail 0
$ npx tsc --noEmit
EXIT:0
```

662 = 643 pre-existing + 19 new A1 acceptance tests. Full A1-only run:

```text
$ HOME=$(mktemp -d) SUBSTRATE_DB=$(mktemp -u) GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    node --test tests/sbcloseout4-acceptance.test.ts
✔ A1 §84 fresh-repository onboarding
✔ A1 §85 multi-repository isolation (release blocking)
✔ A1 §86 worktree resolution
✔ A1 §87 multi-clone identity
✔ A1 §88 remote normalization and credential stripping
✔ A1 §89 basename-collision determinism
✔ A1 §90 existing-store adoption without renumbering
✔ A1 §91 override semantics
✔ A1 §92 three-session Journal end-to-end (no chat history)
✔ A1 §93 coordinator capsule without child-transcript duplication
✔ A1 §94 Specialist provenance chain
✔ A1 §95 zero-commit Issue completeness
✔ A1 §96 close-reason matrix and immutability
✔ A1 §97 automatic identity propagation and retry lineage
✔ A1 §98 no fabricated provenance
✔ A1 §102 final architectural invariant end to end
✔ A1 §103 definition of complete (mechanical record)
✔ A1 negative-control guard: no global-cardinality shortcut
ℹ tests 19
ℹ suites 18
ℹ pass 19
ℹ fail 0
```

`node --version`: `v24.15.0`.

## §84 fresh-repository onboarding

Command: `node --test … --test-name-pattern="sb init detects"` with isolated HOME (see above);
plus `sb init` via mirror CLI in a fresh `git init -b main` repo.

Observed:

```text
repository.repositoryKey = local:<git-common-root>
repository.canonicalRemote = null, local = true
project = { id: prj_a1service, prefix: A1SERVICE, name: a1service }
baseBranch = main, created = true, adopted = false, idempotent = false
issue create → A1SERVICE-1; issue list → [A1SERVICE-1]
second sb init → created = false, idempotent = true, same project
```

No project metadata prompt. Evidence: binding row in `repository_bindings`, checkout alias
in `checkout_links`.

## §85 multi-repository isolation (release blocking, from an uninitialized repository)

Command: same suite pattern `uninitialized repository fails closed`; plus explicit mirror-CLI demo:

```text
$ (cd $RA && node $MIRROR/cli/sb.ts --db $DB --json init)
→ { project: { id: prj_repoa … }, created: true }
$ (cd $RA && node …/sb.ts --db $DB --json issue create --title "alpha work" --kind task --contract $CF --scrutiny LOW)
→ { humanRef: REPOA-1 }
$ (cd $RB_UNINITIALIZED && node …/sb.ts --db $DB --json issue list)
→ { ok: false,
    error: "this repository is not initialized for Substrate: no repository binding for local:…/repoB. Run `sb init` …" }
EXIT:1
```

Observed: `issue list`, `issue ready`, `issue tree`, `issue claim`, `issue close` from the
uninitialized repository all fail closed with `Run sb init` guidance and never return
`REPOA-1`/`A1ALPHA-1`. After `sb init` in B: A lists `[A1GAMMA-1]`, B lists `[A1DELTA-1]`
(isolation); in the CLI demo A listed `[REPOA-1]`, B listed `[]`. Release-blocking check PASS.

## §86 worktree resolution

Command: suite pattern `main, linked and detached`; repos built with real
`git worktree add` (linked branch `feature/x`, detached).

Observed: init from the feature worktree reports `baseBranch = main` (never `feature/x`);
main, linked and detached worktrees all `issue list → []` on the same Project; a create
from the detached worktree (`A1WT-1`) is visible from main; re-init from detached stays
idempotent with `baseBranch = main`; one `projects` row and one `repository_bindings` row.

## §87 multi-clone identity

Command: suite pattern `two checkouts`; real `git clone` from a local origin, then
`remote set-url origin` to `git@github.com:acme/a1shared.git` vs
`https://github.com/acme/a1shared.git`.

Observed: both checkouts normalize to `github.com/acme/a1shared`; first init creates
`prj_a1shared`; an issue created in clone A (`A1SHARED-1`) is already visible from clone B
before B runs init (shared identity, not a leak); second init reports `created = false`,
`idempotent = true`, same project; one project, one binding.

## §88 remote normalization and credential stripping

Command: suite pattern `equivalent remote forms`; pure `normalizeRemote` plus `sb init`
per form and a `repository_bindings` table scan.

Observed: `git@github.com:acme/a1tool.git`, `https://…`, `ssh://…`, and
`https://x-access-token:ghp_A1SECRET999@…` all normalize to `github.com/acme/a1tool`;
each init reports that key; `SELECT * FROM repository_bindings` contains neither the
secret nor `@` (userinfo stripped).

## §89 basename-collision determinism

Command: suite pattern `org-a/service`; remotes `git@github.com:org-a/a1svc.git` vs
`git@github.com:org-b/a1svc.git`.

Observed: different deterministic Project IDs (no random suffix, stable across re-init);
`A`-side and `B`-side human refs carry different prefixes; no accidental sharing.

## §90 existing-store adoption without renumbering

Command: suite pattern `adopts the existing`; seeds `prj_a1adopt` + `A1ADOPT-1` + a Journal
finding via service, then `sb init` in a fresh `a1adopt` checkout.

Observed: init reports `project.id = prj_a1adopt`, `created = false`, `adopted = true`;
`issue list → [A1ADOPT-1]`; `resolveRef("A1ADOPT-1")` unchanged; the pre-existing Journal
entry ID still reads back. No duplicate project, no renumbering, Journal/provenance preserved.

## §91 override semantics

Command: suite pattern `SUBSTRATE_PROJECT grants`; plus explicit CLI demo from an
uninitialized repository (observed):

```text
$ (cd $RB_UNINIT && node …/sb.ts --db $DB --json doctor)
→ initialized = False, effectiveOverride = None
$ (cd $RB_UNINIT && SUBSTRATE_PROJECT=prj_repoa node …/sb.ts --db $DB --json issue list)
→ ok = True, refs = ['REPOA-1']   (intentional cross-project access)
$ (cd $RB_UNINIT && SUBSTRATE_PROJECT=prj_repoa node …/sb.ts --db $DB --json doctor)
→ initialized = False, effectiveOverride = prj_repoa
```

Observed: override grants access but never binds; `doctor.repository.initialized` stays
`false`; a later `sb init` in B still binds B (`initialized = true`). `xt init` must still
initialize rather than accept the override as a binding (methodology; `xt` launcher itself
is UNVERIFIED — see below).

## §92 three-session Journal end-to-end (no chat history)

Command: suite pattern `A claims`; flow entirely through the mirror CLI except host-owned
receipt allocation (service `allocateReceipt`/`bindCommit`/`attachArtifact`, then cited at close).

Observed: Session A claims (with activation for dispatch agreement), appends finding +
decision + milestone, writes a semantic checkpoint; Session B `issue resume` succeeds,
`provenance dispatch` binds (`bindingId` non-empty), `journal append --kind result`
succeeds (`id` non-empty), receipt `rcp_…` binds SHA `a…a` plus PR artifact
`github:acme/a1journey#7`, `issue close --outcome completed --reason … --result <id>
--receipt <id>` succeeds; Session C `issue show` reports `closure.outcome = completed`
with the same reason, `journal show` contains finding/decision/milestone/checkpoint/result,
`provenance trace` succeeds, `issue resume` succeeds. Reconstruction uses only
Issue + Journal + capsule + provenance, never chat history.

## §93 coordinator capsule without child-transcript duplication

Command: suite pattern `root capsule`; root epic + two children, each child checkpoint
semantic contains a unique marker (`A1-CHILD-BLUEBERRY-41/42`).

Observed: `issue resume <epic>` succeeds; `JSON.stringify(capsule)` contains neither marker.
Root recovers children by reference (checkpoint refs + live projections), never bodies.

## §94 Specialist provenance chain

Command: suite pattern `Repository -> Project`; repo `a1prov` (`github.com/acme/a1prov`),
service dispatch with coordinator + specialist envelope
(`act-a1-94`/`att-1`/`ags-a1-94-1`), Journal result, receipt + commit `b…b` + PR artifact,
Closure citing result/receipt/artifact.

Observed: `provenance trace` reports the same `revision`/`contractHash` pinned at dispatch,
lists the dispatch `bindingId`, the receipt ID, and commit `b…b`; repository key, project ID,
revision/hash, claim, binding, session/activation/attempt/AgentSession, result ID, receipt ID,
artifacts and Closure all present and linked. Commit SHA and PR ref are synthetic
(UNVERIFIED against real GitHub; the linkage model is what is proven).

## §95 zero-commit Issue completeness

Command: suite pattern `research with zero commits`; kind `research`, finding + bounded
result + close with `--result`, no `git commit` anywhere in the flow.

Observed: `provenance trace.commits = []`; `issue show.closure.outcome = completed`.
Zero code changes, zero commits, still complete and understandable.

## §96 close-reason matrix and immutability

Command: suite pattern `completed/superseded`; `XTRM_SESSION_ID=sess-a1-96` in env;
closes with `--outcome completed|superseded|duplicate|cancelled`, each with reason + actor.

Observed: each `issue show.closure` persists its outcome/reason/actor; `cancelled` rests on
`cancelled`, others on `done`; `ClosureService` reopen keeps the prior Closure row
byte-identical (`getClosure` deep-equal) and lists it in history. Outcome vocabulary is
exactly `[abandoned, cancelled, completed, duplicate, invalid, superseded, wont_fix]`.
Close without outcome/reason fails closed (covered by pre-existing `closure.test.ts`).

## §97 automatic identity propagation and retry lineage

Command: suite pattern `xt session propagates`; `XTRM_SESSION_ID=sess-a1-97`,
`XTRM_SESSION_NAME=a1-97-session` in env; service dispatch ×2 (same activation
`act-a1-97`, attempts `att-1`/`att-2`) plus a Journal finding with the R4 envelope.

Observed: both bindings persist with distinct IDs, `attemptId`s `[att-1, att-2]`, ordered;
Journal entry carries `xtrmSessionId = sess-a1-97`, `xtrmSessionName = a1-97-session`.
Propagation is proven for the R4 env → envelope → Journal/binding path. The real `xt`
launcher → Pi/Claude provider-adapter path is UNVERIFIED live (no `xt`/provider session
in this run; covered by pre-existing `execution-context.test.ts` adapter tests, not
re-proven here).

## §98 no fabricated provenance

Command: suite pattern `unknown stays absent`; bare Journal note plus a minimal dispatch
(`participant` + `workspace` only).

Observed: bare note has `executionContext = null`, `participantId = sessionId =
activationId = null`; minimal binding has `sessionId = activationId = attemptId = null`
and `executionContext.xtrmSessionId/specialist.* = null`. Known inputs (participant,
workspace, timestamp) persist; unknown stays absent/null, never invented from prose.

## §102 final architectural invariant end to end

Command: suite pattern `Git repo -> init`; `XTRM_SESSION_ID=sess-a1-102`; full spine
through the mirror CLI + host-owned receipt: init → create → attest → claim → note →
dispatch → result → receipt/commit → validate → close with refs → resume + trace.

Observed: revision/hash pinned at dispatch still match at receipt time; `issue validate`
succeeds; close succeeds; `issue resume` and `provenance trace` succeed. No step depends on
Beads, old chat history, global-cardinality inference, or commit-message-as-explanation.

## §103 definition of complete (mechanical record)

Command: suite pattern `one-command init`.

Observed (each maps to a §103 bullet):

- New repo enters with one command (`sb init`) — §84 pass.
- Uninitialized repo never sees another repo's Issues (even with exactly one Project in
  the shared DB) — §85 + §91 pass, including the `doctor.initialized = false` + override
  distinction.
- Worktrees and recognizable clones share one Project — §§86–87 pass.
- Substrate durably explains authorized contract, events, actors/sessions, result,
  evidence/artifacts and terminal reason — §§92, 94–96, 102 pass with cited IDs.
- A new worker resumes from Issue + Journal + capsule + provenance without the old chat
  transcript — §§92–93, 102 pass.
- CLI help, MCP definitions, APIs/docstrings, skills and operator docs teach the same
  model — mechanically checked as: `sb init` help names repository identity; Journal kinds
  equal the `JOURNAL_KINDS` import; closure outcomes equal the `CLOSURE_OUTCOMES` import;
  `docs/substrate/{README,workflow,journal,provenance,repository-identity,cli}.md` all
  present (docs-drift gate `docs-drift-gate.test.ts` passes in the full 662). Full skill/
  MCP/docstring parity beyond these imports is UNVERIFIED here by scope (pre-existing
  `help-surface`, `m1-tool-surface`, `docs-drift-gate` suites own the depth).

## UNVERIFIED (labelled, not assumed)

- Real-HOME / live-store behaviour: never exercised by design (constraint). UNVERIFIED.
- P1 stretch items (§§61 inbound external comments, §81 session-centric queries beyond
  `provenance session|activation`): explicitly do not gate §103 per NON_GOALS. UNVERIFIED.
- §99 non-goals: explicitly not re-proven per NON_GOALS. UNVERIFIED.
- Real `xt init` launcher, real `xt`/provider session IDs, live Specialists scheduler,
  live GitHub/Jira remotes and PRs: synthetic IDs/URLs/SHAs used throughout
  (`sess-a1-*`, `act-a1-*`, `github:acme/…#n`, `a…a`/`b…b`/`c…c`). The durable linkage model
  is proven; live-provider wiring is UNVERIFIED here.
- `sb` on PATH: observed but never invoked (older build). UNVERIFIED and out of scope.

## Reproduction

```text
cd /var/tmp/xtrm252-a1-work/packages/substrate && npm test        # 662/662, 0 fail
cd /var/tmp/xtrm252-a1-work/packages/substrate && npx tsc --noEmit # exit 0
cd /var/tmp/xtrm252-a1-work/packages/substrate && \
  HOME=$(mktemp -d) SUBSTRATE_DB=$(mktemp -u) \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  node --test tests/sbcloseout4-acceptance.test.ts                # 19/19, 0 fail
```

Evidence only — no runtime implementation was changed by this suite (only new files:
`tests/sbcloseout4-acceptance.test.ts`, `scripts/run-sbcloseout4-acceptance.sh`,
`docs/substrate/sbcloseout4-acceptance-transcript.md`,
`docs/substrate/sbcloseout4-negative-control-transcript.md`,
`docs/substrate/sbcloseout4-closeout.md`).
