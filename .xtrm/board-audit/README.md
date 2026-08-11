# board-audit interchange artifacts

This directory is the repository-local interchange surface for `packages/board-audit`.

Beads/Dolt remains authoritative. Files here are snapshots, projections, audit inputs, desired-state proposals and transport metadata; they are not the Beads database.

## Normal UX

```bash
board-audit handoff <bead-id>
# ChatGPT/human edits the remote desired-state artifact
board-audit reconcile <bead-id>
board-audit reconcile <bead-id> --execute
```

`handoff` and `reconcile` use isolated worktrees created with `bd worktree create`. Beads worktrees share the same authoritative database through Git common-directory discovery. The caller's current checkout is never switched.

The durable remote transport branch is:

```text
board-audit/<bead-id>
```

The transport branch is artifact-only. On a repeat handoff it is rebuilt from the current remote default branch, previous `.xtrm/board-audit/**` artifacts are restored, and the remote branch is rewritten with an exact `--force-with-lease` tied to the SHA observed after fetch. Concurrent remote edits therefore fail the lease rather than being overwritten.

`handoff` deliberately force-stages only its explicit `.xtrm/board-audit/**` artifact paths. Therefore an owning repository may ignore `.xtrm/` wholesale; it does **not** need a `.gitignore` exception merely to use board-audit. The force-stage path guard fails closed if any requested path escapes `.xtrm/board-audit/**`.

The local staging branch/worktree is temporary and is removed after a successful command. On failure it is retained and printed for recovery.

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

Typical index states:

```text
prepared  remote editable exists and may be reconciled
applied   execute completed and post-apply verification succeeded
```

Successful execution also records `applied_at`.

## Mutation boundary

`board-audit handoff` may commit/push only interchange artifacts on the transport branch. It never mutates Beads.

`board-audit reconcile <id>` fetches the remote desired artifact, validates immutable source hashes and the edit contract, performs a fresh three-way reconciliation and runs the apply path in dry-run mode.

Only:

```bash
board-audit reconcile <id> --execute
```

may mutate Beads. It repeats fresh reconciliation, performs the real issue upsert and native dependency/comment operations, checks newly introduced dependency cycles, re-exports current Beads and verifies the intended delta before marking the index `applied`.

Low-level manual export/prepare/reconcile commands remain available for debugging and CI; see `packages/board-audit/README.md` and `packages/board-audit/ROUNDTRIP.md`.
