# ADR Amendment A1 — Journal, Outcomes, Actor Identity, Session Lineage, Provenance, and Documentation Contract

**Status:** ACCEPTED FOR IMPLEMENTATION  
**Parent:** `ADR — XTRM Substrate Adoption, Workflow Migration, Beads Termination, and Fleet Cutover`  
**Priority:** P0 / release-blocking for final Substrate adoption  
**Scope:** `xtrm-dev/xtrm`, `xtrm-dev/core`, `xtrm-dev/specialists`, Pi integration, Claude integration, `sb`, `xt`, generated skills/instructions, all XTRM-managed repositories

---

# A1.1 Decision

Substrate must provide a complete durable issue-local execution record, not merely:

```text
Issue contract
+
Git commits
```

The canonical model becomes:

```text
Issue
│
├── revisions
│     authorized executable work
│
├── Journal
│     execution narrative and continuity
│
├── Closure
│     why/how the Issue became terminal
│
└── Provenance
      verifiable execution → artifacts lineage
```

The Journal is the agentic equivalent of the useful parts of:

```text
Jira comments
Beads notes
operator handoffs
worker progress records
review findings
execution result summaries
session checkpoints
```

but it is intentionally more structured than a generic comment stream.

The model must remain:

```text
Issue       = authority
Journal     = continuity / execution record
Closure     = terminal outcome
Provenance  = independently reconstructable execution evidence
Memory      = reusable validated knowledge
```

None of these may silently substitute for another.

---

# A1.2 Journal is a first-class product feature

The Journal is not an implementation detail of context compaction.

It is one of the primary interfaces through which humans, coordinators, Specialists, hooks, runtimes and agents understand ongoing work.

Every XTRM integration must treat it accordingly.

The Journal must support at least:

```text
note
finding
decision
blocker
milestone
handoff
result
checkpoint
compaction
```

Additional kinds may be introduced only where they represent a genuinely distinct semantic category.

Do not collapse everything into `note`.

Do not create dozens of redundant categories either.

---

# A1.3 Journal entry semantics

## `note`

General durable Issue-local annotation.

Use when information is useful but does not deserve a stronger semantic type.

Examples:

```text
Upstream maintainer confirmed the API behavior.

Reproduced only on Fedora 44.

This test fixture intentionally differs from production.
```

## `finding`

A fact discovered during execution that materially affects understanding of the work.

Examples:

```text
The SDK loads the dependency twice through separate ESM/CJS paths.

The documented hook location is not auto-discovered by Claude 2.1.266.

The race reproduces only when WAL readers overlap the lease renewal.
```

A finding is evidence, not automatically an Issue revision.

If it requires changing authorized work, route through `/planning`.

## `decision`

A durable implementation/coordination decision.

Examples:

```text
Use the SDK-native v2 stdio server rather than maintaining a custom wire layer.

Preserve imported Beads IDs only as aliases.

Keep result payloads bounded in the Journal; full output remains execution storage.
```

A decision that changes SCOPE, SUCCESS, CONSTRAINTS, VALIDATION or OUTPUT requires a corresponding Issue revision.

## `blocker`

A currently unresolved condition preventing progress.

The entry should make the blocking condition explicit and, where possible:

```text
blocking Issue
external PR
provider
required decision
missing credential/config
failed validation
```

Blocker resolution should be separately observable rather than rewriting history.

## `milestone`

A meaningful execution boundary.

Examples:

```text
Implementation complete; validation starting.

Provider adapter landed.

All child Issues merged; root integration remains.
```

Do not create milestones for every trivial command.

## `handoff`

Bounded durable continuity for another participant or later session.

A handoff is not a transcript.

It should contain only what is necessary to continue:

```text
completed
current
next
blocked
open questions
important decisions
relevant refs
```

## `result`

A participant execution outcome.

This is particularly important for Specialists, research workers, reviewers, validators and any useful run that may produce no Git commit.

A result should capture:

```text
what was attempted
status/outcome
bounded result summary
validation state
important findings
artifacts
receipt/provenance refs
activation/attempt/session lineage
```

The full raw result may remain in participant/runtime storage.

The Journal receives the durable bounded representation.

## `checkpoint`

Durable mechanical-first continuation point.

Used for session continuity, long-running coordination and explicit durable boundaries.

## `compaction`

Checkpoint associated specifically with context compaction.

Mechanical state is persisted before optional model-generated semantic enrichment.

---

# A1.4 Journal entry identity

