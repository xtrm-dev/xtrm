# board-audit — install & operational manual

`board-audit` exposes a simple user-facing handoff/reconcile workflow over deterministic Beads export and guarded round-trip primitives.

The normal workflow is intentionally three commands:

```bash
board-audit handoff xtrm-123
# ChatGPT/human edits the remote desired-state artifact
board-audit reconcile xtrm-123
board-audit reconcile xtrm-123 --execute
```

The caller's current Git checkout is never switched by these commands.

## Primary workflow

### 1. Handoff

```bash
board-audit handoff xtrm-123
```

`handoff` performs the mechanical sequence that previously had to be remembered manually:

```text
fetch origin
→ resolve transport branch board-audit/xtrm-123
→ capture its exact remote SHA when it already exists
→ create a local staging branch from current origin/HEAD (normally origin/main)
→ restore only prior .xtrm/board-audit/** artifacts when this is a repeat handoff
→ create isolated worktree with bd worktree create
→ board-audit --export --bead xtrm-123
→ board-audit-roundtrip prepare <package>
→ update .xtrm/board-audit/index.json
→ force-stage only .xtrm/board-audit/**
→ commit transport artifacts with --no-verify and [skip ci]
→ push transport branch with --no-verify
→ normal push for first handoff, exact --force-with-lease rewrite for repeat handoff
→ verify local HEAD == fetched remote transport HEAD
→ repoint ephemeral staging upstream to the verified transport ref
→ bd worktree remove with normal Beads safety checks
→ delete the local staging branch
```

The Beads-managed worktree shares the same authoritative Beads/Dolt database as the main repository through Git common-directory discovery. No copied database or redirect file is created.

The worktree itself is ephemeral and lives outside the repository under the user's cache directory. The durable interchange artifacts live on the remote transport branch under `.xtrm/board-audit/`.

The transport branch is an artifact transport surface, not a long-lived code-development branch. Repeat handoffs are rebuilt from the current remote default branch and carry forward only `.xtrm/board-audit/**`. This prevents stale application/code ancestry from accumulating on old transport branches.

When a repeat handoff rewrites `board-audit/<id>`, the push uses an exact lease tied to the remote SHA observed after fetch. If another actor modifies the transport branch after that fetch, the push fails rather than overwriting the concurrent edit.

A successful command ends with output similar to:

```text
✓ xtrm-123 ready for handoff
  branch:   board-audit/xtrm-123
  issues:   4
  editable: .xtrm/board-audit/exports/.../work-packages/xtrm-123__....editable.json
  checkout: unchanged (main)

Tell ChatGPT: "leggi export xtrm-123"
```

`handoff` may commit and push only transport-branch interchange artifacts. It does not commit or switch the user's current working branch and does not mutate Beads.

### Transport hooks and CI

A board-audit transport commit is **not** a product-code delivery commit. Repository-local hooks commonly include code-oriented policies such as large-file limits, Ruff, Semgrep, OSV or Gitleaks entropy rules that are appropriate for application changes but can reject valid lossless Beads JSON. In particular, Beads memories and identifiers may intentionally contain long/high-entropy values, and a large work package may exceed repository code-file size conventions while remaining far below Git/GitHub hard limits.

The transport publisher therefore owns this narrow bypass:

```text
validate every staged path is .xtrm/board-audit or .xtrm/board-audit/**
→ git add -f -- <validated transport paths>
→ git commit --no-verify -m '... [skip ci]'
→ git push --no-verify ...
```

This does **not** weaken normal repository policy:

- the bypass exists only inside `board-audit-transport.py`;
- any path outside `.xtrm/board-audit/**` fails before force-stage/commit/push;
- normal branches and PRs still execute their configured hooks and CI;
- transport branches are not merged into the product default branch;
- `[skip ci]` suppresses broad GitHub `push`/`pull_request` workflow triggers for the transport commit where GitHub supports skip instructions; normal branch/path filtering remains preferable when already configured;
- confidentiality remains a precondition because the transport is lossless. Hook bypass does not authorize publishing secrets or restricted Beads data to an unsuitable repository.

The same policy applies when `reconcile --execute` updates `index.json` to `applied`: that is transport metadata, not a code change.

### 2. Edit remotely

A GitHub-connected agent first resolves the current artifact through:

```text
.xtrm/board-audit/index.json
```

and edits only:

```text
desired_issues
new_comments
```

The immutable base remains:

```text
issues.<id>.source
```

`new_comments` contains text only and compiles to native `bd comments add`, so author/timestamp provenance remains Beads-owned.

Normal consumers should not search timestamped export directories manually. `index.json` is the deterministic lookup surface.

### 3. Reconcile without mutation

```bash
board-audit reconcile xtrm-123
```

