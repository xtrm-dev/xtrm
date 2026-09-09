---
name: using-substrate
description: Substrate durable work doctrine for Claude Code — issue authority, the MCP tool surface, session binding, and the compaction contract. Use when work must be tracked, resumed after compaction, claimed, checkpointed, or handed off.
---

# Using Substrate (Claude-facing)

Substrate owns durable work. This skill is the Claude half of the shared
`using-substrate` doctrine; the Pi half lives at
`packages/substrate/skills/using-substrate/SKILL.md`. The Authority block below
is the shared source and is byte-identical in both files —
`packages/substrate/tests/plugin-packaging.test.ts` fails if they drift. Edit
the Pi file, then mirror; never fork the doctrine.

Invocation name: this ships as a plugin skill, so it is always namespaced —
`/substrate:using-substrate`.

## Authority (non-negotiable)

```text
Substrate owns durable work.

A ready Issue is an executable contract. Never begin implementation from a
title + description issue.

Never use hidden prompt prose to make an ambiguous Issue executable. If the
contract is insufficient, stop execution and repair the Issue through
/planning — a new revision plus readiness attestation — then dispatch.

Messages coordinate. They never silently change SCOPE, SUCCESS, NON_GOALS,
CONSTRAINTS, VALIDATION, OUTPUT, or SCRUTINY.

The Journal is continuity, not authority. Journal != memory: findings may
become memory candidates at closeout, never reusable truth by themselves.

Executor output never self-certifies provenance. Checkpoints record what the
host observed; the service validates shapes fail-closed.
```

## Tool surface

The MCP server calls the typed service in-process. It never execs `sb` and
never parses CLI text.

```text
issue_get <ref>          summary + readiness state
issue_list [project]     project issues (explicit, SUBSTRATE_PROJECT, or single-project default)
issue_ready [project]    dispatchable-ready issues
journal_append <ref>     finding/decision/handoff/milestone/blocker (+ kind/summary/sessionId)
journal_show <ref>       journal entries, full bodies (+ limit)
provenance_trace <ref>   full trace: bindings, receipts with artifacts, attestation, claims
resume_capsule <ref>     capsule + rendering
```

`tools/list` returns them in that order and it is stable — deterministic
ordering is a protocol requirement, not a courtesy, because clients cache the
list and prompt caches key on it.

`<ref>` accepts all five forms: machine ID (`iss_…`), durable reference
(`XTRM-227`), current locator (`XTRM-184.2.3`), historical locator, alias.

Tool names differ from the Pi half by design: the Pi surface uses
`substrate_`-prefixed names in its own namespace, and Claude reaches these
through the MCP server. Read `tools/list` rather than assuming a name from the
Pi doctrine.

## Database authority

One store, resolved as explicit override, else `SUBSTRATE_DB`, else
`~/.xtrm/state.db`. The plugin ships **no** `SUBSTRATE_DB` default: a
repo-local database would fork the canonical store and break row agreement
between `sb`, Pi and Claude.

## Session binding and resume

- Claiming with the session id binds the session to the issue. `SUBSTRATE_ISSUE_REF`
  rebinds a fresh process to the same ref (the Pi half names this variable
  differently; read the Authority block, not the name, as the contract).
- `resume_capsule` prints the capsule for the bound issue. A later
  session resumes from the capsule, never from compacted chat.

## Compaction contract

Claude exposes compaction as hook processes, so the lifecycle runs as three
command hooks that the plugin registers:

```text
PreCompact              mechanical checkpoint FIRST (durable even if the rest
                        fails), then the bounded semantic shape
PostCompact             record that compaction happened
SessionStart(compact)   surface the capsule head as additionalContext
```

Failure behaviour:

```text
semantic model fails  → mechanical row stays durable, host default proceeds
SQLite write fails    → never block compaction; reconcile later
no bound issue        → handler returns; Claude's default compaction untouched
```

## Where this plugin lives

Scripts resolve through `${CLAUDE_PLUGIN_ROOT}`, never
`${CLAUDE_PROJECT_DIR}/packages/substrate/...`, so the plugin works from any
install location. `${CLAUDE_PROJECT_DIR}` refers to user-project state only.