Every Journal entry must have its own immutable identity:

```text
journal_entry_id
issue_id
issue_revision
sequence
kind
created_at
```

Where known, it must also record actor and execution lineage automatically.

The caller should not be expected to repeatedly reconstruct identifiers that the runtime already knows.

---

# A1.5 Actor model

Journal entries, closures, execution bindings and relevant provenance events must identify **who or what produced them**.

Introduce or normalize an explicit actor model.

At minimum:

```text
actor_type:
  human
  coordinator
  agent
  specialist
  reviewer
  validator
  hook
  runtime
  system

actor_id:
  stable participant/user/runtime identifier where known

actor_name:
  human-readable name where known
```

Examples:

```text
actor_type=coordinator
actor_id=participant_coord_...
actor_name=xtrm-coordinator

actor_type=specialist
actor_id=participant_executor_...
actor_name=python-implementation-agent

actor_type=hook
actor_id=substrate-precompact

actor_type=human
actor_name=dawid
```

Do not invent identity when unavailable.

Unknown identity must remain explicitly unknown/null.

Never attribute a system-generated checkpoint to a human simply because the human owns the terminal.

---

# A1.6 Session lineage must be captured automatically

Session lineage is important provenance and continuity metadata.

Wherever the runtime knows it, automatically persist it.

Relevant identity may include:

```text
XTRM session ID
XTRM session name
xt launcher/session identity
host runtime
Pi session ID
Claude session ID
Specialist AgentSession ID
Specialist activation ID
Specialist attempt ID
participant ID
ChainRun ID
Chain participant/member ID
coordinator session ID
workspace/worktree identity
branch
base commit
head commit
```

The exact set varies by context.

The rule is:

> **If XTRM already knows a stable execution/session identifier at the moment it creates durable work evidence, it should record it automatically rather than requiring the model to remember to supply it.**

---

# A1.7 Canonical execution context envelope

Define one shared execution-context shape consumed across Journal, provenance, Specialists, Pi and Claude.

Conceptually:

```text
ExecutionContext {
  actor
  participant_id?

  xtrm_session_id?
  xtrm_session_name?

  host:
    type
    session_id?

  run_id?
  chain_run_id?

  specialist:
    specialist_name?
    activation_id?
    attempt_id?
    agent_session_id?

  workspace:
    repo?
    path?
    worktree?
    branch?
    base_commit?
    head_commit?

  timestamp
}
```

Do not create separate incompatible representations for:

```text
Pi Journal context
Claude Journal context
Specialist result context
provenance context
closure context
```

Adapters populate the common envelope from what they know.

Unknown fields remain absent/null.

---

# A1.8 XTRM session identity

The `xt` runtime should provide a stable session identity to child integrations.

When available, expose something equivalent to:

```text
XTRM_SESSION_ID
XTRM_SESSION_NAME
```

or a typed runtime API carrying those values.

Do not rely solely on environment variables when an in-process typed context is available.

Environment variables are appropriate for process-boundary propagation.

The same stable values should flow into:

```text
Pi
Claude
Specialists
Journal
ExecutionBinding
WorkReceipt
runtime events
closure
```

where relevant.

---

# A1.9 Specialist identity propagation

A Specialist run must automatically bind:

```text
Issue ID
Issue revision
contract hash

participant ID
specialist name
activation ID
attempt ID
AgentSession ID

coordinator participant/session
workspace
branch/base commit
```

This lineage must survive:

```text
retry
resume
model fallback
context compaction
settlement
handoff
```

A retry must distinguish:

```text
same activation
new attempt
```

A resume must distinguish:

```text
same durable work
same activation where applicable
continued/new attempt semantics
same or restored AgentSession
```

according to the runtime contract.

---

# A1.10 Automatic Specialist result publication

When a Specialist reaches a meaningful settled result, the runtime must publish a bounded result into the Issue Journal automatically.

Do not depend on the Specialist remembering to call a note command.

Conceptually:

```text
Specialist settles
       │
       ├── Specialist execution storage
       │      full/raw result where appropriate
       │
       ├── WorkReceipt / provenance
       │
       └── Issue Journal
              kind=result
```

The Journal result must contain or reference:

```text
specialist
participant
activation
attempt
AgentSession
status
result summary
validation
important findings
artifacts
receipt
commits/PRs where available
completed_at
```

---

# A1.11 Result size discipline

Do not append entire large model responses blindly.

Journal `result` must be bounded.

