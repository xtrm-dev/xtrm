# board-audit — install & operational manual

`board-audit` now has three deliberately separated surfaces:

1. an audit workflow that exports Beads plus relevant merged PRs into a ChatGPT-web-friendly bundle;
2. a structured Beads export workflow that produces lossless, deterministic work-package JSON without audit instructions;
3. a round-trip reconciler that turns one work package into editable desired state, three-way merges it against current local Beads, compiles native Beads JSONL/mutations, and verifies applied intent.

The canonical files are:

```text
packages/board-audit/board-audit
packages/board-audit/board-audit-roundtrip.py
packages/board-audit/ROUNDTRIP.md
```

## Prerequisites

`bd` (Beads), `python3`, and a Git working tree are required for structured export/round-trip. Audit mode additionally requires authenticated `gh`.

```bash
gh auth status
bd stats
```

## Structured work-package export

The structured exporter always performs exactly one canonical acquisition:

```bash
bd export --all
```

There is no arbitrary `bd list --limit N` ceiling and no N× `bd show` hydration loop. All filtering and graph reconstruction happen locally from that immutable snapshot.

Export all non-terminal work:

```bash
board-audit --export --open
```

`--open` means non-terminal work, not only literal `status=open`. Active statuses such as `in_progress` and `blocked` remain included. Closed ancestors required to understand the hierarchy are retained as `context-only` records.

Other scopes:

```bash
board-audit --export --all
board-audit --export --epic xtrm-123
board-audit --export --bead xtrm-456
```

A task with children is treated as a work package even when its issue type is not `epic`.

Each invocation creates:

```text
/tmp/board-audit-<repo>/export-YYYYMMDDTHHMMSS/
├── raw-beads.jsonl
├── manifest.json
└── work-packages/
    ├── <root-id>__<slug-title>.json
    └── ...
```

`raw-beads.jsonl` is the direct Beads source snapshot. It is retained so the normalized projection never becomes a replacement source of truth.

`manifest.json` records repository, Beads version, source command, raw SHA-256, record counts, selection scope, work-package filenames and package content digests. It also reports unknown parent references and selected records that could not be packaged.

Each work-package file uses schema `xtrm.board-audit.work-package.v1`. It contains the root identity, all source issue records losslessly under `issues.<id>.source`, a separate parent-child `hierarchy`, preserved dependency/relationship edges, cross-package/external relations, and diagnostics such as dangling relation targets or multiple-parent DAG nodes.

Unknown Beads fields are preserved rather than filtered through a board-audit field whitelist. This keeps the exporter forward-compatible as Beads evolves.

The exporter distinguishes hierarchy from the wider dependency graph. Parent-child structure determines package topology; `blocks`, `related`, `discovered-from` and other relationship data remain represented as relations and are not flattened into a tree.

Structured export emits data only. It intentionally does not embed the large audit prompt.

## Editable round-trip back to local Beads

The round-trip tool consumes the work-package schema above. It does not ask an editor/model to rewrite the immutable source records directly.

Prepare one exported package:

```bash
python3 packages/board-audit/board-audit-roundtrip.py prepare \
  /tmp/board-audit-xtrm/export-.../work-packages/xtrm-123__title.json
```

This creates an `.editable.json` artifact with `desired_issues`. The edit contract is:

```text
issues.<id>.source    immutable base state
desired_issues.<id>   desired Beads state; edit this
```

The base records are SHA-256 checked before compilation. Existing timestamps/provenance fields are protected, comments are append-only, and context-only ancestors are read-only unless explicitly enabled.

This `.editable.json` is the intended single artifact to hand to ChatGPT or another agent. For existing beads, v1 supports the ordinary planning/content surface: title, description, design, acceptance criteria, notes, spec ID, priority, issue type, estimate, external reference, metadata, labels, dependencies/relations, and appended comments. New desired beads may also set an initial status.

Existing assignment/owner, lifecycle status, lease/heartbeat, scheduling, storage-plane/ephemeral, compaction, gate/event and similar operational fields remain present in the lossless source record but are read-only in round-trip v1. This prevents the JSONL import/recovery door from bypassing Beads' stricter claim/lifecycle mutation fences.

Before any mutation, reconcile against current local Beads:

```bash
python3 packages/board-audit/board-audit-roundtrip.py validate package.editable.json
python3 packages/board-audit/board-audit-roundtrip.py diff package.editable.json
```

The reconciler performs:

```text
base (original export)
+ desired (edited artifact)
+ current (fresh bd export --all)
→ merged desired state or explicit conflict
```

Disjoint concurrent changes are retained. If both current and desired changed the same ordinary field differently, compilation stops rather than overwriting one side.

