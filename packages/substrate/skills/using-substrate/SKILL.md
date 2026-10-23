---
name: using-substrate
description: Substrate durable work doctrine for Claude Code and Pi — Issue authority, the shared nine-tool surface, identity and claims, Journal/Closure/provenance, advisories, and compaction continuity. Use before claiming, journaling, closing or resuming Substrate work.
---

# Using Substrate

Substrate owns durable work. This one skill serves Claude Code, Pi and Codex.
The xt default-skills mechanism (`xt skills`) installs it for every runtime:
the plugin and the Pi package do not ship it. The source lives in
`packages/substrate/skills/using-substrate/SKILL.md`; core vendors it into
`.xtrm/skills/default/using-substrate` pinned to a commit of this repository.

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

## Tools (same on both hosts)

Claude's MCP server and Pi's extension call the typed service in-process. They
never shell out to `sb` and never parse terminal output. Both register the same
nine tools with the same parameters; Pi prefixes each name with `substrate_`
(`issue_get` is `substrate_issue_get` on Pi).

```text
issue_get       issue_list      issue_claim     issue_update    issue_close
journal_append  journal_read    resume_capsule  provenance
```

- `issue_list` takes `status` (`ready` = dispatchable), `query`, `kind`, and
  `claimedBy` (holder or `me`; returns `{holder, issues}` with each claim and
  the latest handoff).
- `issue_claim` is op-discriminated (`claim|renew|release`). `holder` defaults to
  your identity. Renew before the lease expires; a repeated claim does not
  extend it.
- `issue_update` changes title, priority or contract. A new revision stales
  readiness; never use it for progress, findings or results.
- `journal_append` writes every writable kind (`sb help kinds`). `result` is the
  bounded outcome (required for kind `result`); `checkpoint` takes the
  mechanical path.
- `journal_read` is mode-discriminated (`latest|since|timeline|show`) and returns
  full bodies.
- `issue_close` writes the immutable Closure; cite result and validation refs
  when the outcome is `completed` (the response warns otherwise).
- `provenance` takes exactly one of `ref`, `sessionId`, `activationId`.
- `resume_capsule` derives continuation state from durable records.

`<ref>` accepts a machine ID, durable reference, locator, historical locator or
alias. Mutating tools return structured feedback (`success`, `noop`,
`warning`); a failure stays a failure from the typed service. The `sb` CLI
follows the same model; `sb help contract|kinds|identity` hold the shapes.

## Identity

Who you are on the journal resolves as `SUBSTRATE_HOLDER`, else the xt worktree
name (`.xtrm/worktrees/<repo>-xt-<runtime>-<name>`), else nobody.
`XTRM_SESSION_NAME` is never used: tmux panes share it. At session start the
host exports a worktree-derived name for shell children (Claude through
`CLAUDE_ENV_FILE`, Pi into the process environment); the tools resolve it
themselves. With no identity, journal entries record no author and the edit
gate refuses edits on a claimed Issue; the host warns you, and
`sb help identity` explains the fix.

## Repository, Project and database

One global database may contain many Projects. That never makes one Project the
implicit context for another repository. Project-scoped tools resolve:

```text
explicit project
→ SUBSTRATE_PROJECT
→ initialized repository binding / checkout alias
→ fail closed with `sb init` guidance
```

There is no single-project-cardinality fallback. The store is an explicit
`dbPath` where a tool exposes it, else `SUBSTRATE_DB`, else `~/.xtrm/state.db`.
No host ships a repo-local `SUBSTRATE_DB` default.

## Session binding and resume

`SUBSTRATE_ISSUE_REF` is the canonical process-level Issue binding;
`SUBSTRATE_ISSUE` is a compatibility alias only. A successful claim binds the
session to the Issue. Journal and checkpoint writes fill unstated participant
and activation from `SUBSTRATE_HOLDER` and `SUBSTRATE_ACTIVATION_ID`; explicit
arguments win; unknown values stay absent rather than fabricated.

Resume from the derived capsule, never from compacted chat:

```text
current Issue revision + latest checkpoint + LATEST HANDOFF + Journal delta
+ claim (expiry) / blockers + provenance  →  Resume Capsule
```

## Host lifecycle

| Moment | Claude Code (plugin hooks) | Pi (extension events) |
|---|---|---|
| Session start | SessionStart: identity, your live claims with TTL and latest handoff, top advisory | `session_start`: the same content as hidden next-turn context, plus a notification |
| After compaction or resume | SessionStart(compact): the full Resume Capsule in context | notification with the capsule head; `/substrate-resume` prints it in full |
| Edit / write | PreToolUse Edit/Write: deny with the remedy (claim, or export `SUBSTRATE_HOLDER`) | `tool_call` gate: same rule |
| Commit | PreToolUse Bash (`git commit`): provenance nudge | none |
| After an `sb` command or Substrate tool | PostToolUse: advisories for the touched Issues | `tool_result`: advisory appended to the result, operator notified |
| End of turn | Stop: continuity notice; a missing handoff continues the turn once | `agent_end`: a missing handoff triggers one follow-up turn |
| Compaction | PreCompact: mechanical checkpoint, then a summary; PostCompact records `compact_summary` as a finding | `session_before_compact`: mechanical checkpoint, then a summary |
| Status | band above the prompt (function hooks enabled); `/substrate status\|show\|hide` | `substrate` widget |

A summarizer failure cannot erase the mechanical checkpoint. A storage failure
never blocks the host's own context-overflow recovery. With no Issue bound, Pi's
normal compaction is untouched.

## Advisories

Advisories are deterministic nudges computed from durable state (catalogue:
`packages/substrate/docs/advisories.md`): missing identity, a claim about to
expire (`issue_claim op renew`), a recorded result that is not closed, a draft
revision under a claim, a checkpoint or handoff that is due, a completed close
with no evidence. The operator sees one line; the agent receives the exact next
command. Each advisory has a per-session cooldown. `SUBSTRATE_ADVISORIES=off`
silences them; gates and errors stay on.

## Journal and revisions

```text
progress / finding / decision / blocker / milestone / handoff / result
→ Journal

SCOPE / SUCCESS / NON_GOALS / CONSTRAINTS / VALIDATION / OUTPUT changes
→ stop → /planning → new Issue revision → readiness / attestation
```

A meaningful settled outcome is `kind=result`; a progress note is not a result.
An entry without content is rejected. A summary under eight words or a
placeholder (`done`, `wip`, `ok`, ...) is accepted with a warning: write what
changed, the evidence, and the next step. A summary over 16,000 characters
fails and nothing is written; pass long text with `summaryFile` (CLI:
`--summary-file <path|->`) or split it. Text previews mark cuts; `--json` and
`journal_read` return the full text.

## Mutation authority

A session bound to an Issue may edit or write only under its own live claim.
Substrate provides no workspace-exclusion guarantee (XTRM-414): per-issue claim
fencing is the only mutation authority here; workspace exclusion is owned by
the specialists activation layer. Unbound sessions are never implicitly bound
to a random Project or Issue.

## Where to read more

- `packages/substrate/docs/advisories.md` — advisory catalogue and identity
- `packages/substrate/docs/claude.md`, `packages/substrate/docs/pi.md` — provider references
- `packages/substrate/docs/workflow.md` — end-to-end work lifecycle
- `packages/substrate/docs/provenance-and-closure.md` — evidence and closeout