Recommended model:

```text
result.summary
result.outcome
result.completed[]
result.validation
result.findings[]
result.artifact_refs[]
result.provenance_refs[]
```

Full participant output belongs in runtime result storage or an artifact.

The Journal points to it.

This prevents the Issue timeline from becoming another transcript store.

---

# A1.12 Result publication must not require Git

A Specialist, reviewer, researcher or validator may produce a legitimate result with no commit.

Therefore:

```text
no commit
```

must never mean:

```text
no durable outcome
```

Examples:

```text
research result
architecture review
adversarial review
validation result
failure diagnosis
dependency investigation
decision analysis
```

all deserve durable Journal results where they materially advance the Issue.

Git provenance is one provenance source, not the entire work record.

---

# A1.13 Closure becomes first-class

Closing an Issue must record more than:

```text
lifecycle_state = done
```

A terminal transition requires a durable closure record.

At minimum:

```text
closure_id
issue_id
issue_revision
contract_hash

terminal_state
outcome
reason

actor
execution/session context

validation_refs
journal_result_refs
receipt_refs
artifact_refs

closed_at
```

Closure must be independently queryable.

---

# A1.14 Closure outcomes

Support structured outcomes such as:

```text
completed
superseded
duplicate
wont_fix
invalid
cancelled
abandoned
```

Exact vocabulary should be deliberately bounded.

`done` remains lifecycle state.

`completed` is a closure outcome.

Do not overload lifecycle state to encode every reason.

---

# A1.15 Close reason

A close reason is required for deliberate terminal transitions unless the transition is purely mechanical and the policy explicitly allows omission.

Canonical CLI:

```text
sb issue close XTRM-227 \
  --outcome completed \
  --reason "Implemented and validated against the accepted contract."
```

Possible richer form:

```text
sb issue close XTRM-227 \
  --outcome completed \
  --reason "MCP migration complete." \
  --result jrn_... \
  --receipt rcp_... \
  --validation ref...
```

The closure reason is not inferred from the latest Git commit.

The close reason is Issue metadata.

---

# A1.16 Automatic closure context

When closing from a runtime that already knows:

```text
session
participant
activation
attempt
workspace
receipt
validation/result
```

populate those automatically.

Users and models should only provide information that cannot be derived.

For example:

```text
sb issue close ...
```

may need an explicit human reason.

A Specialist-driven completion path can already know most execution lineage and should attach it automatically.

---

# A1.17 `sb issue note`

Provide an ergonomic comment/note interface.

Required:

```text
sb issue note <ref> "text"
sb issue note <ref> --file path
sb issue note <ref> --file -
```

Typed forms:

```text
sb issue note <ref> "..." --kind note
sb issue note <ref> "..." --kind finding
sb issue note <ref> "..." --kind decision
sb issue note <ref> "..." --kind blocker
sb issue note <ref> "..." --kind milestone
sb issue note <ref> "..." --kind handoff
```

`result`, `checkpoint`, and `compaction` may require richer dedicated validation rather than arbitrary text-only entry.

---

# A1.18 First-class Journal CLI

The Journal must also remain independently accessible for richer workflows.

At minimum:

```text
sb journal append
sb journal show
sb journal since
sb journal checkpoint
sb journal render
```

Potential useful additions:

```text
sb journal latest <issue>
sb journal timeline <issue>
sb journal show <entry-id>
```

Do not duplicate the same semantics inconsistently across `issue note` and `journal append`.

`issue note` is convenience syntax over the same service.

---

# A1.19 Journal visibility in `sb issue show`

`sb issue show` should provide a useful bounded current projection.

For example:

```text
XTRM-227 · Implement modern MCP server
state: done
revision: 4
readiness: ready

claim: none

latest:
  milestone · implementation complete
  result    · validator PASS
  decision  · legacy MCP rejected

closure:
  completed
  Implemented and validated against MCP 2026-07-28.

provenance:
  3 receipts
  4 commits
  1 PR
```

Do not dump the entire Journal by default.

Provide explicit commands for full history.

---

# A1.20 Coordinator Journal methodology

Coordinators must use the Journal differently from ordinary executors.

A coordinator owns programme continuity, not child transcripts.

Coordinator/root Journal entries should capture:

```text
programme decisions
cross-child blockers
integration milestones
child status transitions
important unresolved questions
dispatch/retry decisions
release gates
current critical path
```

A coordinator checkpoint should automatically summarize/ref:

