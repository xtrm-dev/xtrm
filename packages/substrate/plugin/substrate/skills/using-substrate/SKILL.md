---
name: using-substrate
description: Substrate durable work doctrine for Claude Code — Issue authority, the live MCP surface, session binding, Journal/Closure/provenance, and compaction continuity.
---

# Using Substrate (Claude-facing)

Substrate owns durable work. This is the Claude half of the shared
`using-substrate` doctrine. The Authority block below is byte-identical to the
Pi skill and is guarded by package tests. Provider tool names differ by design;
provider semantics and authority must not.

Invocation: `/substrate:using-substrate`.

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

## Live Claude MCP surface

The MCP server calls the typed service in-process. It never shells out to `sb`
and never parses terminal output. The stable registration set is:

```text
issue_get       issue_list      issue_claim     issue_update    issue_close
journal_append  journal_read    resume_capsule  provenance
```

Grouped semantics:

- `issue_list` takes `status` (`ready` = dispatchable), `query`, `kind`, and
  `claimedBy` (holder or `me`).
- `issue_claim` is op-discriminated (`claim|renew|release`). `holder` defaults to
  `SUBSTRATE_HOLDER`, else the xt worktree name. Renew before the lease expires.
- `issue_update` changes title, priority or contract. A new revision stales
  readiness; never use it for progress, findings or results.
- `journal_append` writes continuity for every writable kind; `sb help kinds`
  explains them. `result` is the bounded outcome (required for kind `result`),
  `checkpoint` takes the mechanical path. Write a real summary: what changed,
  evidence, next step.
- `journal_read` is mode-discriminated (`latest|since|timeline|show`).
- `issue_close` writes the immutable Closure; cite result and validation refs
  when the outcome is `completed` (the response warns otherwise).
- `provenance` takes exactly one of `ref`, `sessionId`, `activationId`.
- `resume_capsule` derives continuation state from durable records.

Read `tools/list` for machine schemas. Tool text is defined once in
`integrations/tool-surface.ts` and shared with Pi.

## Repository and Project resolution

One global database may contain many Projects. That never makes one Project the
implicit context for another repository.

Project-scoped tools resolve:

```text
explicit project
→ SUBSTRATE_PROJECT
→ initialized repository binding / checkout alias
→ fail closed with `sb init` guidance
```

There is no single-project-cardinality fallback. `sb init` establishes the Git
repository → Project relationship; worktrees share that repository identity.

## Database authority

One store: explicit `dbPath` where a tool exposes it, otherwise
`SUBSTRATE_DB`, otherwise `~/.xtrm/state.db`. The plugin ships no repo-local
`SUBSTRATE_DB` default because that would fork authority away from `sb` and Pi.

## Session binding and resume

`SUBSTRATE_ISSUE_REF` is the canonical process-level issue binding;
`SUBSTRATE_ISSUE` is a compatibility alias. Host-known session, participant, run
and activation identity is enriched into durable execution context where the
runtime knows it. Journal and checkpoint writes fill unstated participant and
activation from `SUBSTRATE_HOLDER` and `SUBSTRATE_ACTIVATION_ID`; explicit
arguments win; unknown values stay absent rather than fabricated.

Resume from the derived Capsule, never from compacted chat.

## Identity

Who you are on the journal resolves as `SUBSTRATE_HOLDER`, else the xt worktree
name (`.xtrm/worktrees/<repo>-xt-<runtime>-<name>`), else nobody. At session
start the plugin exports a worktree-derived name for Bash through
`CLAUDE_ENV_FILE`; MCP tools resolve it themselves. With no identity, journal
entries record no author and the edit gate refuses edits on a claimed Issue:
the plugin warns you, and `sb help identity` explains the fix.

## Plugin lifecycle

```text
SessionStart (every source)  identity, your live claims with TTL and latest handoff, top advisory
SessionStart(compact)        full Resume Capsule: contract, checkpoint, LATEST HANDOFF, claim expiry
PreToolUse Edit|Write        edit gate: deny with the remedy (claim, or export SUBSTRATE_HOLDER)
PreToolUse Bash (git commit) provenance nudge when no dispatch/receipt context exists
PostToolUse sb / MCP tools   advisories for the issues the call touched
Stop                         continuity notice (deduplicated) and end-of-turn advisories;
                             a missing handoff continues the turn once
PreCompact                   mechanical checkpoint first, then a conversation-text summary
PostCompact                  records Claude's compact_summary as a finding
```

A semantic summarizer failure cannot erase the mechanical checkpoint. A storage
failure never blocks Claude's own context-overflow recovery.

## Advisories

Advisories are deterministic nudges computed from durable state (catalogue:
`packages/substrate/docs/advisories.md`): missing identity, claim about to
expire (`issue_claim op renew`), a recorded result that is not closed, a draft
revision under a claim, a checkpoint or handoff that is due, a completed close
with no evidence. You see one line; the agent receives the exact next command.
Each advisory has a per-session cooldown. `SUBSTRATE_ADVISORIES=off` silences
them; gates and CLI errors stay on. With function hooks enabled, the band above
the prompt shows the same claims and TTL (`/substrate status|show|hide`).

## Journal quality

An entry without content is rejected. A summary under eight words or a
placeholder (`done`, `wip`, `ok`, ...) is accepted with a warning: write what
changed, the evidence, and the next step. A summary over 16,000 characters fails
and nothing is written; pass long text with `summaryFile` (CLI:
`--summary-file <path|->`). Text previews mark cuts; `--json` is complete. `sb help kinds` lists the kinds and
the `--semantic` / `--result` shapes; `sb help contract` shows the contract
JSON shape.

## Operation feedback

Mutation results include shared structured feedback (`success`, `noop`,
`warning`, or error at the call boundary). This is presentation metadata over
the same durable service result, not a second authority model.

## Where this plugin lives

Plugin scripts resolve through `${CLAUDE_PLUGIN_ROOT}`, never the consumer
project path. `${CLAUDE_PROJECT_DIR}` is user-project state, not package code.

## Where to read more

- `packages/substrate/docs/claude.md` — exact provider lifecycle and tool map
- `packages/substrate/docs/workflow.md` — end-to-end work lifecycle
- `packages/substrate/docs/provenance-and-closure.md` — evidence and closeout
