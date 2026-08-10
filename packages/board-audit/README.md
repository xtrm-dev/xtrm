# board-audit — install & operational manual

`board-audit` has two deliberately separate surfaces:

1. an audit workflow that exports Beads plus relevant merged PRs into a ChatGPT-web-friendly bundle;
2. a structured Beads export workflow that produces lossless, deterministic work-package JSON without audit instructions.

The canonical executable is `packages/board-audit/board-audit`.

## Prerequisites

`bd` (Beads), `python3`, and a Git working tree are required for structured export. Audit mode additionally requires authenticated `gh`.

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

### Export all non-terminal work

```bash
board-audit --export --open
```

`--open` means non-terminal work, not only literal `status=open`. Active statuses such as `in_progress` and `blocked` remain included. Closed ancestors required to understand the hierarchy are retained as `context-only` records.

### Export the full board

```bash
board-audit --export --all
```

### Export one epic/subtree

```bash
board-audit --export --epic xtrm-123
```

### Export one bead/subtree

```bash
board-audit --export --bead xtrm-456
```

A task with children is treated as a work package even when its issue type is not `epic`.

### Structured output

Each invocation creates a timestamped directory under:

```text
/tmp/board-audit-<repo>/export-YYYYMMDDTHHMMSS/
├── raw-beads.jsonl
├── manifest.json
└── work-packages/
    ├── <root-id>__<slug-title>.json
    └── ...
```

`raw-beads.jsonl` is the direct Beads source snapshot. It is retained so the normalized projection never becomes a replacement source of truth.

`manifest.json` records repository, Beads version, source command, raw SHA-256, record counts, selection scope, work-package filenames and package content digests. It also reports unknown parent references and any selected records that could not be packaged.

Each work-package file uses schema `xtrm.board-audit.work-package.v1`. It contains the root identity, all source issue records losslessly under `issues.<id>.source`, a separate parent-child `hierarchy`, preserved dependency/relationship edges, cross-package/external relations, and diagnostics such as dangling relation targets or multiple-parent DAG nodes.

Unknown Beads fields are preserved rather than filtered through a board-audit field whitelist. This keeps the exporter forward-compatible as Beads evolves.

The exporter distinguishes hierarchy from the wider dependency graph. Parent-child structure determines package topology; `blocks`, `related`, `discovered-from` and other relationship data remain represented as relations and are not flattened into a tree.

Structured export emits data only. It intentionally does not embed the large audit prompt.

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

The source snapshot is Beads authority; board-audit outputs are projections. One `bd export --all` acquisition feeds an invocation. No hardcoded issue-count limit is used for Beads acquisition. Original source fields are retained. Arbitrary-depth parent-child hierarchies are supported. Closed ancestors may be carried as context without being counted as selected active work. Cross-package dependencies remain resolvable by ID. Dangling references and DAG multiplicity are diagnostics, not fatal parsing errors. Work-package serialization and ordering are deterministic apart from run-level manifest metadata such as generation time.

The Jira/import direction described in `board-audit-to-jira-and-improvements.md` should consume the canonical work-package schema in a later change rather than create another ad-hoc Beads extraction path.

## Installation

Copy or symlink the canonical script onto PATH:

```bash
mkdir -p ~/bin ~/.local/bin
cp packages/board-audit/board-audit ~/bin/board-audit
chmod +x ~/bin/board-audit
ln -sf ~/bin/board-audit ~/.local/bin/board-audit
```

Then verify:

```bash
board-audit --help
```