```text
child Issues
child lifecycle states
child latest checkpoint refs
child active claims
active Specialists
pending asks
external bindings
important receipts/PRs
```

Do not copy each child Journal body into the parent.

---

# A1.21 Child/root aggregation

Root Issue continuity should be reference-based.

Correct:

```text
Root Journal
  child XTRM-231:
    state=done
    checkpoint=jrn_...
    receipt=rcp_...

  child XTRM-232:
    state=blocked
    blocker=XTRM-240
```

Incorrect:

```text
Root Journal
  [copies 4,000 words of XTRM-231 Journal]
  [copies 3,000 words of XTRM-232 Journal]
```

Resume Capsule aggregation follows the same rule.

---

# A1.22 Coordinator session lineage

Coordinator-created Journal state should automatically preserve:

```text
coordinator participant ID
coordinator XTRM session ID/name
host session ID
ChainRun ID where applicable
```

When a coordinator dispatches a Specialist:

```text
coordinator session
       ↓
activation
       ↓
Specialist AgentSession
```

that relation must be queryable later.

---

# A1.23 Non-coordinator Journal methodology

Ordinary workers should journal only durable information useful beyond their current context.

Do journal:

```text
material finding
important decision
external blocker
meaningful milestone
handoff
result
checkpoint
```

Do not journal:

```text
every command
every file opened
chain-of-thought
transient speculation
routine successful tool calls
```

The goal is high-signal durable reconstruction.

---

# A1.24 Reviews and validators

Reviewers and validators are actors.

Their outputs should be publishable as `result` and/or typed findings.

A review run might produce:

```text
result:
  outcome = PASS_WITH_NOTES

findings:
  - retry path lacks provenance binding
  - no regression test for stale attestation
```

A validator may produce:

```text
result:
  outcome = PASS

validation refs:
  tests 241/241
  typecheck 0
  live MCP probe
```

Do not require such results to be encoded in commit messages.

---

# A1.25 Provenance is P0

Provenance is a release-critical property of Substrate.

Every implementation choice in this amendment must preserve the ability to answer:

```text
What Issue authorized this work?
Which exact revision?
What contract hash?
Who performed it?
Under which XTRM session?
Which host/session?
Which Specialist?
Which activation?
Which attempt?
Which workspace?
Which base/head commit?
What result did they publish?
What validation ran?
Which receipt represents the execution?
Which commits/PRs/artifacts resulted?
Who closed the Issue?
Why was it closed?
```

If an important transition cannot answer these questions from durable state where the data was known, treat that as a provenance defect.

---

# A1.26 Provenance must be automatic where possible

Models should not manually type provenance IDs they do not need to know.

The runtime must enrich records from known context.

Prefer:

```text
appendJournal({
  issue,
  kind,
  body,
  executionContext
})
```

where the context is runtime supplied.

Avoid APIs requiring models to construct:

```text
--session
--activation
--attempt
--participant
--workspace
--branch
--commit
```

for every operation when the integration already knows them.

CLI/manual overrides remain useful for recovery/testing.

---

# A1.27 Provenance inheritance

Where one durable record derives from another, preserve references rather than copying unverifiable strings.

For example:

```text
Journal result
    → execution_binding_id
    → receipt_id

Closure
    → result_entry_id
    → receipt_id
```

A user can then traverse the graph.

Do not denormalize opaque provenance into freeform prose only.

---

# A1.28 Git commit relationship

Git commits remain highly valuable provenance.

Commit trailers should bind to Substrate execution according to the existing provenance contract.

But:

```text
commit message != Journal
commit message != closure reason
commit message != Specialist result
```

A commit may be one artifact referenced by all three.

---

# A1.29 No-commit outcomes

Explicitly test:

```text
Research Specialist
→ no filesystem changes
→ result published
→ Journal result exists
→ provenance binding exists
→ Issue can legitimately close
```

This is important because not all XTRM work is code generation.

---

# A1.30 Failure outcomes

Failed execution should also be durable.

Example:

```text
Specialist attempt 2
status = failed
reason = provider rate limit after fallback exhaustion
```

This may become:

```text
Journal result
  outcome = failed
```

without closing the Issue.

Retry then creates a new attempt linked to the same activation/work.

Do not erase previous failure history when retry succeeds.

---

# A1.31 Cancellation

Cancellation must distinguish:

```text
activation cancelled
Issue cancelled
```

Cancelling a Specialist is an execution event.

