# Source Register — Runtime Canonicalization Corpus

> Status: CANONICAL reconciliation artifact (coordinator-owned).
> Frozen: 2026-08-22 · Bead `xtrm-cn8`
> Machine truth: [`source-register.json`](source-register.json) · merge tool: [`merge_register.py`](merge_register.py)
> Lane evidence: [`lanes/`](lanes/) (9 lanes: A programme, B specialists canon, C chain authoring, D harness/experiments, E channels, F substrate, G xtmux supervision, H core/planning, I observability/eval, J reference integrity)

## Freeze-gate summary at freeze time

| Metric | Value |
|---|---|
| TOTAL_FILES | 140 rows / 138 deduplicated assets |
| FULLY_READ | 137 (98%) |
| PARTIAL | 0 |
| UNREAD | 0 |
| UNCLASSIFIED | 0 |
| GENERATED residuals (justified) | 3 — chain_templates.html, channels.html, premortem raw fan-out outputs |
| UNRESOLVED_DUPLICATES | 0 (all duplicates dispositioned in absorption matrix) |
| UNRESOLVED_AUTHORITY_CONFLICTS | 0 at register level; substantive contradictions resolved in [runtime-decision-matrix.md](runtime-decision-matrix.md), 8 non-blocking open questions listed there |

## Repositories audited

| Repo | Path | HEAD at audit | State |
|---|---|---|---|
| xtrm | /home/dawid/dev/xtrm | main `4f6ac48c4e0b` (lanes E/F observed later vault commit `01a1b647298c` — recorded) | clean |
| specialists | /home/dawid/dev/specialists | master `0253e3e4b823` | `.beads.gate.lock*` untracked only |
| core | /home/dawid/dev/core | main `ba3515330b17` | `.xtrm/registry.json` modified |
| xtmux | /home/dawid/dev/xtmux | main `aebb885f4296` | bin/test scripts modified |
| console | /home/dawid/dev/console | main `eb9a1ad2cd3f` | host-retirement work in progress |
| worktree pr71-loader | /home/dawid/dev/xtrm-wt/pr71-loader | `web/full-specialist-json-loader-2026-08-18` @ `818da6553a21` | experiment src has load-bearing uncommitted patches (bd memory) |

Per-file blob SHAs: `source-register.json`. Re-run `python3 merge_register.py` to recompute gate metrics after mutations.
