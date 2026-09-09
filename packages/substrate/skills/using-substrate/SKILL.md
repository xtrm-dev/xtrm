# Using Substrate (Pi-facing)

Substrate owns durable work. This skill is the Pi half of the shared
`using-substrate` doctrine; the Claude half lives beside it and any
Claude-specific need is filed as a defect report upstream (bead xtrm-7wc.7
owns this file — parallel lane xtrm-7wc.8 consumes it read-only).

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

Eight tools, one typed service behind them (`integrations/pi/` calls
`IssueService` / `JournalService` / `ResumeService` directly — never
`exec("sb …")`, never CLI-text parsing):

```text
substrate_issue_get <ref>            contract + readiness + claim + attestation
substrate_issue_search <project>     title/reference substring, optional kind
substrate_issue_claim <ref>          claim for a holder; binds this session
substrate_issue_update <ref>         revise the contract (no-op if identical)
substrate_journal_append <ref>       checkpoint/handoff/milestone/decision/…
substrate_journal_checkpoint <ref>   mechanical-first checkpoint now
substrate_issue_resume <ref>         bounded resume capsule (rendered text)
substrate_provenance_trace <ref>     event-spine lineage (receipts land in P8)
```

`<ref>` accepts all five forms: machine ID (`iss_…`), durable reference
(`XTRM-227`), current locator (`XTRM-184.2.3`), historical locator, alias.

## Session binding and resume

- Claiming with the session id binds the session to the issue. The
  `SUBSTRATE_ISSUE` env var rebinds a fresh process to the same ref.
- `/substrate-resume` prints the capsule for the bound issue.
- On `session_start` (resume/new/fork) the extension surfaces the capsule
  head: Pi 0.84 exposes no start-time injection channel, so delivery is
  notify + command — never a silent context edit.

## Compaction contract (§23.1, verified against installed Pi 0.84 docs)

`session_before_compact` writes the mechanical checkpoint FIRST (durable
even if everything after fails), then asks the secondary model for the
bounded semantic shape, then renders checkpoint + capsule into the custom
compaction summary — one shared rendering, never two disagreeing summaries.

Failure behavior (acceptance D26):

```text
semantic model fails  → mechanical row stays durable, host default proceeds
SQLite write fails    → never block overflow recovery; reconcile later
no bound issue        → handler returns; Pi default compaction untouched
```

A later session resumes from the capsule (`substrate_issue_resume`),
not from the compacted chat.

## Host wiring (extension entry `integrations/pi/extension.ts`)

```text
session_start                → resume availability notify
session_before_compact       → mechanical checkpoint + secondary semantic
                               + custom summary, or undefined (host default)
substrate-resume (command)   → full capsule print
```

Secondary model: `modelRegistry.find("google", "gemini-2.5-flash")`,
falling back to the session model; `serializeConversation(convertToLlm(…))`
supplies its input (custom-compaction.ts precedent).