Cancelling an Issue is a lifecycle/closure event.

One must not automatically imply the other.

---

# A1.32 Reopen semantics

If terminal Issues may reopen, define explicit behavior.

A reopen should:

```text
preserve old Closure
append reopening event
restore lifecycle state
require fresh readiness where appropriate
```

Never mutate/delete the historical Closure.

Potential surface:

```text
sb issue reopen <ref> --reason "Regression reproduced after release."
```

---

# A1.33 External projection semantics

When projecting to GitHub/Jira, Journal and Closure concepts should map intentionally.

Do not blindly mirror every internal checkpoint into Jira comments.

Recommended policy:

```text
high-value note/finding/decision/result/closure
    may project according to configured policy

mechanical checkpoints
compaction entries
low-level runtime events
    normally remain local
```

Projection must preserve local Substrate authority.

Remote comments do not become executable authority.

---

# A1.34 Inbound external comments

If GitHub/Jira comments are imported:

```text
external comment
      ↓
Journal note / external-input entry
```

with:

```text
provider
remote ID
author identity where known
timestamp
trust boundary
```

They are untrusted coordination data.

They do not mutate Issue contract automatically.

---

# A1.35 MCP tools

The Substrate MCP surface must expose this model clearly.

Tool definitions must be explicit about:

```text
authority
mutation semantics
revision effects
automatic context/provenance enrichment
Journal vs Issue
closure
```

At minimum evaluate/add tools equivalent to:

```text
substrate_issue_get
substrate_issue_search
substrate_issue_claim
substrate_issue_update
substrate_issue_resume

substrate_journal_append
substrate_journal_checkpoint
substrate_journal_list/show

substrate_issue_close
substrate_provenance_trace
```

Potential convenience:

```text
substrate_issue_note
```

if it improves model behavior without duplicating underlying semantics.

---

# A1.36 Tool descriptions are part of the product contract

Tool descriptions must not be one-line vague labels.

A mutation tool should tell the model:

```text
what it changes
what it does not change
whether it creates a revision
whether readiness becomes stale
when to use Journal instead
what context is auto-recorded
```

Example intent:

```text
substrate_issue_update

Revise execution-authoritative Issue fields. Contract-bearing changes
create a new Issue revision and invalidate prior readiness. Do NOT use
this tool for progress updates, findings, handoffs, or execution results;
append those to the Issue Journal instead.
```

---

# A1.37 Journal tool descriptions

Journal tools must explain semantic selection.

For example:

```text
finding
  observed material fact

decision
  chosen course of action and rationale

blocker
  unresolved condition preventing progress

milestone
  meaningful progress boundary

handoff
  bounded continuation state

result
  bounded participant execution outcome

note
  useful annotation not fitting a stronger category
```

This information should exist in tool descriptions and extended docs so agents classify entries correctly.

---

# A1.38 Docstrings

Every public service/API entry point around:

```text
Issue mutation
Journal append
checkpoint
result publication
closure
actor/session context
provenance binding
Specialist settlement
```

must have useful docstrings/comments explaining the contract.

Docstrings should cover:

```text
authority level
durability
side effects
revision/readiness behavior
automatic metadata
failure semantics
idempotency expectations
```

Do not write comments that merely repeat function names.

---

# A1.39 Type documentation

Important types should document each field semantically.

Examples:

```text
JournalEntry
ExecutionContext
ActorIdentity
IssueClosure
ExecutionBinding
WorkReceipt
SpecialistResult
```

For nullable/optional provenance fields, explain:

```text
why it may be absent
who normally populates it
whether absence means unknown or not applicable
```

---

# A1.40 CLI help documentation

The hierarchical `sb --help` implementation must explain methodology, not only syntax.

For example:

```text
sb issue edit --help
```

should explicitly state:

```text
Use this for Issue authority/metadata changes.
Do not use it to record progress.
Use `sb issue note` / Journal commands for progress, findings,
decisions, results and handoffs.
```

Similarly:

```text
sb issue close --help
```

must explain closure outcome/reason/provenance behavior.

---

# A1.41 Canonical documentation hierarchy

Create a clear documentation hierarchy.

## Operator entry point

```text
docs/substrate/README.md
```

This is the “start here”.

## Workflow guide

Create a focused document such as:

```text
docs/substrate/workflow.md
```

covering:

```text
Issue
planning
readiness
claims
Journal
results
closure
resume
provenance
```

## Journal reference

Create:

