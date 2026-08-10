# board-audit interchange artifacts

This directory is the repository-local interchange surface for `packages/board-audit`.

Generated artifacts live here so they can be reviewed, committed on a branch, pushed to GitHub, and consumed by GitHub-connected agents such as ChatGPT without access to the operator's local filesystem.

Layout:

```text
.xtrm/board-audit/
├── exports/
│   └── export-YYYYMMDDTHHMMSS/
│       ├── raw-beads.jsonl
│       ├── manifest.json
│       └── work-packages/
└── audits/
    └── audit-YYYYMMDDTHHMMSS/
        ├── raw-beads.jsonl
        ├── beads.jsonl
        ├── prs.md
        ├── audit-prompt.md
        ├── current-state.md
        └── audit-bundle.md
```

Beads remains authoritative. These files are snapshots, projections, audit inputs, or desired-state proposals; they are not the Beads database and do not replace Dolt history or backup.

`board-audit` never commits or pushes this directory automatically. To expose a generated work package through GitHub, generate it on a branch and explicitly `git add`, commit, and push the selected artifact. Round-trip mutation remains guarded by `board-audit-roundtrip validate/diff/apply` and requires explicit `--execute` for a real apply.
