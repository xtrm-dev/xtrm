# ADR — XTRM Substrate Adoption, Workflow Migration, Beads Termination, and Fleet Cutover

**Status:** ACCEPTED FOR IMPLEMENTATION  
**Date:** 2026-09-10  
**Scope:** `xtrm-dev/xtrm`, `xtrm-dev/core`, `xtrm-dev/specialists`, and all XTRM-managed consumer repositories  
**Decision class:** Final adoption / workflow migration / termination ADR

---

# 1. Mission

Complete the transition from Beads to Substrate across the entire XTRM environment.

This is **not**:

```text
bd show   → sb issue show
bd update → sb issue edit
bd close  → sb issue close
```

That would merely rename the old tracker while retaining the old workflow model.

The required migration is:

```text
Beads-centric work lifecycle
        ↓
Substrate-native methodology

Issue
+ readiness
+ claim / workspace lease
+ Journal
+ Resume Capsule
+ provenance
```

Substrate (`sb`) becomes the **primary and only XTRM-managed local issue/work authority**.

A migrated XTRM installation must teach and enforce the Substrate methodology, not merely expose the Substrate database.

---

# 2. Canonical authority model

The canonical local state store is:

```text
~/.xtrm/state.db
```

The responsibility model is:

```text
Issue
    WHAT work is authorized.

Claim / workspace lease
    WHO owns the work and WHO may mutate.

Journal
    WHAT happened during execution.

Resume Capsule
    WHAT a continuing worker needs to reconstruct the current state.

Provenance
    WHAT execution actually produced.

Memory
    Reusable validated knowledge across work.

XTRM Channels
    Communication between participants.

Specialists
    Execution participants/runtime.

Git
    Code and integration truth.
```

These are separate concepts.

The following equivalences are forbidden:

```text
Journal != Issue contract
Journal != Memory
message != authority
worker summary != provenance
claim != assignee field
MCP != work authority
Claude/Pi session != durable work
```

---

# 3. Central invariant

The system must enforce:

> **Substrate owns durable work.**

And:

> **A ready Issue revision is the executable contract.**

And:

> **Messages coordinate; the Journal preserves continuity; neither silently modifies the Issue contract.**

And:

> **If executable authority changes, stop and revise the Issue through planning.**

This doctrine must appear consistently across Core, Specialists, Pi, Claude, generated instructions, installed skills, documentation, and runtime gates.

---

# 4. Beads termination decision

XTRM no longer installs, requires, initializes, configures, upgrades, invokes, or teaches Beads in normal operation.

Retire XTRM-managed use of:

```text
bd
@beads/bd
Dolt as Beads storage
bv as Beads issue triage
bd init
bd prime
bd ready
bd show
bd update
bd close
bd note
bd state
bd dep
bd hooks
bd doctor
Beads shared-server management
Beads git synchronization
Beads auto-stage logic
Beads Claude hooks
Beads Codex hooks
Beads Pi extensions
Beads workflow skills
Beads instruction blocks
```

Historical compatibility is one-way only:

```text
Beads export
    ↓
sb import beads
    ↓
Substrate
```

No reverse synchronization.

No dual-write.

No new Beads.

No requirement for `bd` to remain installed after migration.

---

# 5. Passive Beads compatibility

The only normal surviving Beads-aware surface is passive historical intake such as:

```text
sb import beads --file ...
```

The importer may understand Beads IDs, statuses, relationships and historical note material.

It must not:

```text
install bd
start Dolt
create a Beads workspace
write into Beads
run bd commands
restore Beads hooks
restore Beads skills
dual-write
```

Imported Beads IDs remain permanent aliases resolving to the resulting Substrate Issues.

---

# 6. Repository ownership

## `xtrm-dev/xtrm`

Owns:

```text
@xtrm/substrate
IssueService
PlanningService
JournalService
ResumeService
ProvenanceService
WorkItemStore
SubstrateIssueStore
sb CLI
SQLite/WAL authority
claims
workspace leases
readiness
Issue graph
provenance
Beads importer
Substrate Pi extension
Substrate Claude plugin
```

## `xtrm-dev/core`

Owns:

```text
xt installation
machine bootstrap
xt init
xt update
fleet reconciliation
canonical XTRM skills
canonical instruction generators
Claude/Pi runtime enrollment
managed hook distribution
migration cleanup
doctor/help/operator UX
```

Core consumes Substrate.

Core must not implement another issue tracker.

## `xtrm-dev/specialists`

Owns:

```text
NativeActivationHost
SpecialistLoader
Specialist definitions
AgentSession lifecycle
StepContract
interaction transport
runtime event projection
Specialist Pi extension
Specialist Claude plugin/MCP
execution telemetry
```

Specialists consumes Substrate durable work through the shared service/WorkItemStore boundary.

Specialists does not own durable Issue storage.

---

# 7. Claude plugin naming

There must not be two plugins named `substrate`.

Canonical ownership:

```text
substrate
    owned by xtrm-dev/xtrm
    Issue / Journal / readiness / claims / provenance / lifecycle

specialists
    owned by xtrm-dev/specialists
    activation / status / reply / resume / retry / stop
```

The architecture becomes:

```text
Claude Code
   │
   ├── substrate
   │     └── durable work authority
   │
   └── specialists
         └── execution runtime
                 │
                 ▼
            WorkItemStore
                 │
                 ▼
             Substrate
```

---

# 8. Specialists migration

The new Specialist-native runtime is currently architecturally correct in its AgentSession/activation model, but its Beads-specific work boundary must be replaced.

**Implementation status: IMPLEMENTED.** The replacement has landed in `xtrm-dev/specialists`. Implementing
commit: `4bc708f9` — "feat: migrate native activation boundary to Substrate work items (xtrm-6qu.7)". The
runtime boundary is `src/activation/workitem-store.ts` (`createWorkItemBoundary` / `openWorkItemBoundary`),
which consumes Substrate Issues and carries no static dependency on Substrate and none on Beads;
`src/activation/native-host.ts` opens every work item through it, and the compatibility `bead_id` parameter
name now resolves to a Substrate Issue locator at the tool boundary. The architectural decisions in this
section are unchanged — only their implementation status was stale.

Remove load-bearing runtime concepts such as:

```text
BeadsClient
beadId
bead_id
bead-gate
createBeadFromContract
bd state
bd show
bd dep
bd create
bd close
```

Replace them with:

```text
WorkItemStore
SubstrateIssueStore
issueRef
issueId
Issue revision
contract hash
Substrate readiness
Substrate claims
Issue graph
Journal
ExecutionBinding
```

This migration happens at the **shared runtime boundary**, not independently in Pi and Claude.

---

# 9. Specialist dispatch contract

Canonical Specialist dispatch becomes:

```text
specialist_dispatch
    specialist
    issue_ref
    ...
```

`issue_ref` accepts:

```text
iss_...
XTRM-227
XTRM-184.2.3
historical locator
legacy imported Beads alias
```

The execution binding must pin:

```text
issue_id
issue_revision
contract_hash
claim
participant
activation
attempt
session
workspace
```

A worker may never receive an ambiguous "latest Issue" without the exact executable revision being bound.

---

# 10. Inline Specialist dispatch

Existing Beads-style behavior:

```text
inline contract
→ validate
→ create Bead
→ dispatch
```

becomes:

```text
inline contract
    ↓
structural validation
    ↓
Substrate Issue creation
    ↓
semantic readiness / attestation
    ↓
claim
    ↓
ExecutionBinding
    ↓
NativeActivationHost
```

No `bd` subprocess.

No hidden temporary Bead.

No separate Specialist work graph.

If inline creation cannot produce a legitimate ready Issue, fail closed rather than smuggling the missing context into the worker prompt.

---

# 11. Specialist parent / Epic context

`epic_context_depth` remains useful.

But lineage must come from Substrate:

```text
parent_child edges
```

not:

```text
bd dep list
Beads parent metadata
```

The selected ancestor context must also obey normal Substrate inheritance/provenance rules.

---

# 12. Pi and Claude Specialist parity

The Pi `specialist-subagents` extension and the Claude Specialists plugin must share:

```text
NativeActivationHost
WorkItemStore
Substrate readiness
Issue identity
StepContract
result projection
interaction semantics
```

Do not build:

```text
Pi Substrate gate
Claude Substrate gate
```

Build:

