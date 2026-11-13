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
issue_get            issue_list            issue_ready
issue_claim          issue_update          issue_note          issue_close
journal_append       journal_checkpoint    journal_show        journal_query
provenance_trace     provenance_session    provenance_activation
resume_capsule
```

Important grouped semantics:

- `issue_claim` is op-discriminated (`claim|release`). A claim says who owns the
  work; it does not create readiness or narrate progress. `holder` defaults to
  `SUBSTRATE_HOLDER`, which the xt launcher exports for the session: inside an
  xt session `sb issue claim <ref>` (or the tool without `holder`) is enough, and
  an explicit holder is only for claiming or releasing on someone else's behalf.
  With neither set the claim fails closed; there is no implicit unix-user
  holder. The same default applies on the CLI and the Pi surface.
- `issue_update` changes authorized Issue fields. Revision-bearing changes stale
  readiness; never use it for progress/findings/results.
- `issue_note`, `journal_append`, and `journal_checkpoint` write continuity.
  Journal `result` is the bounded participant outcome used by meaningful
  settlement and closeout.
- `issue_close` writes first-class immutable Closure with bounded outcome,
  reason, evidence refs, actor/session context, and terminal lifecycle state.
- `journal_query` is op-discriminated (`since|latest|timeline`).
- `provenance_trace` returns the Issue evidence spine; `provenance_session` and
  `provenance_activation` answer what a session or Specialist activation
  produced.
- `resume_capsule` derives continuation state from durable records; it is not a
  second source of truth.

Read `tools/list` for machine schemas. Normative tool descriptions are generated
from the same `TOOL_DEFS` registration table and explain changes, non-changes,
revision/readiness effects, Journal boundaries, and automatic context.

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

## Compaction lifecycle

Claude uses plugin hooks:

```text
PreCompact              mechanical checkpoint first, then semantic enrichment
PostCompact             record compaction occurrence
SessionStart(compact)   surface the Resume Capsule head as additionalContext
```

A semantic summarizer failure cannot erase the mechanical checkpoint. A storage
failure never blocks Claude's own context-overflow recovery.

## Operation feedback

Mutation results include shared structured feedback (`success`, `noop`,
`warning`, or error at the call boundary). This is presentation metadata over
the same durable service result, not a second authority model.

## Where this plugin lives

Plugin scripts resolve through `${CLAUDE_PLUGIN_ROOT}`, never the consumer
project path. `${CLAUDE_PROJECT_DIR}` is user-project state, not package code.

## Issue-to-PR links and the close gate

`issue_close` runs the same close gate as the CLI before any Closure row: a delivery close
needs T1 evidence (a live `created_from` PR artifact on the receipt) or T2 evidence (a
`created_from` trailer plus linked commits). The MCP schema has no gate flag; the mode comes
from `XTRM_LINK_GATE` (`warn` default, `enforce`, `off`). A Substrate or GitHub outage fails
closed in auto mode, and only an evidence/transport code is overridable.

The link rows are written by the `gh` shim after `gh pr create`, from the PR body's
`<!-- xtrm issue=<REF> ... -->` marker, fail-open. Reconcile or backfill them from the
operator surface — `sb links check`, `sb links sync`, `sb provenance attach` and
`sb issue link pr` (needs substrate >= 0.3.0; absent from 0.2.6). Exact flags, gate codes and
the Journal summary limit: `sb <group> <verb> --help`, and the Pi half of this skill in the
package (`packages/substrate/skills/using-substrate/SKILL.md`).

## The routine

The CLI is strict and versioned, so look before you guess:

- **Help first.** Before a verb you have not used this session: `sb help <group>` or `sb <group> <verb> --help`. `sb help contract`
  prints the exact contract JSON (`problem` and `success` strings; `scope`, `nonGoals`, `constraints` lists; `validation` and
  `output` lists of objects; `scrutiny`). `sb --version`: a CLI older than the database refuses it (fail-closed migration check),
  which looks like an outage, not a version skew, unless you read the message.
- **Start.** `sb issue ready` (dispatchable work), `sb issue show <ref>` (contract, readiness, claim), `sb issue resume <ref>` (the
  Resume Capsule), then only the delta: `sb journal since <ref> <cursor>` and `sb journal latest <ref> --kind handoff`.
- **Create.** `sb issue create --project <id> --title ... --kind ... --contract <file> [--parent <epic>]`, then
  `sb issue attest <ref> --outcome ready --policy default --attested-by <you>`. Link work with
  `sb issue relate --from <a> --to <b> --kind blocks|relates_to|discovered_from|supersedes|duplicates`; see the shape with
  `sb issue tree --root <epic>`.
- **Own.** Claim once (`sb issue claim <ref>`, holder from `SUBSTRATE_HOLDER`) with a TTL that covers your next checkpoint, and
  `sb issue renew <ref>` at every checkpoint: a second claim renews nothing. Release before you commit.
- **Record.** `sb journal append <ref> --kind <k> --semantic '{"summary":"..."}'` (or `--summary-file <path>`), one fact per entry.
  Read bodies with `sb journal show <ref> --tail <n>` (newest) and page older with `--before <seq> --limit <n>`.
- **Bind documents.** A document that defines the work goes into the contract with `sb issue edit <ref> --context-refs <file>`
  (a new revision: do it at planning time); a decision cites `path@sha` in a journal entry; deliverables go to `--artifact` at close.
- **Deliver.** Open the PR with the issue marker (the `gh` shim links it), check `sb links check --issue <ref>`, then
  `sb issue close <ref> --outcome completed --reason ... --result <entry> --validation ... --artifact ...`, and audit with
  `sb provenance trace <ref>`.

## Where to read more

- `packages/substrate/docs/claude.md` — exact provider lifecycle and tool map
- `packages/substrate/docs/workflow.md` — end-to-end work lifecycle
- `packages/substrate/docs/provenance-and-closure.md` — evidence and closeout
