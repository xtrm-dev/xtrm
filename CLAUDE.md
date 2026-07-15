<!-- xtrm:start -->
# XTRM Agent Workflow

> Full reference: `XTRM-GUIDE.md` | Session manual: `/using-xtrm` skill.
> This is a compact managed block. Use CLI `--help` and skills for details; do not paste full manuals here.

## Session start

1. `bd prime` — load workflow context and active claims.
2. `bd memories <topic>` / `bd recall <key>` — retrieve durable context before answering questions or changing workflow-sensitive code.
3. Catch up on recent work: check handoff/next-session beads, latest `xt report` handoffs, recent merged/closed PRs, and `bd list --status=in_progress`.
4. `bv --robot-triage --format toon` or `bv --robot-next` — choose work when needed. Never run bare `bv`.
5. If board state is unclear, run `/issue-triage` or the robot triage/plan commands before editing.
6. For service/docs/project context, run `/scope` or `/using-service-skills`; note stale/missing service skills before relying on them.
7. `bd ready` / `bd show <id>` / `bd update <id> --claim` — inspect and claim before edits.
8. For non-trivial work, use Claude Code task planning features (TaskCreate/TodoWrite-style when available) before proceeding; keep the plan synchronized with the active bead.

## Operating rules

- Beads is authoritative for ownership, dependencies, memory gates, and closure.
- Claude-local task plans are required for non-trivial/multi-step work but are ephemeral execution tracking only.
- Close beads and satisfy memory ack before commit: `bd remember` when useful, then `bd kv set memory-acked:<id> saved:<key>` or `nothing novel:<reason>`, then `bd close <id> --reason="..."`.
- Ask before destructive, irreversible, production-impacting, or history-rewriting actions.
- Do not ask repetitive “Proceed?” confirmations for normal implementation once scope is clear.

## Essential command surface

Use these as the minimal operational surface; use `--help` for full syntax.

- `bd prime`, `bd ready`, `bd list --status=in_progress`, `bd show <id>`
- `bd update <id> --claim`, `bd remember "<insight>"`, `bd close <id> --reason="..."`
- `bv --robot-triage --format toon`, `bv --robot-next` — never bare `bv`
- `xt report list` / latest report file, `xt update --apply`, `xt end`
- `gh pr list --state merged --limit 5` or equivalent host CLI when PR context matters
- `sp --help`, `sp list` / `specialists list`, `sp ps`, `sp feed <job-id>`, `sp result <job-id>`

## Skill routing

| Need | Use |
|---|---|
| xtrm/beads workflow | `/using-xtrm`; `bd --help`; `xt --help` |
| Specialist orchestration | latest `/using-specialists-*`, prefer `/using-specialists-v3`; check `sp --help` + `sp list` first |
| Service/docs/project context | canonical service-skills skill set: `/scope`, `/using-service-skills` |
| Planning/tests/docs | `/planning`, `/test-planning`, `/sync-docs` |
| Board unclear/backlog messy | `/issue-triage`; `bv --robot-triage --format toon`; `bv --robot-plan` |
| Release/session close | `/releasing`, `/xt-end`, `/session-close-report`, `/xt-merge` |
| Hook/skill work | `/hook-development`, `/skill-creator` |

## Code intelligence and edits

- Before editing an existing function/class/method, run GitNexus impact analysis.
- Warn before proceeding if impact risk is HIGH or CRITICAL.
- For unfamiliar code, query GitNexus execution flows before broad grep-heavy reads.
- Before commit or handoff, run `gitnexus_detect_changes()` to verify affected scope.
- Prefer targeted symbol/file reads and precise edits over whole-tree dumps.

## Quality gates

- Run targeted tests/build/typecheck relevant to changed files.
- Use `structured_return` for tests, builds, linters, type checkers, and package checks.
- Use `process` for long-running servers, watchers, and log tails.
- Fix quality failures before commit.

## Worktree sessions

- `xt claude` — launch Claude Code in a sandboxed worktree.
- `xt end` — close session: commit / push / PR / cleanup when appropriate.
<!-- xtrm:end -->

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
> Snapshot 2026-06-21 — see `docs/_meta/2026-06-21-design-reconciliation.md` for full picture.
- **`unitAI-zadhq`** (specialists) — **P0 BLOCKER**: xtrm monorepo architecture decisions (daemon ownership, state tiers). Gates everything downstream.
- **`unitAI-kj651`** (specialists) — HEAD epic: specialists-runtime cleanup + substrate alignment, 8 phases not yet started (canonical: `specialists/docs/design/roadmap/specialists-roadmap.md`)
- **`60w93.1`** (xtrm) — forensic event contract (contract SHIPPED in specialists; bead tracks remaining nominal work)
- **`eoqxp` / `infra-bnh`** (xtrm) — devops beads (later)
- ~~`xtrm-h9hqg`~~ — closed 2026-05-27 per D25 (bd auto-stage shipped in `xt init`/`xt update`)

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **xtrm** (1871 symbols, 2213 relationships, 29 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/xtrm/context` | Codebase overview, check index freshness |
| `gitnexus://repo/xtrm/clusters` | All functional areas |
| `gitnexus://repo/xtrm/processes` | All execution flows |
| `gitnexus://repo/xtrm/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