```text
                 Shared runtime
                      │
               WorkItemStore
                      │
                  Substrate
                /           \
              Pi           Claude
```

Provider adapters marshal arguments and render results only.

Acceptance must prove equivalent refusal/admission semantics through both providers.

---

# 13. Workflow migration doctrine

This is the most important part of this ADR.

Every work-management skill must be rewritten around:

```text
Issue
→ readiness
→ claim / lease
→ Resume Capsule
→ execution
→ Journal
→ validation
→ provenance
→ handoff / close
```

A skill fails migration if it is essentially the old Beads workflow with `bd` changed to `sb`.

---

# 14. What belongs in an Issue

The Issue owns **authorized executable work**.

Its work contract consists of:

```text
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

with execution policy including SCRUTINY and related ownership/context metadata.

The Issue answers:

```text
What problem is authorized?
What counts as success?
What may change?
What must not change?
What constraints bind execution?
How must the result be validated?
What artifact/result is required?
```

Normal progress does not belong in the contract.

---

# 15. What belongs in the Journal

The Journal owns execution continuity.

Examples:

```text
note
finding
decision
blocker
milestone
handoff
checkpoint
compaction
```

Examples of correct Journal state:

```text
"Parser implemented; integration tests remain."

"Upstream SDK behavior differs from the documented example."

"Chose option B because option A violates the workspace-lease invariant."

"Blocked on PR #123."

"Validation passed 81/81."

"Coordinator handed remaining provider test to child Issue XTRM-251."
```

These statements normally do **not** modify the Issue contract.

---

# 16. When the Issue must change

If work discovers that executable authority itself must change, execution stops.

Examples:

```text
SCOPE must expand
SUCCESS definition was wrong
new NON_GOAL required
CONSTRAINT changed
VALIDATION must change
OUTPUT must change
ownership/context materially changed
scrutiny changed materially
```

Then:

```text
execution pauses
    ↓
/planning
    ↓
Issue revision
    ↓
old readiness invalidated
    ↓
new readiness attestation
    ↓
execution resumes
```

Never silently put the new scope into:

```text
Journal
worker prompt
channel message
handoff note
Specialist instruction
```

and continue as if authorization had not changed.

---

# 17. Required worker lifecycle

Canonical worker loop:

```text
discover relevant Issue
        ↓
read exact Issue revision
        ↓
validate readiness
        ↓
claim
        ↓
acquire writer lease if mutation required
        ↓
resume from durable state if continuing
        ↓
execute
        │
        ├── ordinary observation
        │      → Journal note/finding
        │
        ├── decision
        │      → Journal decision
        │
        ├── blocker
        │      → Journal blocker
        │
        ├── meaningful progress boundary
        │      → Journal milestone/checkpoint
        │
        └── executable authority changed
               → STOP
               → /planning
               → new Issue revision
               → readiness
        ↓
validate
        ↓
record execution provenance
        ↓
checkpoint/handoff or close
        ↓
release authority
```

This methodology must appear in canonical skills.

---

# 18. Resume methodology

A resumed worker must not reconstruct state primarily from conversation history.

Canonical reconstruction:

```text
current Issue revision
        +
latest durable checkpoint
        +
Journal delta after checkpoint cursor
        +
current claim
        +
blockers
        +
child Issue status
        +
pending asks
        +
provenance state
        ↓
Resume Capsule
```

The Resume Capsule is the bounded work continuation projection.

Skills should teach:

```text
sb issue resume <ref>
```

or the equivalent native provider tool as the normal restart/resume primitive.

Do not dump the entire historical Journal unless explicitly investigating history.

---

# 19. Compaction methodology

Context compaction must not become work-state compaction.

Before compaction:

```text
mechanical checkpoint
    ↓ durable FIRST
optional semantic enrichment
    ↓
host compaction
```

After compaction:

```text
Resume Capsule
    ↓
continue
```

If semantic summarization fails, mechanical continuity survives.

If chat summary disagrees with the current Issue/Journal/Provenance state, durable Substrate state wins.

---

# 20. Handoff methodology

Handoff does not mean rewriting the Issue description with a status report.

Correct handoff:

```text
Issue remains executable authority
       +
Journal handoff/checkpoint
       +
current blockers
       +
known pending work
       +
provenance references
       ↓