This fetches the latest `board-audit/xtrm-123` transport branch into another isolated Beads-managed worktree and runs:

```text
validate immutable source/edit contract
→ fresh three-way reconciliation (base/current/desired)
→ print exact issue/dependency/comment delta
→ guarded apply dry-run
```

No Beads mutation occurs. The caller stays on the same branch.

The three-way inputs are:

```text
base     = immutable issues.<id>.source from the exported package
current  = fresh local bd export --all from authoritative Beads/Dolt
desired  = edited desired_issues/new_comments from the transport artifact
```

Disjoint concurrent changes are preserved. Conflicting edits to the same ordinary field fail closed.

### 4. Apply explicitly

After reviewing the reconcile output:

```bash
board-audit reconcile xtrm-123 --execute
```

This repeats validation/reconciliation against fresh local Beads state, then runs the guarded apply and post-apply verification.

Executed apply performs:

```text
fresh export
→ validate/reconcile again
→ bd import --dry-run --json for issue rows
→ stop unless --execute
→ capture dependency-cycle baseline
→ real issue upsert
→ native dependency removals/rewires and comment additions
→ capture cycles again and reject newly introduced cycles
→ fresh export
→ verify intended delta
→ mark transport index state applied
→ push applied transport metadata
```

`--execute` is the only high-level path that mutates Beads.

## PR-checkpoint handoffs

A PR-checkpoint handoff is a versioned per-Bead evidence projection bound to an exact remote PR head. It is produced and inspected with:

```bash
board-audit pr-checkpoint 123
board-audit pr-status 123
board-audit doctor [123]
board-audit init
```

Both commands take an optional PR number and default it to the current branch's PR via `gh pr view`. The caller's checkout and branch are never changed.

`doctor` checks the environment: git repository, `bd`/`gh`/`python3`, usable GitHub authentication (`gh auth status`), beads workspace, board-audit package availability, hook installation (beads shim, dolt-sync chaining, checkpoint adapter, broken `&&` idiom detection). It exits 0 on pass, 2 on failures, 3 with `--check` when the checked PR handoff is stale.

`init` performs non-destructive additive setup: it refreshes the bd hook shims, writes the dolt-sync scripts and chaining (if-idiom), and appends the pre-push PR-checkpoint adapter. It never modifies the working tree or any branch, and it is idempotent.

### Self-contained derivation

When the repository carries `packages/board-audit` on its default branch, the checkpoint cherry-picks that package into the isolated worktree (via `git archive`, unstaged, pinned to the exact default-branch SHA) and runs the derivation from the repository's own copy. Only `.xtrm/board-audit/**` assets are ever pushed; the cherry-picked package is discarded before worktree removal. Repositories without the package use the caller's package copy; `doctor` reports this as a warning.

Every handoff records its producer so the evidence envelope can name the exact Board-Audit code that generated it:

```json
"producer": {
  "board_audit_source": "repository | caller",
  "repository": "owner/repo or null",
  "git_sha": "<exact archive SHA or null>",
  "package_sha256": "<sha256 of the executed package tree>"
}
```

The digest covers the executed package contents, so a dirty caller copy cannot be attributed to a clean source commit.

### Trigger model

A checkpoint can be triggered by:

- PR creation or a code push while the PR is open — event adapter or client-side hook;
- manual refresh — `board-audit pr-checkpoint <PR>`.

`pr-checkpoint` never publishes an unverified handoff. It fetches the implementation branch and requires the fetched head to equal the remote `headRefOid` reported by `gh pr view`. An un-refreshed binding is reported `STALE_CODE_HEAD`, never claimed current.

### Publication

`pr-checkpoint` verifies the remote PR head, then creates one isolated Beads-managed worktree (authoritative Beads via Git common-dir), acquires exactly one canonical `bd export --all`, builds the per-Bead read projection, publishes to transport branch `board-audit/pr-<number>` with the existing transport safety model — exact `--force-with-lease`, hook/CI bypass fenced to `.xtrm/board-audit/**`, remote SHA verification before worktree cleanup — and removes the worktree.

Published layout under `.xtrm/board-audit/`:

```text
index.json                                  index.v1 + open_issues + pr_checkpoints + packages
handoffs/pr-<n>.json                        pr-handoff.v1 (repository, pull_request,
                                            implementation_branch/head_sha, beads_root_ids,
                                            snapshot_id, snapshot_sha256, generated_at,
                                            transport_branch/head_sha, state, open_issue_count,
                                            work_package_count, index, handoff)
snapshots/<snapshot-id>/manifest.json       pr-snapshot-manifest.v1 (raw digest, record counts,
                                            per-file hashes)
snapshots/<snapshot-id>/roots/<root>.json
snapshots/<snapshot-id>/issues/<bead>.json  pr-projection.v1 (lossless source record +
                                            deterministic navigation)
exports/export-<ts>/manifest.json           work-package export manifest (existing exporter)
exports/export-<ts>/raw-beads.jsonl         the one canonical acquisition (same digest as the snapshot)
exports/export-<ts>/work-packages/          bounded root/work-package handoff
    <root>__<title>.json                    work-package.v1 (issues.<id>.source)
    <root>__<title>.editable.json           roundtrip.v1 prepared desired-state artifact
```

