# board-audit — legacy operational note

This file preserves the provenance of the original board-audit mini manual. The canonical operational documentation is now:

- `packages/board-audit/README.md`
- `packages/board-audit/ROUNDTRIP.md`

The current tool has evolved beyond the original single `/tmp` audit-bundle workflow. It now provides a lossless structured Beads work-package export and a guarded round-trip reconciler in addition to the historical audit bundle.

User-visible artifacts default to the repository-local interchange tree:

```text
.xtrm/board-audit/
├── exports/
└── audits/
```

This placement is intentional so a selected export/edit artifact can be committed and pushed on a branch and then read by GitHub-connected agents. `board-audit` itself never commits or pushes generated artifacts automatically.

Typical structured handoff:

```bash
board-audit --export --epic xtrm-123
board-audit-roundtrip prepare \
  .xtrm/board-audit/exports/export-.../work-packages/xtrm-123__title.json

git add .xtrm/board-audit/
git commit -m "chore(board-audit): prepare xtrm-123 handoff"
git push -u origin HEAD
```

For the complete schema, concurrency rules, mutation fences, comment provenance handling, dependency reconciliation, dry-run/apply semantics and GitHub Actions direction, use the canonical manuals above.

## Origin

The original tool was extracted from the 2026-07-22 infra ChatGPT audit workstream and was initially designed to export local `bd` state plus relevant merged PRs into a ChatGPT-web-friendly audit bundle. That historical workflow remains available as `board-audit`, but its output is now versionable under `.xtrm/board-audit/audits/` rather than `/tmp`.