next worker uses Resume Capsule
```

A handoff Journal entry should capture only bounded information the next worker needs.

Long transcripts do not belong in the Journal.

---

# 21. Root Epic / coordinator methodology

A coordinator Epic must not duplicate every child's Journal.

The root Journal records:

```text
child Issue refs
current child states
latest checkpoint refs
major cross-child decisions
programme blockers
pending coordinator questions
integration milestones
```

Child-specific execution detail remains in the child Issue Journal.

The coordinator Resume Capsule aggregates child projections.

---

# 22. Journal notes and Beads note parity

Substrate already has the stronger append-only storage architecture.

Add a generic Journal kind:

```text
note
```

Expose ergonomic syntax:

```text
sb issue note <ref> "text"
sb issue note <ref> --file note.md
sb issue note <ref> --file -
```

Optional typed form:

```text
sb issue note <ref> "..." --kind finding
sb issue note <ref> "..." --kind decision
sb issue note <ref> "..." --kind blocker
sb issue note <ref> "..." --kind milestone
sb issue note <ref> "..." --kind handoff
```

This is convenience over `JournalService`.

No mutable `notes` blob is added to Issue.

Notes are append-only.

Notes do not increment the Issue contract revision.

---

# 23. Notes are not memory

Hard invariant:

```text
Journal note != XTRM Memory
```

A finding may later become a memory candidate.

It does not automatically become reusable truth.

The retired `bd remember` / `bd memories` model must not be recreated inside the Issue Journal.

---

# 24. `sb issue edit` flexibility

A first-class issue tracker needs an ergonomic mutation surface without sacrificing Substrate's stronger revision model.

Current contract replacement is retained:

```text
sb issue edit <ref> --contract contract.json
```

Add metadata mutation:

```text
sb issue edit <ref> --title "..."
sb issue edit <ref> --priority P1
```

Execution-bearing mutations:

```text
sb issue edit <ref> --contract ...
sb issue edit <ref> --ownership ...
sb issue edit <ref> --context-refs ...
sb issue edit <ref> --scrutiny HIGH
sb issue edit <ref> --expected-revision N
```

Classification must be explicit:

```text
title / priority
    → metadata event
    → no automatic contract revision

contract / ownership / execution context / scrutiny
    → execution-relevant
    → appropriate revision
    → readiness invalidated
```

Never accidentally retain a readiness attestation across an execution-relevant mutation.

---

# 25. Claims replace mutable assignment

Do not copy Beads-style mutable assignment into Substrate.

Use:

```text
sb issue claim
sb issue release
```

Claims are atomic, leased, anti-steal ownership.

A passive `assignee` field must not become a competing authority mechanism.

---

# 26. Lifecycle surface

Expose complete explicit lifecycle operations.

Canonical:

```text
sb issue state <ref> open
sb issue state <ref> deferred
sb issue state <ref> done
sb issue state <ref> cancelled
sb issue state <ref> archived
```

Convenience aliases may include:

```text
sb issue close
sb issue reopen
sb issue defer
sb issue cancel
sb issue archive
```

Lifecycle changes emit durable Issue events.

---

# 27. Relationship surface

Keep graph mutation distinct from general edits.

Use:

```text
sb issue relate
sb issue unrelate
```

with typed relations.

Do not make relationship mutation an accidental side effect of `issue edit`.

Parent-child reparenting must preserve machine ID and durable human reference.

---

# 28. `sb` help surface

`sb` is now a primary product CLI.

Implement proper side-effect-free help:

```text
sb --help
sb help

sb project --help

sb issue --help
sb issue create --help
sb issue show --help
sb issue edit --help
sb issue note --help
sb issue validate --help
sb issue attest --help
sb issue claim --help
sb issue release --help
sb issue state --help
sb issue resume --help
sb issue relate --help

