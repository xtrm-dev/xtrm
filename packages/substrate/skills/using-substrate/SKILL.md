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
substrate_issue_search <project>     title/reference substring, optional kind
substrate_issue_claim <ref>          claim for a holder; binds this Pi session
substrate_issue_update <ref>         revise the contract (no-op if identical)
substrate_journal_append <ref>       append one of the nine Journal kinds
substrate_journal_checkpoint <ref>   mechanical-first checkpoint now
substrate_issue_resume <ref>         bounded Resume Capsule
substrate_provenance_trace <ref>     full evidence spine: bindings, receipts,
                                     artifacts, checkpoints, commits/PRs,
                                     external bindings and closure revision
```

`<ref>` accepts machine ID, durable reference, current locator, historical
locator, or alias. `substrate_issue_claim`, `substrate_issue_update`, Journal
append and checkpoint return structured success/no-op/warning feedback; a
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
`substrate_issue_claim` takes its holder from the explicit `holder` argument,
else from `SUBSTRATE_HOLDER`, which the xt launcher exports for the session:
inside an xt session the argument is optional, and an explicit holder is only for
claiming on someone else's behalf. With neither set the claim fails closed; there
is no implicit unix-user holder. The CLI `sb issue claim <ref>` follows the same
rule.
Substrate provides no workspace-exclusion guarantee (XTRM-414): per-issue claim
fencing is the only mutation authority here; workspace exclusion is owned by
the specialists activation layer. Unbound sessions are not implicitly bound to
a random Project or Issue. Repository/project initialization is `sb init`; global
database cardinality is never project context.

## Issue-to-PR links and the close gate

Post-0.2.6 surface: these verbs need substrate >= 0.3.0 and are absent from 0.2.6.
`sb <group> <verb> --help` wins on drift.

```bash
sb links check [--issue <ref>] [--repo <owner/name>] [--limit <n>] [--dry-run]
sb links sync [<pr>] [--repo <owner/name>] [--since <ISO>] [--dry-run]
sb issue link pr <ref> --repo <owner/name> --number <n> [--url <url>] [--commit <sha>]... [--commits-range <a>..<b>]
sb issue unlink pr <ref> --repo <owner/name> --number <n> [--relation created_from|mentioned]
sb provenance attach <ref> pr <owner/repo#n|url|#n> [--receipt <id>]
```

- `links check` lists T2 candidates — PR commits whose `XTRM-Issue` trailer names an Issue
  in this project. With `--issue` it prints the manual and auto verdicts and their codes;
  the default check adds verdicts and exits 1 only under `enforce`. `--dry-run` writes
  nothing.
- `links sync` is the one-shot reconciler: conditional `gh` reads, PR state, trailer-first
  links, then title/branch/body mentions. `--since` records `source=backfill`.
- `provenance attach` is the T1 outcome link: the PR is the Issue's work. `issue link pr`
  writes an explicit mention or, with commits, the T2 evidence from their trailers.
  `unlink` supersedes rows; evidence is never deleted.
- The `gh` shim runs attach then link after `gh pr create`, from the PR body's
  `<!-- xtrm issue=<REF> ... -->` marker. It is fail-open: two different refs or none warn
  and skip, and the create still succeeds.

### Close gate

A delivery close — `sb issue close --outcome completed`, or `sb issue state <ref> done` —
joins the stored rows before the closure: T1 (a live `created_from` PR artifact on the
receipt) or T2 (a `created_from` trailer plus linked commits). Mode comes from `--link-gate`,
then `XTRM_LINK_GATE`, then `warn`:
`enforce` refuses, `warn` appends `provenance.link_gate_warned` and proceeds, `off` skips.
Codes: `gate_orphan_link`, `gate_mentioned_only`, `gate_no_evidence`,
`gate_pr_not_merged`, `gate_other_open_pr`, `gate_live_claim`,
`gate_default_branch_unknown`, `gate_github_unreachable`. `--gate-override <reason>`
journals a decision and bypasses only evidence/transport codes — never a live claim or
another open PR. In auto mode an unknown or unreachable GitHub fails closed.

### Claim and Journal limits

`--holder` on claim, renew and release defaults to `SUBSTRATE_HOLDER`; renewal
(`sb issue renew <ref> [--ttl-ms <n>]`) moves only the expiry and keeps the generation.
`semantic.summary` is capped at 20,000 characters: a longer one fails and writes nothing,
so put long text in a file and use `--summary-file <path|->`. A note, finding, decision,
blocker, milestone or handoff with no payload is rejected; a placeholder or under-eight-word
summary returns a warning; `--kind result` requires a bounded `--result` payload.

### Strict CLI

An unknown flag fails closed and names the flag; `--parent X` must be two arguments; extra
positional text is refused. `sb help contract`, `sb help kinds` and `sb help identity` answer
the three questions operators ask most.

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
- **Deliver.** Before the PR, give the issue a receipt (`sb provenance dispatch <ref>`, then `sb provenance allocate <ref>`), or
  the shim cannot link it. Open the PR with the issue marker (the `gh` shim links it), check `sb links check --issue <ref>`, then
  `sb issue close <ref> --outcome completed --reason ... --result <entry> --validation ... --artifact ...`, and audit with
  `sb provenance trace <ref>`.

## Where to read more

- `packages/substrate/docs/pi.md` — provider reference
- `packages/substrate/docs/workflow.md` — end-to-end work lifecycle
- `packages/substrate/docs/provenance-and-closure.md` — evidence and closeout