A PR checkpoint publishes the **bounded root/work-package handoff** (the same
packages the `handoff` flow produces, derived from the same single `bd export
--all` acquisition via `--from-raw`) plus a per-root prepared editable. The
index `packages` entries point at them, so the existing Web edit → `reconcile`
→ `reconcile --execute` round-trip contract resolves off the PR transport
branch unchanged.

The snapshot id is content-derived: the same open board plus the same PR head produce the same snapshot id. Unchanged records keep identical canonical SHA-256 hashes and are never rewritten. A checkpoint with no changes prints `NO_CHANGES` and adds no transport commit.

### Freshness

`pr-status` reports one of:

```text
FRESH            handoff head equals the live PR head and a snapshot is bound
STALE_CODE_HEAD  handoff head differs from the live PR head
STALE_SNAPSHOT   handoff head matches but no snapshot is bound
NO_HANDOFF       no handoff is published for the PR
```

`pr-status --check` exits `3` when the status is not `FRESH`. `prepared` does not mean permanently current: the generated timestamp and the exact head/snapshot bindings are the evidence boundaries.

### Automatic publication (no allowlist)

There is no allowlist and no blocker. Any invocation — manual, `--trigger auto|hook`, or the pre-push hook — publishes the checkpoint. Every push to a PR branch produces a verifiable Board-Audit handoff; any agent in the repository can verify it with `board-audit pr-status <pr> --check` or by reading the transport branch.

### Event adapter

`packages/board-audit/board-audit-pr-adapter.sh` is the post-delivery trigger. Wired as a pre-push hook (via `board-audit init`, which copies it into the hooks directory), it performs the code push itself first (`git push --no-verify`, lease-protected), then publishes `pr-checkpoint --trigger auto` against the now-remote PR head, so the handoff is FRESH — not stale — after every push. Adapter failures only warn and never block the code push. Invoked directly with a PR number, it checkpoints that PR without a push phase.

### Failure classes

Failures print `FAILURE: <CLASS>` to stderr and exit `2`:

```text
PR_NOT_RESOLVED  REMOTE_HEAD_MISMATCH  BEADS_UNAVAILABLE  SNAPSHOT_FAILED
TRANSPORT_CONFLICT  TRANSPORT_PUSH_FAILED  TRANSPORT_VERIFY_FAILED
CLEANUP_BLOCKED
```

Failed publication never mutates Beads and retains the isolated worktree and staging branch for recovery. `--comment` posts the compact locator as a PR comment via `gh`.

### Read-model boundary

The per-Bead projection is a read model only. Web actors must not edit `issues/<id>.json`; Web-originated mutation continues through the existing bounded `desired_issues`/`new_comments` round-trip followed by local `reconcile` and explicit `reconcile --execute`.

The design has no watcher and no dependence on `xt end` or any XTRM session lifecycle command.

## Transport index

The stable lookup surface is:

```text
.xtrm/board-audit/index.json
```

Schema: `xtrm.board-audit.index.v1`.

Each bead/root maps to its current transport branch, export directory, manifest, immutable package, editable package, base digest, selected-record count and handoff state.

Typical states are:

```text
prepared  handoff exists and may be edited/reconciled
applied   desired state was executed and post-apply verification succeeded
```

On successful execute the index also records `applied_at`.

Handoffs made before the index existed remain readable: `reconcile` falls back to the newest matching `.editable.json` on the transport branch.

## Safety properties

Beads/Dolt remains authoritative. Git is the transport/provenance plane for snapshots and desired-state proposals, not a replacement database.

The high-level flow preserves the round-trip safety contract:

- immutable `issues.*.source` hash validation;
- planning/content fields only for existing issues;
- assignment/lifecycle/lease/scheduling/storage/provenance fields remain read-only;
- historical comment records remain read-only;
- three-way reconciliation preserves disjoint concurrent changes;
- overlapping same-field changes fail closed;
- import runs dry-run first;
- `--allow-stale` is never generated;
- force-stage/hook bypass is fenced to `.xtrm/board-audit/**` only;
- exact force-with-lease protects repeat transport-branch publication;
- post-push cleanup verifies exact local/remote transport SHA before normal Beads worktree removal;
- dependency-cycle deltas are checked on executed apply;
- executed apply finishes with fresh export and intent verification;
- failed handoff/reconcile retains its worktree/staging branch for recovery rather than deleting evidence.