sb plan --help
sb journal --help
sb provenance --help
sb import --help
sb import beads --help
```

Also:

```text
sb --version
sb doctor
```

Help must be processed before opening SQLite.

This must work:

```text
HOME=/empty sb --help
```

without creating a database.

Machine-readable help is desirable:

```text
sb help --json
```

Agents should be able to discover current command semantics without relying on stale skill copies.

---

# 29. Operator documentation

Create:

```text
docs/substrate/README.md
```

as the canonical human starting point.

It must explain:

```text
what Substrate is
authority model
installation through xt
state location
project/repository linking
Issue identity
Issue contracts
readiness
claims and leases
Issue editing
Journal methodology
notes/findings/decisions/blockers
checkpointing
Resume Capsules
planning/revision workflow
provenance
Specialists integration
Pi integration
Claude integration
Beads migration
diagnostics
reference to full PRD
```

Update stale:

```text
packages/substrate/README.md
packages/substrate/skills/using-substrate/SKILL.md
Claude substrate plugin skill
runtime docs
```

Remove current-state wording such as:

```text
P11 deferred
receipts land in P8
Beads owns durable work
```

Historical phase evidence can retain historical wording when clearly marked as such.

---

# 30. Canonical skills migration

At minimum audit and rewrite:

```text
using-xtrm
planning
starting-and-resuming-work
using-specialists
execution/implementation workflows
review workflows where work authority matters
handoff/closeout skills
compaction/session methodology
maintenance/update skills that inspect durable work
```

This is a semantic rewrite.

---

# 31. `using-xtrm`

Must teach the complete authority stack.

Minimum doctrine:

```text
Substrate owns durable work.
Git owns code truth.
A ready Issue revision is executable.
Journal records progress/continuity.
Resume Capsule restores work.
Provenance records produced execution.
Messages do not change Issue authority.
```

It must direct ordinary workers toward:

```text
Issue → claim → resume → execute → journal → validate → provenance → close/handoff
```

---

# 32. `/planning`

Planning becomes the authority-authoring interface.

It must teach:

```text
conversation / operator request
        ↓
PlanDraft
        ↓
seven-field contracts
        ↓
ownership/context
        ↓
hierarchy/dependencies
        ↓
overlap analysis
        ↓
sb plan check
        ↓
sb plan apply
        ↓
readiness
```

During execution, `/planning` is also how an insufficient or changed Issue is repaired.

Do not advise agents to patch missing scope into a dispatch prompt.

---

# 33. `starting-and-resuming-work`

This skill must be substantially rewritten.

Old model:

```text
bd prime
bd ready
bd show
Bead notes
conversation reconstruction
```

New model:

```text
resolve Issue
        ↓
sb issue show
        ↓
read exact revision/readiness
        ↓
claim if needed
        ↓
sb issue resume
        ↓
Resume Capsule
        ↓
read only Journal delta / evidence needed
        ↓
continue
```

A fresh worker should not need the previous chat.

---

# 34. `using-specialists`

This skill must teach:

```text
ready Substrate Issue
     ↓
claim
     ↓
specialist_dispatch(issue_ref)
     ↓
exact revision/hash
     ↓
NativeActivationHost
```

Specialists do not receive Beads.

Specialist execution findings belong in the Issue Journal where durable continuity warrants them.

Specialist result does not modify the Issue contract.

Scope-changing findings route back through planning.

---

# 35. Implementation skills

During work:

```text
finding
→ Journal finding

important architectural choice
→ Journal decision

external dependency preventing progress
→ Journal blocker

meaningful completion boundary
→ Journal milestone/checkpoint

