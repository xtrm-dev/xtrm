# Memory

> Working memory for the **xtrm** project. Bootstrapped from the repo + vault on 2026-06-11.
> Deep notes live in `memory/`. Keep this file tight (~80 lines); push detail down into `memory/`.

## Me
Dawid — product / operator on **xtrm**, the closed-source umbrella monorepo for the xtrm product family.
"Operator" running ~10 repos in parallel during the pre-substrate window, with **one collaborator**
(**Federico Della Savia**, "rico").
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

Current state: `packages/`, `apps/`, `data/` are empty scaffolding. Real content lives in the `docs/`
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
| vault | The `docs/` Obsidian vault — deliberation/cross-repo thinking space |
| MOC | Map of Content — `docs/xtrm-MOC.md`, the design-surface index |
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
- When unsure whether a doc is canonical, check the MOC (`docs/xtrm-MOC.md`) first.
- Flag duplicated/stale docs rather than guessing which is authoritative.
- Keep PM artifacts (specs, roadmaps, updates) consistent with the SSOT rule above.

## Working norms — approval & agent activity (IMPORTANT)
- **Jira is human-managed.** Agents tend to overdo it, so default to **read-only** on Jira.
- I may **propose** Jira changes (new issues, edits, transitions, comments) — but **never create or
  modify anything in Jira without my explicit approval.** Propose → I approve → then act.
- **Agent/automated activity only when I explicitly ask for it**, not by default. You can suggest it;
  I decide. This applies to spawning agent work, beads, runs, etc.
- Jira account: Dawid Jagger (jagger.xtrm@gmail.com), locale IT. Site `xtrmxt.atlassian.net`,
  cloudId `ef32e587-9bef-4079-9c6b-be7f7e49b041`, project **KAN** (the real board). Statuses in IT
  (Da completare / In corso / In revisione). `IMPDI` project = Jira demo data, ignore.