Exit codes inherited from the round-trip layer are: `0` success, `2` invalid/unsupported/command failure, `3` reconciliation conflict, `4` post-apply verification/new-cycle failure.

## Operational validation

The high-level path has been exercised against a real repository-local Beads/Dolt board, not only synthetic fixtures.

The first complete live round-trip used `xtrm-2zd` and covered:

```text
local Beads/Dolt
→ board-audit handoff
→ GitHub transport branch + index
→ remote desired-state edit
→ board-audit reconcile
→ conflict-free three-way diff
→ dry-run
→ board-audit reconcile --execute
→ existing issue updates
→ new child issue creation
→ dependency rewiring
→ native comment append
→ post-apply verification
→ index state = applied
```

Subsequent live use exposed two transport-only integration defects that are now regression-covered: repositories may ignore `.xtrm/` wholesale, and Beads worktree cleanup must compare the staging commit against the published transport ref rather than the default branch. A later Infra handoff also demonstrated why transport publication must not inherit code-oriented pre-commit/pre-push gates: a valid 117-bead lossless package was blocked by repository large-file, Gitleaks-entropy and Semgrep hooks even though no application code was being delivered.

## Advanced / low-level primitives

The high-level commands are wrappers. The deterministic primitives remain available for debugging, CI and specialized automation.

Structured export:

```bash
board-audit --export --open
board-audit --export --all
board-audit --export --epic xtrm-123
board-audit --export --bead xtrm-456
```

Every export starts from one `bd export --all` acquisition and writes by default to:

```text
.xtrm/board-audit/exports/export-YYYYMMDDTHHMMSS/
├── raw-beads.jsonl
├── manifest.json
└── work-packages/
```

Low-level round trip:

```bash
board-audit-roundtrip prepare package.json
board-audit-roundtrip validate package.editable.json
board-audit-roundtrip diff package.editable.json
board-audit-roundtrip compile-apply package.editable.json
board-audit-roundtrip apply package.editable.json
board-audit-roundtrip apply package.editable.json --execute
board-audit-roundtrip verify package.editable.json
```

See `ROUNDTRIP.md` for the complete schema/reconciliation/apply contract.

Historical audit bundle mode also remains available:

```bash
board-audit
board-audit --epic xtrm-123
board-audit --no-pr
```

Audit bundles live under `.xtrm/board-audit/audits/`.

## Files

```text
packages/board-audit/board-audit               # user-facing dispatcher
packages/board-audit/board-audit-transport.py  # fresh-from-main transport policy + exact lease/hook/CI handling
packages/board-audit/board-audit-flow.py       # generic handoff/reconcile orchestration
packages/board-audit/board-audit-core          # low-level exporter/audit implementation
packages/board-audit/board-audit-roundtrip.py  # reconciliation/compiler/apply engine
packages/board-audit/board-audit-pr.py         # PR-checkpoint handoff publication + freshness
packages/board-audit/board-audit-pr-adapter.sh # PR-checkpoint event adapter (client hook / PR-event executor / manual)
packages/board-audit/ROUNDTRIP.md               # complete low-level safety contract
```

`board-audit-transport.py` owns the user-facing transport policy. It delegates the generic reconciliation machinery to `board-audit-flow.py` while enforcing fresh default-branch ancestry, strict artifact path fencing, code-hook/CI bypass for transport-only commits, lease-protected transport rewrites and verified cleanup.

## Installation

Prefer symlinks so `git pull` updates the global commands immediately:

```bash
mkdir -p ~/.local/bin
chmod +x packages/board-audit/board-audit \
  packages/board-audit/board-audit-core \
  packages/board-audit/board-audit-roundtrip.py
ln -sf "$(pwd)/packages/board-audit/board-audit" ~/.local/bin/board-audit
ln -sf "$(pwd)/packages/board-audit/board-audit-roundtrip.py" ~/.local/bin/board-audit-roundtrip
```

The Python orchestration modules are invoked through `board-audit` and do not need their own global commands.

Regression checks:

```bash
board-audit --help
board-audit-roundtrip --help
python3 -m unittest discover -s packages/board-audit/tests -p 'test_*.py' -v
```

## GitHub Actions direction

The board-audit package's own CI remains non-mutative. It validates syntax, export semantics, round-trip semantics, Git ignore boundaries, hook/CI transport isolation, high-level worktree handoff/reconcile behavior, transport freshness/lease policy and cleanup safety.

Normal product-repository CI remains authoritative for normal product branches/PRs. Transport commits are deliberately marked `[skip ci]` and pushed with local hooks bypassed because they are artifact interchange, not code delivery. A later protected Actions mutation flow can consume the same transport/index contract, but interactive local `handoff`/`reconcile` does not depend on Actions.