```text
docs/substrate/journal.md
```

This should be comprehensive.

## Provenance reference

Create/update:

```text
docs/substrate/provenance.md
```

## CLI reference

Create/update:

```text
docs/substrate/cli.md
```

or generate it deterministically from the actual command definitions.

## Integration references

Document:

```text
Pi
Claude
Specialists
Core/xt
external projections
```

The full PRD remains architecture authority.

Operator docs explain how to use the finished system.

---

# A1.42 Journal documentation requirements

`journal.md` must cover all of:

```text
why Journal exists
what Journal is not
entry kinds
actor identity
session lineage
automatic metadata
manual metadata
coordinator methodology
ordinary worker methodology
Specialist results
review/validator results
checkpointing
compaction
handoff
root/child aggregation
external comments
notes vs findings
decisions vs Issue revisions
blockers
result size limits
querying
rendering
resume integration
provenance links
retention
migration from Beads notes
```

Include examples for every entry kind.

---

# A1.43 Provenance documentation requirements

The provenance guide should explicitly show the graph:

```text
Issue revision
      ↓
readiness
      ↓
claim
      ↓
ExecutionBinding
      ↓
participant / session / activation / attempt
      ↓
Journal result
      ↓
WorkReceipt
      ↓
commit / PR / artifact
      ↓
Closure
```

And document reverse queries:

```text
Issue → executions
Issue → results
Issue → commits
Issue → PRs

receipt → Issue
commit → receipt → Issue
activation → Issue
session → Issues/executions
closure → result/receipt
```

---

# A1.44 Skills are P0 documentation surfaces

Skills are executable documentation for agents.

Therefore the final migration must give skill quality the same priority as runtime code.

At minimum:

```text
using-xtrm
planning
starting-and-resuming-work
using-specialists
review workflows
implementation workflows
handoff/closeout
multiplexing/coordinator workflows where relevant
```

must understand the new model.

---

# A1.45 Skills must teach Journal selection

Agents must know when to produce each durable record.

Example skill guidance:

```text
You discovered a material fact
→ Journal finding

You chose between architectural alternatives
→ Journal decision

You are blocked
→ Journal blocker

You reached a meaningful boundary
→ Journal milestone

You are handing work to another participant/session
→ Journal handoff

A Specialist/reviewer/worker has completed a bounded run
→ Journal result

You need ordinary durable annotation
→ Journal note

The authorized task itself changed
→ DO NOT journal your way around it
→ /planning → Issue revision
```

---

# A1.46 Skills must teach provenance discipline

Skills should instruct agents to prefer runtime-generated provenance.

Do not tell agents to manually invent:

```text
session IDs
activation IDs
attempt IDs
receipt IDs
commit relationships
```

When runtime evidence is available, use it.

If automatic provenance appears absent when it should exist, treat that as a runtime defect rather than silently compensating with prose.

---

# A1.47 Skills must teach result publication

Specialists and other workers should understand:

```text
final chat response
```

is not necessarily the durable work result.

The runtime should publish automatically where possible.

If operating through a surface without automatic publication, the worker must explicitly create a Journal result before handing off/closing when the outcome matters.

---

# A1.48 Coordinator skill methodology

Coordinator skills should teach a periodic discipline:

```text
inspect child states
inspect pending asks
inspect new results
inspect blockers
inspect provenance/gates
record only material root-level updates
checkpoint programme continuity
```

Avoid continually rewriting a giant root description.

Avoid duplicating child Journals.

---

# A1.49 Closeout skill methodology

Before closure, validate:

```text
SUCCESS satisfied
VALIDATION performed
required OUTPUT exists
material result published
provenance available
important findings/decisions durable
no unresolved blocker incompatible with closure
```

Then write structured Closure.

Do not close solely because a commit exists.

---

# A1.50 Hooks and automatic records

Translated Substrate hooks should enrich rather than duplicate work state.

Examples:

```text
PreCompact
  → automatic checkpoint with host/session identity

PostCompact / resume
  → reference persisted checkpoint

commit/provenance hooks
  → receipt/commit linkage

session stop
  → verify continuity/result/claim state
```

Hooks should not create generic noisy Journal notes for every event.

---

# A1.51 Stop gate methodology

The stop gate should ask:

```text
Is there active claimed work?
Is durable continuation required?
Is there an unrecorded meaningful result?
Are there pending Specialist asks?
Is a checkpoint/handoff needed?
```

It should not require fake closure.

