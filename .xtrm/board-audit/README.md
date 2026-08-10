# board-audit interchange artifacts

This directory is the repository-local interchange surface for `packages/board-audit`.

Beads/Dolt remains authoritative. Files here are snapshots, projections, audit inputs, desired-state proposals, and transport metadata; they are not the Beads database.

## Normal UX

```bash
board-audit handoff <bead-id>
# ChatGPT/human edits the remote transport artifact
board-audit reconcile <bead-id>
board-audit reconcile <bead-id> --execute
```

`handoff` and `reconcile` use isolated worktrees created with `bd worktree create`. Beads worktrees automatically share the same authoritative database through Git common-directory discovery. The caller's current checkout is never switched.

The durable transport branch is:

```text
board-audit/<bead-id>
```

The local staging branch/worktree used to construct or consume that transport branch is temporary and is removed after a successful command.

## Layout

```text
.xtrm/board-audit/
├── index.json
├── exports/
│   └── export-YYYYMMDDTHHMMSS/
│       ├── raw-beads.jsonl
│       ├── manifest.json
│       └── work-packages/
│           ├── <root>__<title>.json
│           └── <root>__<title>.editable.json
└── audits/
    └── audit-YYYYMMDDTHHMMSS/
        ├── raw-beads.jsonl
        ├── beads.jsonl
        ├── prs.md
        ├── audit-prompt.md
        ├── current-state.md
        └── audit-bundle.md
```

`index.json` uses schema `xtrm.board-audit.index.v1` and is the stable pointer from a bead/root ID to its latest export and editable artifact. Normal consumers should use the index rather than discover timestamped paths manually.

## Mutation boundary

`board-audit handoff` may commit/push only interchange artifacts on the transport branch. It never mutates Beads.

`board-audit reconcile <id>` fetches the remote desired artifact, validates it, performs a fresh three-way reconciliation and runs the apply path in dry-run mode.

Only:

```bash
board-audit reconcile <id> --execute
```

may mutate Beads, and it retains the round-trip engine's dry-run, stale-write, dependency-cycle and post-apply verification fences.

Low-level manual export/prepare/reconcile commands remain available for debugging and CI; see `packages/board-audit/README.md` and `ROUNDTRIP.md`.
