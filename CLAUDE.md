# Memory

> Working memory for the **xtrm** project. Bootstrapped from the repo + vault on 2026-06-11.
> Deep notes live in `memory/`. Keep this file tight (~80 lines); push detail down into `memory/`.

## Me
Dawid — product / operator on **xtrm**, the closed-source umbrella monorepo for the xtrm product family.
"Operator" running ~10 repos in parallel during the pre-substrate window, with **one collaborator**.
Also owns **Mercury**, a separate market-data product **that xtrm is being tested on** (xtrm is
dogfooded against Mercury's real work/repos).

## Working style
- **Bilingual IT/EN.** Design notes are often written in Italian; I read both. Match the language I write in.
- **SSOT discipline.** A doc is canonical in *exactly one* home. Rule: owned by one package and code
  implements against it → **repo**; cross-cutting / in deliberation / spans repos → **vault** (Obsidian).
- Terse, desk-style output preferred. Decisions get logged; "stale" docs get marked, not silently kept.

## The product — four+ systems
xtrm = a daemon-backed agent/work orchestration system. Packages hard-import `@xtrm/core` for `StateClient`
and talk to the daemon over a Unix socket — they **never** open `state.db` directly.

| Package / system | CLI | Role |
|---|---|---|
| `packages/core` | **`xt`** | daemon + state engine + `state.db` + Unix socket protocol; bootstrap/worktree/install/update |
| `packages/substrate` | **`sb`** | domain layer: issues, containers, plans, collisions, validator, memory |
| `packages/channels` | — | cross-container channel primitives |
| `packages/specialists` | **`sp`** | specialist runtime (agents that do work) |
| `apps/console` | — | xt-console (gitboard descendant) + materializer |
| devops | — | cross-cutting (xt+sp+sb), **not** a 6th package; lands much later |
| telemetry/forensic | — | `xtrm.forensic.v1` event envelope; forensic event contract |

Current state: `packages/`, `apps/`, `data/` are empty scaffolding. Real content lives in the `xtrm/`
Obsidian vault (design docs, research, roadmap). Mid-migration from upstream repos (`specialists`,
`xtrm-tools`, …) via `git filter-repo` grafts. On `main`, v0.1.0.

## Terms (quick ref — full list in memory/glossary.md)
| Term | Meaning |
|---|---|
| operator | The human (Dawid) — accepts/steers work, makes decisions by hand |
| substrate | Domain layer (`sb`); the big upcoming foundation. "Pre-substrate" = now. |
| chain / chain-template | Multi-step work unit; templates live as `.formula.json` (15+ canonical in repo) |
| beads / `bd` | Task tracker **for agent/robot work**. IDs like `xtrm-h9hqg`, `kj651`, `60w93.1` |
| Jira | Task tracker **for human work** (mine + my collaborator's). Separate from beads. |
| shepherd / tether | Always-on sidecar that force-injects context/memories into a specialist's next turn |
| reviewer / runner / coordinator / mailbox / supervisor | Specialist-runtime roles |
| GitNexus | Code-intelligence layer (impact graphs, related-symbol graphs) |
| vault | The `xtrm/` Obsidian vault — deliberation/cross-repo thinking space |
| MOC | Map of Content — `xtrm/xtrm-MOC.md`, the design-surface index |
| ordine | The decision log |

## Active work (agent work → beads; human work → Jira. see memory/projects/xtrm.md)
- **`xtrm-h9hqg`** — P0, IN_PROGRESS: bd auto-stage config flip + pre-commit shim (B-A1/A2/A3)
- **`kj651`** — specialists-runtime cleanup + substrate alignment (canonical: `repo:specialists-roadmap.md`)
- **`60w93.1`** — create forensic event contract → forensic v0
- **`eoqxp` / `infra-bnh`** — devops beads (later)

## Stack / conventions
- Bun ≥ 1.0, pnpm workspaces, TypeScript. GitHub org **`xtrm-dev`** (teams: `core-team`, `console-team`,
  `specialists-team`, …). `gh` CLI for PR/issue flow. 2FA expected.
- See `CONTRIBUTING.md` for branching/PR/house-style; `SECURITY.md` for policy.

## Preferences
- When unsure whether a doc is canonical, check the MOC (`xtrm/xtrm-MOC.md`) first.
- Flag duplicated/stale docs rather than guessing which is authoritative.
- Keep PM artifacts (specs, roadmaps, updates) consistent with the SSOT rule above.
