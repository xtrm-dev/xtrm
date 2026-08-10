# board-audit — install & operational manual

`board-audit` exposes a simple user-facing handoff/reconcile workflow over the existing deterministic Beads export and guarded round-trip primitives.

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
→ resolve/create transport branch board-audit/xtrm-123
→ create isolated worktree with bd worktree create
→ board-audit --export --bead xtrm-123
→ board-audit-roundtrip prepare <package>
→ update .xtrm/board-audit/index.json
→ commit generated handoff artifacts
→ push board-audit/xtrm-123
→ bd worktree remove
→ delete the local staging branch
```

The Beads-managed worktree shares the same authoritative Beads database as the main repository through Git common-directory discovery. No copied database or redirect file is created.

The worktree itself is ephemeral and lives outside the repository under the user's cache directory. The durable interchange artifacts live on the transport branch under `.xtrm/board-audit/`.

A successful command ends with output similar to:

```text
✓ xtrm-123 ready for handoff
  branch:   board-audit/xtrm-123
  issues:   4
  editable: .xtrm/board-audit/exports/.../work-packages/xtrm-123__....editable.json
  checkout: unchanged (main)

Tell ChatGPT: "leggi export xtrm-123"
```

`handoff` may commit and push **only the transport-branch interchange artifacts**. It does not commit or switch the user's current working branch.

### 2. Edit remotely

A GitHub-connected agent reads the transport branch and edits only:

```text
desired_issues
new_comments
```

The immutable base remains:

```text
issues.<id>.source
```

`new_comments` contains text only and compiles to native `bd comments add`, so author/timestamp provenance remains Beads-owned.

### 3. Reconcile without mutation

```bash
board-audit reconcile xtrm-123
```

This fetches the latest `board-audit/xtrm-123` transport branch into another isolated Beads-managed worktree and runs:

```text
validate
→ fresh three-way diff (base/current/desired)
→ guarded apply dry-run
```

No Beads mutation occurs. The caller stays on the same branch.

### 4. Apply explicitly

After reviewing the reconcile output:

```bash
board-audit reconcile xtrm-123 --execute
```

This repeats validation/reconciliation against fresh local Beads state, then runs the guarded apply and post-apply verification. Successful execution marks the transport index entry `applied` and pushes that transport metadata.

`--execute` is the only high-level path that mutates Beads.

## Transport index

The stable lookup surface is:

```text
.xtrm/board-audit/index.json
```

Schema: `xtrm.board-audit.index.v1`.

Each bead/root maps to its current transport branch, export directory, manifest, immutable package, editable package, base digest, selected-record count and handoff state. This removes timestamp/glob discovery from the normal UX and gives GitHub-connected agents a deterministic pointer to the current artifact.

Handoffs made before the index existed remain readable: `reconcile` falls back to the newest matching `.editable.json` on the transport branch.

## Safety properties

Beads remains authoritative. Git is the transport/provenance plane for snapshots and desired-state proposals, not a replacement database.

The high-level flow preserves the round-trip safety contract:

- immutable `issues.*.source` hash validation;
- planning/content fields only for existing issues;
- assignment/lifecycle/lease/scheduling/storage/provenance fields remain read-only;
- historical comment records remain read-only;
- three-way reconciliation preserves disjoint concurrent changes;
- overlapping same-field changes fail closed;
- import runs dry-run first;
- `--allow-stale` is never generated;
- dependency-cycle deltas are checked on executed apply;
- executed apply finishes with fresh export and intent verification.

Exit codes inherited from the round-trip layer are: `0` success, `2` invalid/unsupported/command failure, `3` reconciliation conflict, `4` post-apply verification/new-cycle failure.

If handoff/reconcile fails after creating its isolated worktree, the tool deliberately retains that worktree and staging branch and prints their locations for recovery rather than deleting potentially useful evidence.

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
packages/board-audit/board-audit              # user-facing dispatcher
packages/board-audit/board-audit-flow.py      # handoff/reconcile orchestration
packages/board-audit/board-audit-core          # low-level exporter/audit implementation
packages/board-audit/board-audit-roundtrip.py # reconciliation/compiler/apply engine
packages/board-audit/ROUNDTRIP.md
```

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

`board-audit-flow.py` is invoked through `board-audit` and does not need its own global command.

Regression checks:

```bash
board-audit --help
board-audit-roundtrip --help
python3 -m unittest discover -s packages/board-audit/tests -p 'test_*.py' -v
```

## GitHub Actions direction

The current CI remains non-mutative. It validates syntax, export semantics, round-trip semantics, Git ignore boundaries and the high-level worktree handoff/reconcile flow.

A later protected Actions mutation flow can consume the same transport/index contract, but interactive local `handoff`/`reconcile` does not depend on Actions.
