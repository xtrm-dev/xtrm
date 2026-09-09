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

# LANGUAGE
Use controlled, precise, and direct language in all agent communication, including planning, analysis, status updates, explanations, reviews, decisions, handoffs, tickets, and final responses. Prefer explicit subjects, active voice, consistent terminology, concrete statements, and short, well-structured sentences, but do not make normal discussion unnaturally procedural or repetitive. Adapt the level of rigor to the task: use clear and natural technical prose for reasoning, design discussion, and collaboration; use stricter ASD-STE100-oriented language for procedures, commands, operational changes, safety constraints, destructive actions, rollback steps, acceptance criteria, and instructions that another agent or operator must execute. In rigorous contexts, state conditions before actions, express one principal action per sentence, identify the responsible actor, preserve the exact order of operations, and repeat technical nouns when pronouns could be ambiguous. Clearly distinguish verified facts, assumptions, inferences, recommendations, and unresolved questions. Do not use vague qualifiers, ornamental language, conversational filler, exaggerated certainty, or unnecessary jargon. Do not omit technical nuance, risks, dependencies, failure behavior, ownership, or verification requirements for the sake of brevity.

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
8. If the runtime supports local task planning, use it before non-trivial work and keep it synchronized with the active issue.

## Operating rules

- Substrate is authoritative for ownership, dependencies, claims, journal continuity, and closure.
- Runtime-local task plans are ephemeral execution tracking only; they do not replace Substrate.
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

## Code intelligence and edits

- Before editing an existing function/class/method, run GitNexus impact analysis when GitNexus is available.
- Warn before proceeding if impact risk is HIGH or CRITICAL.
- For unfamiliar code, inspect execution flows before broad grep-heavy reads.
- Before commit or handoff, verify affected scope.
- Prefer targeted symbol/file reads and precise edits over whole-tree dumps.

## Quality gates

- Run targeted tests/build/typecheck relevant to changed files.
- Use background process tooling for long-running servers, watchers, and log tails.
- Fix quality failures before commit.

## Worktree sessions

- `xt pi` — launch Pi in a sandboxed worktree.
- `xt end` — close session: commit / push / PR / cleanup when appropriate.
<!-- xtrm:end -->

# Agent Instructions

This project uses **Substrate (`sb`)** for durable work. Run `sb issue ready` for available work and `sb issue resume <ref>` for continuity.

> **Architecture in one line:** Issues live in SQLite/WAL (`~/.xtrm/state.db`);
> `sb` CLI, Pi extension, and Claude plugin consume the typed service — never
> `exec("sb …")`, never CLI-text parsing. Historical Beads IDs resolve as
> aliases; `sb import beads` migrates boards without dual-write.

## Quick Reference

```bash
sb issue ready          # Find dispatchable work
sb issue show <ref>     # View issue + readiness + claim
sb issue claim <ref> --holder <name>  # Claim work atomically
sb issue close <ref>    # Complete work
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN SUBSTRATE INTEGRATION v:1 profile:minimal (Phase 11 cutover: replaces the Beads block; bd is read/import compatibility only) -->
## Substrate Issue Tracker

This project uses **Substrate (`sb`)** for durable work. Run `sb issue ready` for available work and `sb issue resume <ref>` for continuity.

### Quick Reference

```bash
sb issue ready          # Find dispatchable work
sb issue show <ref>     # View issue + readiness + claim
sb issue claim <ref> --holder <name>  # Claim work
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

<!-- BEGIN SUBSTRATE CODEX SETUP: Phase 11 cutover (replaces the bd codex block; hook mechanics in .codex/hooks.json stay bd-compat until an sb hook-protocol adapter lands — no new Substrate features in this phase) -->
## Substrate Issue Tracker

Use Substrate (`sb`) for durable work tracking. Use the `using-substrate` skill at `packages/substrate/skills/using-substrate/SKILL.md` for workflow guidance, then use the `sb` CLI for issue operations. The `beads` skill at `.agents/skills/beads/SKILL.md` is read/import compatibility only.

### Quick Reference

```bash
sb issue ready            # Find dispatchable work
sb issue show <ref>       # View issue + readiness + claim
sb issue claim <ref> --holder <name>  # Claim work
sb issue close <ref>      # Complete work
sb issue resume <ref>     # Continuity capsule
```

### Rules

- Use `sb` for all durable work tracking; do not create markdown TODO lists as durable records.
- Use `sb issue resume` when Codex context is missing or stale.
- Journal entries are continuity, not memory; do not create ad hoc memory files.

**Architecture in one line:** issues live in SQLite/WAL; historical Beads IDs resolve as aliases; `sb import beads` migrates boards without dual-write.
<!-- END SUBSTRATE CODEX SETUP -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **xtrm** (1301 symbols, 1304 relationships, 0 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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

<!-- specialists:start -->
## Specialists

Use CLI commands via Bash to run and monitor specialists:

Core specialist commands (CLI-first in pi):
- `specialists list`
- `specialists run <name> --bead <id>`
- `specialists run <name> --prompt "..."`
- `specialists feed -f` / `specialists feed <job-id>`
- `specialists result <job-id>`
- `specialists resume <job-id> "next task"` (for keep-alive jobs in waiting)
- `specialists stop <job-id>`

For background specialists in pi, prefer the process extension:
- `process start`, `process list`, `process output`, `process logs`, `process kill`, `process clear`
- TUI: `/ps`, `/ps:pin`, `/ps:logs`, `/ps:kill`, `/ps:clear`, `/ps:dock`, `/ps:settings`

Canonical tracked flow:
1. Create/claim bead issue
2. Run specialist with `--bead <id>` (for long work, launch via `process start`)
3. Observe progress (`process output` / `process logs` or `specialists feed`)
4. Read final output (`specialists result <job-id>`)
5. Close/update bead with outcome

Add custom specialists to `.specialists/user/` to extend defaults.
<!-- specialists:end -->