ordinary human annotation
→ Journal note
```

Do not journal every shell command or transient thought.

The Journal must remain useful as bounded durable continuity.

---

# 36. Review methodology

Reviewers should consume:

```text
Issue revision
SUCCESS
SCOPE
CONSTRAINTS
VALIDATION
OUTPUT
provenance
implementation diff
relevant Journal findings/decisions
```

A review finding that changes authorized requirements causes a planning/revision cycle.

A reviewer comment does not silently mutate the task contract.

---

# 37. Skill migration acceptance gate

Every migrated work-management skill must pass:

```text
SKILL-MIGRATION-GATE
```

FAIL if its workflow is equivalent to the previous Beads workflow with command names substituted.

Verify each applicable skill teaches:

1. Issue revision as executable authority.
2. Readiness before execution.
3. Claim / workspace-lease ownership.
4. Journal as typed execution continuity.
5. Appropriate use of note/finding/decision/blocker/milestone/handoff.
6. Mechanical checkpointing at durable boundaries.
7. Resume Capsule + Journal delta for continuation.
8. `/planning` when executable authority changes.
9. Journal != Issue.
10. Journal != Memory.
11. Messages != authority.
12. Provenance != progress notes.
13. Handoff methodology.
14. Close/release methodology.
15. No required dependence on chat history.
16. No active Beads commands.

---

# 38. Claude Beads hooks → Substrate gates

Useful deterministic gates must survive the migration.

Do not simply delete them.

## Edit gate

Old:

```text
beads-edit-gate
```

New:

```text
substrate-edit-gate
```

Decision inputs:

```text
resolved current Issue
live claim
workspace writer lease
protected workspace state
```

## Claim/session binding

Replace `beads-claim-sync` with native Substrate session binding.

Both Claude and Pi must be able to resolve:

```text
session
→ active Issue
→ claim
```

without parsing terminal output.

## Commit gate

Replace Beads commit logic with Substrate provenance enforcement.

Validate required:

```text
Issue
revision
contract hash
claim
workspace authority
ExecutionBinding
receipt/provenance context
```

before managed commits as appropriate.

Existing Substrate Git provenance owns trailers and SHA binding.

## Stop gate

Replace Beads stop state with:

```text
active claims
active Specialist activations
pending asks
checkpoint continuity
pending handoff
```

Unfinished work can remain open.

The requirement is durable continuity before exit, not fake completion.

## Compaction

Retire:

```text
beads-compact-save
beads-compact-restore
```

Use:

```text
Substrate mechanical checkpoint
optional semantic enrichment
Resume Capsule
SessionStart(compact)
Pi session_before_compact
```

## Status cache

Replace the Beads status cache with bounded Substrate queries/projections or retire it if SQLite is sufficiently cheap.

Never introduce a second state store as cache authority.

---

# 39. Pi Beads extension retirement

Remove the active managed Beads Pi extension.

The Substrate Pi extension owns issue/work behavior.

If functionality from the Beads extension remains useful, port that functionality to the Substrate extension against the typed service.

Do not preserve a Beads extension simply to avoid porting its gates.

---

# 40. `xt init` — new machines

Fresh XTRM installation is Substrate-first.

Remove normal required dependencies:

```text
@beads/bd
dolt
bv
```

where their XTRM purpose is Beads.

`xt init` should roughly perform:

```text
machine prerequisites
        ↓
install/verify @xtrm/substrate
        ↓
sb --version
        ↓
initialize ~/.xtrm/state.db
        ↓
create or resolve Substrate project
        ↓
link checkout
        ↓
install/enroll Substrate Pi integration
        ↓
install/enable Substrate Claude plugin
        ↓
install/enroll Specialists
        ↓
generate Substrate-native skills/instructions
        ↓
