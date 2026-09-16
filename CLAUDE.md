<!-- BEGIN INJECTED BLOCK -->
## Communication Style

Use controlled, precise, and direct language throughout the work session, including plans, progress updates, analysis, reviews, implementation notes, documentation, handoffs, and final reports. Prefer explicit subjects, active voice, consistent terminology, concrete statements, and logically ordered sentences. Keep the writing natural and concise. Avoid conversational filler, ornamental language, vague qualifiers, unnecessary jargon, and exaggerated certainty.

Adapt the level of rigor to the context. Use clear technical prose for analysis, architecture, debugging, design discussion, and collaboration. Use a stricter ASD-STE100-oriented style for procedures, commands, migrations, deployments, security requirements, destructive operations, rollback instructions, acceptance criteria, and operator handoffs. In these cases, state conditions before actions, identify the responsible actor, express one principal action per sentence, preserve the required sequence, and describe expected results and failure conditions explicitly.

Clearly distinguish verified facts, observations, assumptions, inferences, recommendations, and unresolved questions. Do not report an action as successful without evidence. Preserve exact names for repositories, services, contracts, routes, identifiers, configuration fields, and work items. Do not omit material ownership, dependencies, risks, preconditions, rollback requirements, or verification criteria for the sake of brevity.

## Task Tracking (two-tier)

Two task systems coexist in this repo. Use both; do not substitute one for the other.

- **Substrate (`sb`)** — top-level durable work authority. Owns issues, claims, journal continuity, and provenance. Read the rest of this file and run `sb issue ready` / `sb issue resume` for work context before starting work. Inspect, claim, and close work here. Historical Beads IDs resolve as aliases; `bd` is read/import compatibility only.
- **Native integrated task system** (`TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate` / `TaskExecute`) — this-session execution tracking. Use it to mirror the active issue and break it into smaller intermediate steps. Ephemeral; does not replace Substrate.

Rule: when you pick up an issue, create native tasks that track it — reference the issue ref in each task title (e.g. `XTRM-227 summary — status (worker %NNNN)`) — and add any smaller intermediate steps as native sub-tasks. Substrate owns the durable record; native tasks own the in-flight breakdown.

Example native task list mirroring Substrate:
- ◼ XTRM-227 smoke container global surface — BLOCKS RELEASE (worker %NNNN)
- ◼ XTRM-228 status test flake under load (worker %NNNN)
- ◻ Pre-release smoke run against current main branches
- ◻ Dispatch XTRM-229 stale doc metrics + XTRM-230 Claude inbox surface
- ◻ Dispatch XTRM-231, XTRM-232, XTRM-233 remaining small issues
<!-- END INJECTED BLOCK -->

<!-- xtrm:start -->
# XTRM Agent Workflow

> Full reference: `XTRM-GUIDE.md` | Session manual: `/using-xtrm` skill.
> This is a compact managed block. Use CLI `--help` and skills for details; do not paste full manuals here.

## Session start

1. `sb issue ready` / `sb issue resume <ref>` — load workflow context, active claims, and journal continuity.
2. `sb journal since <ref> <cursor>` — read only what changed since the last checkpoint; the journal is continuity, not memory.
3. Catch up on recent work: check handoff/next-session issues, latest `xt report` handoffs, recent merged/closed PRs, and `sb issue ready`.
4. `bv --robot-triage --format toon` or `bv --robot-next` — choose work when needed. Never run bare `bv`.
5. If board state is unclear, run `/issue-triage` or the robot triage/plan commands before editing.
6. For service/docs/project context, run `/scope` or `/using-service-skills`; note stale/missing service skills before relying on them.
7. `sb issue show <ref>` / `sb issue claim <ref> --holder <name>` — inspect and claim before edits. Never implement from a title + description issue: repair the contract first.
8. For non-trivial work, use Claude Code task planning features (TaskCreate/TodoWrite-style when available) before proceeding; keep the plan synchronized with the active issue.

## Operating rules

- Substrate is authoritative for ownership, dependencies, claims, journal continuity, and closure.
- Claude-local task plans are required for non-trivial/multi-step work but are ephemeral execution tracking only.
- Close issues before commit: `sb issue close <ref>` after validation and provenance are recorded.
- Ask before destructive, irreversible, production-impacting, or history-rewriting actions.
- Do not ask repetitive “Proceed?” confirmations for normal implementation once scope is clear.

## Essential command surface

Use these as the minimal operational surface; use `--help` for full syntax.

- `sb issue ready`, `sb issue list --project <id>`, `sb issue show <ref>`
- `sb issue claim <ref> --holder <name>`, `sb issue close <ref>`, `sb issue resume <ref>`
- `bv --robot-triage --format toon`, `bv --robot-next` — never bare `bv`
- `xt report list` / latest report file, `xt update --apply`, `xt end`
- `gh pr list --state merged --limit 5` or equivalent host CLI when PR context matters
- `sp --help`, `sp list` / `specialists list`, `sp ps`, `sp feed <job-id>`, `sp result <job-id>`

## Skill routing

| Need | Use |
|---|---|
| Substrate workflow | `/using-substrate`; `sb --help`; `xt --help` |
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

# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN SUBSTRATE INTEGRATION v:1 profile:minimal (Phase 11 cutover: replaces the Beads block; bd is read/import compatibility only) -->
## Substrate Issue Tracker

This project uses **Substrate (`sb`)** for durable work. Run `sb issue ready` for available work and `sb issue resume <ref>` for continuity.

### Quick Reference

```bash
sb issue ready          # Find dispatchable work
sb issue show <ref>     # View issue + readiness + claim
sb issue claim <ref> --holder <name>  # Claim work atomically
sb issue close <ref>    # Complete work
```

### Rules

- Use `sb` for ALL durable work tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists as durable records
- Never implement from a title + description issue; repair the contract first
- Use resume capsules and journal cursors for continuity — do NOT maintain ad-hoc Markdown handoffs

**Architecture in one line:** issues live in SQLite/WAL (`~/.xtrm/state.db`); `sb` CLI, Pi extension, and Claude plugin consume the typed service; historical Beads IDs resolve as aliases; `sb import beads` migrates boards without dual-write.

## Agent Context Profiles

The managed Substrate block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `sb` for work tracking. Do not run git commits or git pushes unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `sb --help`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close issues, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Substrate-tracked implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create Substrate issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Substrate block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END SUBSTRATE INTEGRATION -->


## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **xtrm** (16064 symbols, 36219 relationships, 707 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/xtrm/context` | Codebase overview, check index freshness |
| `gitnexus://repo/xtrm/clusters` | All functional areas |
| `gitnexus://repo/xtrm/processes` | All execution flows |
| `gitnexus://repo/xtrm/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
