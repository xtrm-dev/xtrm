# xtrm-app documentation map

Current product-definition and migration documents:

- `xtrm-gui-prd.md` — canonical product PRD.
- `console-v2-migration-plan.md` — base Console v2 migration architecture and implementation sequencing.
- `console-v2-shell-architecture.md` — Console v2 shell, double-sidebar and Inspector Drawer architecture.
- `adoption-audit.md` — adoption policy, external implementation references, and the 2026-09-12 base-UI dependency decisions.
- `external-reference-audit-scope.md` — current Conar + DeepSeek Harness audit scope.
- `console-v2-local-audit-dispatch.md` — bounded local research dispatch for the current audit.
- `implementation-packet.md` — implementation guidance/payload.
- `local-worker-dispatch.md` — earlier implementation dispatch; treat as historical sequencing where it conflicts with the newer migration plan.

Pinned audit artifacts (2026-09-12 local audit round):

- `console-v2-audit-console-v1-preservation.md` — Console v1 shell/repository/GitHub preservation matrix, defect register, cutover hazards, test baseline.
- `console-v2-audit-substrate-issues-contract.md` — Substrate typed-service contract, read-projection gaps, Beads migration classification.
- `console-v2-audit-conar-ui.md` — Conar UI craftsmanship audit; shell verdict, primitive matrix, licensing.
- `console-v2-audit-deepseek-harness.md` — DeepSeek Harness architecture/adoption matrix; Agent/Frames compatibility.
- `console-v2-audit-console-program-graph-drawer.md` — Console v1 Beads materializer, drawer, Program, Graph, Observability, Specialists.
- `console-v2-audit-context.md` — operator-approved product boundary for this audit round.

Portfolio tracking: Jira `ISSUE-140`.

The immediate priority is base Console v2 UI/migration: repository + GitHub preservation, Substrate Issues, global Inspector Drawer, Program/governance, and shell-level Graph/Observability. Full Agent/Frames runtime implementation is a later scoped tranche.