run verification
```

A fresh machine must never execute:

```text
npm install -g @beads/bd
bd init
bd hooks install
dolt setup for Beads
bv installation for Beads
```

---

# 41. `xt doctor`

`xt doctor` must report Substrate health.

Include:

```text
sb availability/version
state.db location
schema health
project link
current repository mapping
Substrate Pi integration
Substrate Claude plugin
Specialists integration
stale Beads machinery
legacy .beads workspace
legacy Beads hook registrations
legacy Beads Pi extension
```

Legacy Beads findings should be actionable:

```text
legacy migration required
```

rather than silently tolerated.

---

# 42. `xt update` owns migration

Existing installations must not require manual cleanup.

Canonical migration:

```text
xt update --apply
```

Fleet migration:

```text
xt update --all-repos --apply
```

The migration must be deterministic, idempotent and safe.

---

# 43. Existing Beads repository migration

Before deletion:

1. Detect `.beads`.
2. Determine whether Substrate import already occurred.
3. Export a durable backup.
4. Import the board into Substrate.
5. Preserve old IDs as aliases.
6. Preserve hierarchy/dependencies.
7. Preserve relevant historical notes.
8. Verify counts/invariants.
9. Persist migration receipt.
10. Only then remove active Beads machinery.

Failure in preservation verification must stop destructive migration.

---

# 44. Historical note migration

Where Beads historical notes can be reconstructed, map them to:

```text
Journal(kind=note)
```

or a more specific kind when deterministically known.

Attach source metadata:

```text
source = beads
legacy issue id
legacy timestamp if known
```

Do not append all old notes into the Issue contract.

Do not promote them into Memory.

---

# 45. Existing repo cleanup

After a successful migration remove XTRM-owned:

```text
Beads instruction blocks
Beads workflow skills
Beads Claude hook registrations
Beads Codex hook registrations
Beads Pi extension enrollment
beads-* managed hook files
.bd-sync
Beads/Dolt git hook fragments
bd auto-stage patch
Beads shared-server configuration
Beads caches
Beads-generated active workflow configuration
```

An archive can remain outside active runtime paths.

The resulting repository must not behave as a Beads project.

---

# 46. Global third-party installations

Do not automatically uninstall global:

```text
bd
dolt
bv
```

unless XTRM can prove ownership of that installation.

They may be used by unrelated projects.

XTRM simply stops depending on them.

Provide an optional explicit purge path if useful.

---

# 47. Generated-source correctness

Fix canonical sources before generated copies.

At minimum fix:

```text
Core instruction templates
Core canonical skills
Core hook registry
Core dependency registry
Core package/runtime registry
Specialists canonical runtime
Specialists provider adapters
```

Then regenerate:

```text
AGENTS.md
CLAUDE.md
managed .xtrm assets
installed skills
provider runtime settings
```

Do not hand-edit generated consumer files while leaving the generator Beads-first.

---

# 48. Fleet sweep

Once canonical Core is correct:

```text
xt update --all-repos --apply
```

must migrate every managed repository.

The sweep must detect and remove obsolete:

```text
bd commands in active AGENTS/CLAUDE managed blocks
Beads hooks
Beads skills
Beads Pi enrollment
Beads config
Dolt-sync machinery
```

Historical documents/reports may retain Beads references.

Current runtime instructions may not.

---

# 49. Anti-regression tests

Add source-level tests preventing reintroduction.

Active current-state sources fail CI if they contain normative:

```text
Beads owns durable work
the Bead is the prompt
bd ready
bd show
bd update --claim
bd close
bd prime
bd hooks install
@beads/bd as required dependency
Dolt as required Beads dependency
```

Allowed exceptions:

```text
historical documents
migration implementation/tests
passive importer
archived records
```

Exceptions should be explicit, not broad grep exclusions.

---

# 50. Fresh-machine acceptance

Start with:

```text
no ~/.xtrm
no sb
no bd
no dolt
no bv
no .beads
```

Run:

```text
xt init
```

PASS only if:

```text
sb installed
sb --help works
sb --version works
sb doctor works
~/.xtrm/state.db healthy
Substrate project created/resolved
checkout linked
Substrate Pi integration active
Substrate Claude plugin active
Specialists integration active
canonical skills installed
canonical instructions Substrate-native
Issue creation works
Issue note works
readiness works
claim works
Journal works
resume works
Specialist dispatch works
provenance works
close/release works
```

And:

```text
bd absent is harmless
dolt absent is harmless
bv absent is harmless
no .beads created
no Beads hook installed
no Beads skill installed
no Beads Pi extension installed
```

---

# 51. Upgrade acceptance

Build a realistic legacy fixture containing:

```text
.beeds/.beads
open issues
closed issues
blocked relationships
parent-child relationships
legacy notes
legacy AGENTS.md
legacy CLAUDE.md
Beads skills
Beads Claude hooks
Beads Pi extension
.bd-sync
Beads Git hooks
bd auto-stage patch
```

Run:

```text
xt update --apply
```

PASS only if:

```text
all work preserved
legacy IDs resolve
relationships preserved
historical notes preserved
modern instructions regenerated
modern skills installed
Substrate hooks installed
Beads hooks removed
Beads Pi extension removed
active Beads skills removed
active .beads workflow retired
normal work succeeds without bd
```

Then run again.

Second execution must be a no-op except legitimate unrelated updates.

---

# 52. Workflow acceptance test

A real worker must be able to perform:

```text
start fresh session
    ↓
discover ready work
    ↓
inspect Issue
    ↓
claim
    ↓
perform partial implementation
    ↓
record finding
    ↓
record decision
    ↓
checkpoint
    ↓
end session
    ↓
new fresh session
    ↓
sb issue resume
    ↓
continue without previous chat
    ↓
discover requirement change
    ↓
