# board-audit — install & operational manual

`board-audit` has three deliberately separated surfaces: the original board/PR audit bundle, a lossless structured Beads work-package export, and a guarded round-trip reconciler that lets a human or model propose edits and compile them back to local Beads.

Canonical files:

```text
packages/board-audit/board-audit
packages/board-audit/board-audit-roundtrip.py
packages/board-audit/ROUNDTRIP.md
```

## Artifact location and GitHub visibility

User-visible board-audit artifacts are repository state, not temporary files. By default every invocation writes under:

```text
<repo>/.xtrm/board-audit/
```

Structured exports go under `exports/`; audit bundles go under `audits/`. Round-trip `prepare` and compile output are created beside the selected work-package file, so the complete ChatGPT/human handoff remains inside the repository tree.

This is intentional: once the selected artifact is committed and pushed on a branch, GitHub-connected agents can read the exact Beads snapshot/work package and return proposed edits without requiring local filesystem access.

`board-audit` does **not** auto-commit or auto-push generated artifacts. Version control remains explicit. A typical sharing flow is:

```bash
git switch -c board-audit/xtrm-123
board-audit --export --epic xtrm-123
git add .xtrm/board-audit/
git commit -m "chore(board-audit): export xtrm-123"
git push -u origin HEAD
```

The output root can be overridden for tests or intentionally ephemeral runs:

```bash
board-audit --output-dir /some/path --export --epic xtrm-123
BOARD_AUDIT_OUTDIR=/some/path board-audit --export --open
```

A relative override is resolved from the repository root.

## Prerequisites

Structured export/round-trip require `bd`, `python3`, and a Git working tree. Audit mode additionally requires authenticated `gh`.

```bash
gh auth status
bd stats
```

## Structured work-package export

Every structured export starts from one canonical acquisition:

```bash
bd export --all
```

There is no arbitrary `bd list --limit N` ceiling and no N× `bd show` hydration loop. Filtering and graph reconstruction happen locally from that immutable snapshot.

```bash
board-audit --export --open
board-audit --export --all
board-audit --export --epic xtrm-123
board-audit --export --bead xtrm-456
```

`--open` means non-terminal work rather than literal `status=open`; active `in_progress`/`blocked` work stays included. Closed ancestors required to understand an active subtree are retained as `context-only`. A non-epic task with children is also a work-package root.

Default output:

```text
.xtrm/board-audit/exports/export-YYYYMMDDTHHMMSS/
├── raw-beads.jsonl
├── manifest.json
└── work-packages/
    ├── <root-id>__<slug-title>.json
    └── ...
```

`raw-beads.jsonl` remains the direct Beads snapshot. `manifest.json` records repository/version/source command, record counts, SHA-256 provenance, selected scope and package diagnostics. Each work package uses schema `xtrm.board-audit.work-package.v1`, preserves every source field under `issues.<id>.source`, separates parent-child hierarchy from the wider dependency graph, and retains external/dangling relation diagnostics.

Structured export contains data only; it does not embed the large audit prompt.

## Editable round-trip

Prepare one work package directly from the repository-local export:

```bash
board-audit-roundtrip prepare \
  .xtrm/board-audit/exports/export-.../work-packages/xtrm-123__title.json
```

The `.editable.json` artifact has this contract:

```text
issues.<id>.source     immutable, hashed base evidence
desired_issues.<id>    desired planning/content state
new_comments.<id>      proposed comment text strings
```

Only `desired_issues` and `new_comments` are editor/model surfaces. The immutable base is hash-checked before reconciliation.

For existing beads, v1 supports edits to title, description, design, acceptance criteria, notes, spec ID, priority, issue type, estimate, external reference, metadata, labels and dependency/relationship edges. Operational state remains losslessly visible but read-only: existing status/lifecycle, assignee/owner, lease/heartbeat, scheduling, storage/persistence, compaction, gate/event and provenance/timestamp fields cannot be changed through this import path.

Historical comment objects are also read-only. A model that wants to add a comment writes only text in `new_comments`; the compiler emits native:

```bash
bd comments add <id> "<text>"
```

so local Beads assigns the actual author and timestamp. This prevents an uploaded artifact from forging comment provenance.