Compile the safe result:

```bash
python3 packages/board-audit/board-audit-roundtrip.py compile-import package.editable.json
# equivalent current compiler surface:
python3 packages/board-audit/board-audit-roundtrip.py compile-apply package.editable.json
```

The generated directory contains:

```text
beads-import.jsonl
changes.json
apply-plan.json
apply.sh
```

`beads-import.jsonl` is native Beads import data. `changes.json` records base/current/desired deltas. `apply-plan.json` records the current snapshot digest and explicit post-import mutations. `apply.sh` performs a Beads dry-run by default and only mutates when called with `--execute`.

Direct guarded apply is also supported:

```bash
python3 packages/board-audit/board-audit-roundtrip.py apply package.editable.json
# dry-run only

python3 packages/board-audit/board-audit-roundtrip.py apply package.editable.json --execute
# mutation + fresh export + intent verification
```

The tool never generates `bd import --allow-stale`. It relies on Beads' import stale/tie protection as a second race guard and verifies the resulting local board after an executed apply.

Beads import has merge/upsert semantics for auxiliary data, so exact removals are compiled separately. Label removals use native `bd update --remove-label`; dependency removals/rewires use native `bd dep remove`/`bd dep add`. Historical comments are never rewritten by the round-trip layer.

Full rationale, safety boundaries, exit semantics and future workflow design are in `ROUNDTRIP.md`.

## Audit mode

The existing audit workflow remains available:

```bash
board-audit
board-audit --epic xtrm-123
board-audit --no-pr
```

Audit mode writes:

```text
/tmp/board-audit-<repo>/
├── audit-bundle-YYYYMMDD.md
├── audit-prompt.md
├── beads.jsonl
├── prs.md
└── current-state.md
```

The Beads corpus in audit mode now also derives from one `bd export --all` snapshot, so whole-board and `--epic` audit paths no longer use different `bd list`/`bd show` acquisition semantics.

Merged PR export retains the historical auto-window: by default PRs are fetched from the oldest selected bead creation date minus seven days, with `BOARD_AUDIT_PR_LIMIT=500` as a GitHub safety cap. Override with:

```bash
BOARD_AUDIT_PR_SINCE=2026-01-01 board-audit
BOARD_AUDIT_PR_LIMIT=1000 board-audit
```

`--no-pr` skips the PR corpus and leaves silent-ship verification to GitHub tool use.

## Design invariants

Beads remains authority; board-audit outputs are projections/edit proposals. One `bd export --all` acquisition feeds an export/audit invocation. No hardcoded issue-count limit is used for Beads acquisition. Original source fields are retained. Arbitrary-depth parent-child hierarchies are supported. Closed ancestors may be carried as context without being counted as selected active work. Cross-package dependencies remain resolvable by ID. Dangling references and DAG multiplicity are diagnostics, not fatal parsing errors. Work-package serialization and ordering are deterministic apart from run-level manifest metadata.

For round-trip mutation, immutable base records are hash checked; current state is freshly acquired; overlapping three-way conflicts are fatal; operational control fields are fenced out of v1 edits; `--allow-stale` is not automatic; issue omission is not deletion; existing comments are append-only; executed apply ends with a fresh export and intent verification.

The Jira direction in `board-audit-to-jira-and-improvements.md` should consume the same canonical work-package schema rather than create another ad-hoc Beads extraction path.

## Installation

Copy or symlink the canonical tools onto PATH:

```bash
mkdir -p ~/bin ~/.local/bin
cp packages/board-audit/board-audit ~/bin/board-audit
cp packages/board-audit/board-audit-roundtrip.py ~/bin/board-audit-roundtrip
chmod +x ~/bin/board-audit ~/bin/board-audit-roundtrip
ln -sf ~/bin/board-audit ~/.local/bin/board-audit
ln -sf ~/bin/board-audit-roundtrip ~/.local/bin/board-audit-roundtrip
```

Then verify:

```bash
board-audit --help
board-audit-roundtrip --help
python3 -m unittest packages/board-audit/tests/test_roundtrip.py
```

## GitHub Actions direction

Do not enable automated mutation yet. After several representative local round-trips, the intended next step is a GitHub Actions pipeline that exports/prepares a package, publishes it as an artifact, validates a proposed edited artifact, records the diff/apply-plan in a PR, and gates actual application behind an authorized runner plus post-apply verification.

If the authoritative Beads database is workstation/VPS-local rather than reconstructible from a fresh checkout, the mutation phase belongs on a constrained self-hosted runner that can reach that database. A GitHub-hosted runner should not be assumed to possess authoritative local Beads state.
