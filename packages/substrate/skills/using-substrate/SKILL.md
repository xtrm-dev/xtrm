# Using Substrate (Pi-facing)

Substrate owns durable work. This is the Pi half of the shared
`using-substrate` doctrine. Provider tool names differ intentionally from the
Claude MCP surface; semantics and authority must not.

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

## Live Pi surface

The extension calls the typed service directly — never `exec("sb …")`, never
CLI-text parsing:

```text
substrate_issue_get <ref>            contract + readiness + claim + attestation
substrate_issue_list                 status|query|kind filters; claimedBy=me
substrate_issue_claim <ref>          op claim|renew|release; holder defaults to identity
substrate_issue_update <ref>         title, priority or contract (no-op if identical)
substrate_issue_close <ref>          outcome + reason + evidence refs
substrate_journal_append <ref>       any writable kind; summary required; checkpoint = mechanical
substrate_journal_read <ref>         mode latest|since|timeline|show, full bodies
substrate_resume_capsule <ref>       bounded Resume Capsule
substrate_provenance                 one of ref|sessionId|activationId
```

`<ref>` accepts machine ID, durable reference, current locator, historical
locator, or alias. Every mutating tool (`substrate_issue_claim`, `_update`, `_close`, `_journal_append`) returns structured success/no-op/warning feedback; a
failure remains a failure from the typed service rather than a guessed success.

## Session binding and resume

- A successful claim binds the current Pi session to the Issue.
- `SUBSTRATE_ISSUE_REF` is the canonical process-level rebind for a fresh
  process. `SUBSTRATE_ISSUE` is a compatibility alias only.
- `/substrate-resume` prints the full capsule for the bound Issue.
- On `session_start` (`new`, `resume`, `fork`) the extension notifies when a
  capsule is available. Pi has no start-time context-injection channel here, so
  this is deliberately notify + command, never a silent context edit.

## Journal and revisions

Use the Issue for authorized work and the Journal for what happened:

```text
progress / finding / decision / blocker / milestone / handoff / result
→ Journal

SCOPE / SUCCESS / NON_GOALS / CONSTRAINTS / VALIDATION / OUTPUT changes
→ stop
→ /planning
→ new Issue revision
→ readiness / attestation
```

A meaningful settled outcome is `kind=result`; a progress note is not a result.

## Compaction contract

`session_before_compact` writes the mechanical checkpoint first, then attempts
the bounded semantic summary. If semantic enrichment fails, the mechanical row
remains durable and Pi's normal compaction proceeds. If no Issue is bound, Pi's
normal compaction is untouched.

A later session resumes from:

```text
current Issue revision
+ latest checkpoint
+ Journal delta
+ claim / blockers
+ provenance
→ Resume Capsule
```

not from the compacted chat transcript.

## Mutation authority

A Pi session bound to an Issue may edit/write only under its own live claim.
Substrate provides no workspace-exclusion guarantee (XTRM-414): per-issue claim
fencing is the only mutation authority here; workspace exclusion is owned by
the specialists activation layer. Unbound sessions are not implicitly bound to
a random Project or Issue. Repository/project initialization is `sb init`; global
database cardinality is never project context.

## Identity and advisories

Identity resolves as `SUBSTRATE_HOLDER`, else the xt worktree name, else nobody;
the extension exports a worktree-derived name into the process environment at
session start so `bash` children inherit it. The extension applies the same
deterministic advisories as the Claude plugin (`packages/substrate/docs/advisories.md`):
at session start (your live claims, TTL, latest handoff), after `sb` and
`substrate_*` tool results (advisory appended to the result, operator notified),
and at the end of a turn (a missing handoff triggers one follow-up turn). The
`substrate` widget shows your claims and TTL. `SUBSTRATE_ADVISORIES=off`
silences advisories. Empty journal entries are rejected; thin summaries warn;
a summary over 16,000 characters fails (use `summaryFile`), it is never cut.
`sb help kinds|contract|identity` hold the shapes.

## Where to read more

- `packages/substrate/docs/advisories.md` — advisory catalogue and identity
- `packages/substrate/docs/pi.md` — provider reference
- `packages/substrate/docs/workflow.md` — end-to-end work lifecycle
- `packages/substrate/docs/provenance-and-closure.md` — evidence and closeout