New desired issues may specify planning/content fields and an explicit ID; status is not editor-controlled. The compiler supplies conservative defaults when absent: `open`, priority 2, type `task`.

## Reconcile before mutation

```bash
board-audit-roundtrip validate package.editable.json
board-audit-roundtrip diff package.editable.json
```

The reconciler compares:

```text
base     original work-package source
current  fresh bd export --all
desired  edited artifact
```

Disjoint concurrent changes survive. If current and desired changed the same ordinary field differently, compilation stops instead of overwriting either side. Labels use set deltas, metadata uses per-key reconciliation, dependencies use typed graph-edge deltas, and proposed comments remain a separate append plane.

For deterministic/offline tests, commands that require current state accept `--current-jsonl path/to/export.jsonl`.

## Compile and inspect

```bash
board-audit-roundtrip compile-import package.editable.json
# alias:
board-audit-roundtrip compile-apply package.editable.json
```

Generated directory:

```text
beads-import.jsonl
changes.json
apply-plan.json
apply.sh
```

Only actual issue-row changes/new rows enter `beads-import.jsonl`; a comment-only proposal therefore needs no issue import. `apply-plan.json` includes changed IDs, actual import IDs and native follow-up commands.

Beads import merges auxiliary records, so exact removals are compiled separately: labels via `bd update --remove-label`, dependency pair changes via `bd dep remove` plus necessary re-adds, and proposed comments via `bd comments add`.

## Apply

Dry-run is the default:

```bash
board-audit-roundtrip apply package.editable.json
```

Actual mutation requires:

```bash
board-audit-roundtrip apply package.editable.json --execute
```

The tool freshly exports current Beads, reconciles, runs `bd import --dry-run --json` when issue rows exist, and stops unless `--execute` is explicit. Executed apply captures `bd dep cycles --json` before/after, fails if the proposal introduced a new scheduling cycle, re-exports Beads, and verifies the user-intended delta.

It never generates `bd import --allow-stale`. Existing Beads stale/tie handling remains a second race barrier for issue-row import.

Independent verification:

```bash
board-audit-roundtrip verify package.editable.json
```

Exit codes are designed for later automation: 0 success, 2 invalid/unsupported/command failure, 3 three-way conflict, 4 verification or newly-introduced-cycle failure.

The complete safety contract is in `ROUNDTRIP.md`.

## Audit mode

The historical audit workflow remains available:

```bash
board-audit
board-audit --epic xtrm-123
board-audit --no-pr
```

Each invocation gets its own repository-local audit directory:

```text
.xtrm/board-audit/audits/audit-YYYYMMDDTHHMMSS/
├── audit-bundle.md
├── audit-prompt.md
├── beads.jsonl
├── raw-beads.jsonl
├── prs.md
└── current-state.md
```

Audit-mode Beads data derives from the same one-shot `bd export --all` snapshot as structured export. The PR corpus still uses the historical auto-window from the oldest selected bead creation date minus seven days and supports `BOARD_AUDIT_PR_SINCE` / `BOARD_AUDIT_PR_LIMIT` overrides.

## Installation

Prefer symlinks so a normal `git pull` updates the globally available commands immediately:

```bash
mkdir -p ~/.local/bin
chmod +x packages/board-audit/board-audit packages/board-audit/board-audit-roundtrip.py
ln -sf "$(pwd)/packages/board-audit/board-audit" ~/.local/bin/board-audit
ln -sf "$(pwd)/packages/board-audit/board-audit-roundtrip.py" ~/.local/bin/board-audit-roundtrip
```

Regression checks:

```bash
board-audit --help
board-audit-roundtrip --help
python3 -m unittest discover -s packages/board-audit/tests -p 'test_*.py' -v
```

## GitHub Actions direction

The repository contains only non-mutative board-audit CI at this stage: Python/shell syntax plus round-trip unit tests. Automated Beads mutation is intentionally not enabled yet.

After representative round-trip trials, the intended next stage is export/prepare artifact → ChatGPT/human proposed artifact → non-mutative validation/diff → PR with apply plan → protected apply on an authorized runner → post-apply export/verification.

If authoritative Beads state is workstation/VPS-local, the eventual mutation job belongs on a constrained self-hosted runner that can reach that database; a fresh GitHub-hosted checkout must not be treated as authoritative state.