stop
    ↓
/planning
    ↓
new Issue revision
    ↓
new readiness
    ↓
continue
    ↓
validate
    ↓
provenance
    ↓
close/release
```

The acceptance test fails if continuity requires reconstructing the previous chat.

---

# 53. Specialist acceptance

Prove through both Pi and Claude:

```text
ready Issue
→ claim
→ specialist_dispatch(issue_ref)
→ exact Issue revision/hash
→ AgentSession
→ work
→ result
→ provenance
```

Reject:

```text
draft Issue
stale attestation
blocked Issue
wrong claim
scope-expanding hidden prompt
writer without workspace lease
```

Current production Specialists code must no longer require:

```text
BeadsClient
bead-gate
createBeadFromContract
bd show
bd state
bd dep
bd create
```

---

# 54. Hook parity acceptance

For every retired Beads hook, document its disposition:

```text
beads-edit-gate
    → substrate-edit-gate

beads-commit-gate
    → substrate provenance/commit gate

beads-claim-sync
    → native session/claim binding

beads-stop-gate
    → Substrate continuity/active-work gate

beads-compact-save
    → Journal mechanical checkpoint

beads-compact-restore
    → Resume Capsule

beads-status-cache
    → Substrate projection or retired

beads-memory-gate
    → already retired / separate memory architecture
```

No safety behavior may disappear accidentally.

---

# 55. Documentation acceptance

A new operator should be able to understand XTRM durable work using only:

```text
docs/substrate/README.md
sb --help
using-xtrm
planning
starting-and-resuming-work
using-specialists
```

The operator should not have to read implementation PR history to understand normal operation.

---

# 56. No premature completion

Do not declare this ADR complete because:

```text
Substrate tests pass
the MCP server works
the Claude plugin loads
sb exists
Beads importer exists
```

Those are prerequisites.

Completion is the entire XTRM adoption.

---

# 57. Required final report

At closeout record:

```text
CURRENT HEADS

SUBSTRATE CLI
- help
- version
- doctor
- issue note/edit/state surfaces

WORKFLOW
- canonical lifecycle
- Resume methodology
- Journal methodology
- planning/revision behavior

CORE
- installer changes
- dependency removal
- skills migrated
- generators migrated
- hooks migrated

SPECIALISTS
- WorkItemStore integration
- Pi parity
- Claude parity
- bead_id removal

FLEET MIGRATION
- repos scanned
- repos changed
- Beads boards imported
- hooks removed
- skills removed
- generated instruction updates

FRESH MACHINE
- exact smoke evidence

LEGACY UPGRADE
- exact migration evidence

TESTS
- exact commands
- exact totals

REMAINING LEGACY
- historical/import-only references only

OPEN BLOCKERS
- none
```

---

# 58. Final architecture

```text
                            XTRM
                              │
                    @xtrm/substrate
                              │
                     ~/.xtrm/state.db
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
         sb                  Pi                Claude
          │             Substrate ext       Substrate plugin
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
                         WorkItemStore
                              │
                         Specialists
                      /                  \
               Pi subagents        Claude specialists
```

Work lifecycle:

```text
          /planning
              │
              ▼
            Issue
              │
          readiness
              │
              ▼
            claim
              │
              ▼
          execution
        /     |      \
 finding  decision  blocker
     \       |       /
             ▼
           Journal
             │
        checkpoint
             │
             ▼
       Resume Capsule
             │
             ▼
         validation
             │
             ▼
         provenance
             │
             ▼
       handoff / close
```

Historical migration:

```text
Beads
  │
  │ one-way import
  ▼
Substrate

NO dual-write
NO active Beads runtime
NO Beads installation requirement
```

---

# 59. Definition of complete

This migration is complete only when both statements are mechanically true:

> **A fresh XTRM machine has never heard of Beads and can perform the complete XTRM work lifecycle.**

and:

> **An existing Beads-era XTRM repository can run `xt update --apply`, preserve its durable work and history, and emerge as a clean Substrate repository using the Issue + Journal + Resume + Provenance methodology.**

And one additional worker-level condition must hold:

> **A fresh worker can resume meaningful unfinished work from Substrate without the previous conversation.**

Anything less is a partial tracker replacement, not a completed Substrate adoption.
