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
8. If the runtime supports local task planning, use it before non-trivial work and keep it synchronized with the active bead.

## Operating rules

- Beads is authoritative for ownership, dependencies, memory gates, and closure.
- Runtime-local task plans are ephemeral execution tracking only; they do not replace beads.
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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **xtrm** (1968 symbols, 2309 relationships, 29 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