For unfinished work:

```text
checkpoint/handoff
→ release/retain claim according to policy
→ session may end
```

For completed work:

```text
result
→ validation/provenance
→ closure
```

---

# A1.52 Beads note migration

Historical Beads notes must be preserved where practical.

During migration:

```text
ordinary Beads note
→ Journal note

clearly identifiable result append
→ Journal result where deterministic

handoff-formatted note
→ Journal handoff where deterministic

unknown historical note
→ Journal note
```

Never guess a stronger semantic kind when evidence is ambiguous.

Preserve:

```text
legacy Beads ID
source timestamp
legacy author where available
source marker
```

---

# A1.53 Beads close reason migration

Where a historical Beads close reason exists, import it into the Substrate Closure record.

Preserve:

```text
legacy close reason
legacy status
legacy timestamp where available
legacy actor where available
source=beads
```

Do not bury it in a generic note.

---

# A1.54 Query surfaces

The system should eventually support useful queries such as:

```text
all results for Issue
latest result
all decisions
current blockers
all sessions that touched Issue
all Issues touched by session
all activations for Issue
all Issues closed by outcome
all closures missing provenance
all results without receipts
```

These do not all need dedicated CLI verbs immediately, but the underlying schema/API must not make them impossible.

---

# A1.55 Session-centric provenance queries

Session identity is useful enough to warrant explicit query support.

Examples:

```text
sb provenance session <session-id>
sb provenance activation <activation-id>
```

or equivalent service/API calls.

This allows reconstruction such as:

```text
What did this xt session touch?
Which Issues did this Claude session modify?
What did Specialist activation act_123 produce?
```

---

# A1.56 Automatic correlation tests

Add tests proving that known runtime identity propagates automatically.

Examples:

```text
xt session
→ Pi
→ Journal finding
→ same xtrm_session_id

coordinator
→ Specialist activation
→ result
→ same coordinator/session lineage

Specialist retry
→ same activation
→ different attempt
→ both results/queryable history

commit
→ receipt
→ activation
→ Issue revision
```

---

# A1.57 No fabricated provenance

If an integration does not know a value:

```text
null / absent
```

is correct.

Never derive IDs from:

```text
model prose
filenames
heuristic parsing
display labels
```

unless the mapping itself is a deterministic documented authority.

---

# A1.58 Documentation freshness

Runtime and documentation drift already caused several issues during the recent closeout.

Therefore documentation must become testable.

Where possible:

```text
CLI docs generated from command definitions
tool inventories generated/tested against actual registrations
Journal kind docs checked against JOURNAL_KINDS
closure outcome docs checked against enum
MCP tool tables checked against registered tools
```

Avoid manually maintaining duplicate inventories.

---

# A1.59 Documentation anti-drift gates

CI should fail when:

```text
a public Journal kind lacks documentation
a public MCP tool lacks a meaningful description
a public sb command lacks help
a Closure outcome is undocumented
a runtime tool list differs from documented inventory
a skill teaches a retired command
a skill omits the Journal methodology where applicable
```

---

# A1.60 Docstring anti-drift

For exported APIs in the core durable-work path, require documentation through lint/test policy where practical.

Especially:

```text
IssueService mutation methods
JournalService
ResumeService
ProvenanceService
WorkItemStore
ClosureService
execution-context utilities
Specialist settlement adapters
```

---

# A1.61 Tool parity

Pi, Claude MCP and CLI need semantic parity, not necessarily identical raw command shape.

All three surfaces must be able to accomplish:

```text
inspect Issue
claim/release
revise authority
append Journal
checkpoint
resume
publish/query result
close with outcome/reason
trace provenance
```

If a provider intentionally lacks a mutation, document the reason explicitly.

---

# A1.62 Human readability and machine readability

Every major surface should support both.

Human:

```text
sb issue show
sb journal show
sb provenance trace
```

Machine:

```text
--json
typed service APIs
MCP structuredContent where appropriate
```

Do not force agents to scrape human terminal formatting.

---

# A1.63 Error messages

Errors should reinforce methodology.

Bad:

```text
invalid update
```

Better:

```text
Execution-authoritative fields changed; readiness for revision 4 is no longer current.
Run validation/attestation before dispatch.
```

Bad:

```text
cannot append
```

Better:

```text
`result` requires an execution outcome. Use `note` for ordinary annotations.
```

---

# A1.64 End-to-end Journal acceptance

Run an actual multi-session scenario:

```text
Session A
  claim Issue
  record finding
  record decision
  reach milestone
  checkpoint
  end

Session B
  resume from Capsule
  see prior finding/decision
  dispatch Specialist
  Specialist publishes result automatically
  validation runs
  provenance receipt links result
  close Issue with reason

Session C
  inspect closed Issue
```

Session C must be able to reconstruct:

```text
what was authorized
what happened
what was decided
what the Specialist produced
what was validated
which execution generated artifacts
why the Issue closed
who/sessions were involved
```

without reading Session A or B transcripts.

---

# A1.65 Coordinator acceptance

Run a root Epic with multiple children.

The coordinator should be able to resume from:

```text
root Resume Capsule
+
child projections
+
root Journal
```

and recover:

```text
which children completed
which remain blocked
latest child results
pending asks
critical decisions
release state
```

without importing all child transcripts.

---

# A1.66 Specialist acceptance

A Specialist execution must produce durable identity chain:

```text
Issue
→ revision/hash
→ claim
→ ExecutionBinding
→ coordinator
→ activation
→ attempt
→ AgentSession
→ result
→ WorkReceipt
→ artifacts/commits
```

and, where completed:

```text
→ Closure
```

All links must be queryable.

---

# A1.67 Close-reason acceptance

Create Issues closed as:

```text
completed
superseded
duplicate
cancelled
```

Verify:

```text
reason preserved
actor preserved
session preserved where available
revision/hash preserved
result/provenance refs preserved
history immutable
```

---

# A1.68 Non-code work acceptance

Run a research/review Issue with:

```text
zero code changes
zero commits
```

but:

```text
Journal findings
Journal result
validation/review evidence
Closure
```

The Issue must be fully understandable and correctly closable.

---

# A1.69 Documentation acceptance

Before final migration close:

A new agent should be able to learn the system through:

```text
docs/substrate/README.md
docs/substrate/workflow.md
docs/substrate/journal.md
docs/substrate/provenance.md

sb --help

using-xtrm
planning
starting-and-resuming-work
using-specialists
```

without consulting implementation PR history.

Documentation ambiguity is a release defect for this subsystem.

---

# A1.70 Definition of documented

“Documented” does not mean a single README mention.

For each important capability, ensure appropriate coverage across:

```text
architecture/PRD
operator documentation
CLI help
tool definitions
type/API docstrings
skills
examples
tests protecting the contract
```

Not every fact must be duplicated verbatim.

Each surface should contain the information its consumer actually needs.

---

# A1.71 Priority order

For this final adoption programme:

```text
P0
  correctness
  provenance
  workflow methodology
  Journal semantics
  actor/session lineage
  closure/results
  skills
  operator docs
  tool descriptions
  migration safety

P1
  advanced query ergonomics
  presentation polish

P2/P3
  performance tuning that does not affect correctness
```

Documentation and instructions are not post-implementation polish.

They are P0 because agents operate directly from them.

---

# A1.72 Final invariant

The complete Substrate work record should read conceptually as:

```text
Operator request
      ↓
 /planning
      ↓
Issue rev 3
contract hash abc...
      ↓
readiness
      ↓
claim
      ↓
XT session xts_...
coordinator session ...
      ↓
Specialist activation act_...
attempt 2
AgentSession ...
      ↓
Journal
  finding
  decision
  milestone
  result
      ↓
WorkReceipt rcp_...
      ↓
commit / PR / artifact
      ↓
validation
      ↓
Closure
outcome=completed
reason="..."
      ↓
future worker can reconstruct all of it
```

The system is not complete if the only durable explanation is:

```text
look at git log
```

It is not complete if:

```text
the result existed only in chat
the close reason disappeared
the worker identity is unknown despite the runtime knowing it
the Specialist result is only in an internal result file
the coordinator must read old transcripts
the Journal has no documented methodology
```

---

# A1.73 Amendment completion condition

This amendment is complete only when we can mechanically demonstrate:

> **For any meaningful XTRM work item, Substrate can tell us what was authorized, what happened, who/which sessions performed it, what results were produced, what evidence/artifacts came from the execution, and why the Issue reached its current state.**

And:

> **Agents understand how and when to use Issue revisions, Journal entries, Resume Capsules, results, Closure and provenance because those semantics are consistently documented in CLI help, tool definitions, APIs/docstrings, skills and operator documentation.**

And:

> **Known session and execution identity is captured automatically rather than being dependent on model discipline.**
