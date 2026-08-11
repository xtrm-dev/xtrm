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
