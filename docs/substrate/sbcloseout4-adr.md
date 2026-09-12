# ADR — Substrate Repository Identity, Journal, Outcomes, Session Lineage, Provenance, and Final Agentic Work Model

**Status:** ACCEPTED FOR IMPLEMENTATION  
**Date:** 2026-09-12  
**Scope:** `xtrm-dev/xtrm`, `xtrm-dev/core`, `xtrm-dev/specialists`, Pi integration, Claude integration, `sb`, `xt`, generated instructions, skills, hooks, MCP tools, and all XTRM-managed repositories  
**Decision class:** Post-cutover authority hardening and final workflow-model completion

---

# 0. Baseline and authority

The first Substrate adoption programme is complete.

The following work has already landed and is not reopened by this ADR:

- Substrate Issues v0 kernel and SQLite/WAL authority.
- Issue identity, immutable revisions and contract hashes.
- Readiness and atomic planning.
- Claims and workspace leases.
- Journal and Resume Capsules.
- Provenance, WorkReceipts and Git bindings.
- `sb` CLI.
- Pi Substrate integration.
- Claude Substrate plugin.
- Native Substrate gates replacing Beads gates.
- Specialists `WorkItemStore` / Substrate work boundary.
- Specialists Pi and Claude provider parity.
- Substrate-first `xt init`.
- Beads removal from the fresh-machine work stack.
- Workflow-skill migration away from Beads.
- One-way Beads import and historical preservation.
- Final adoption acceptance/reporting.

Current XTRM adoption PRs #178, #179, #180 and #181 are merged. The last of those is the A10 final acceptance/report landing. 

This ADR is therefore a **follow-on refinement of the now-canonical Substrate system**, not another migration from Beads.

It combines and supersedes the previously separate decisions covering:

1. repository-native `sb init` and project isolation; and
2. Journal outcomes, close reasons, actor identity, session lineage, automatic result publication, provenance and documentation.

There must be one authority document for these concepts.

---

# 1. Executive decision

Substrate remains XTRM's canonical local durable-work system.

The final model is:

```text
Git repository
      │
      └── sb init
             │
             ▼
     Substrate Project
             │
             ▼
          Issue
      ┌──────┼─────────┐
      │      │         │
 readiness  Journal   Provenance
      │      │         │
      └──────┼─────────┘
             │
       execution
             │
      result / closure
```

The canonical local authority remains:

```text
~/.xtrm/state.db
```

or the explicit:

```text
SUBSTRATE_DB
```

override.

One global state database may contain many repositories and many projects.

Therefore:

> **Global storage does not imply global project context.**

Every ordinary repository-scoped Substrate operation must resolve the current Git repository to its own Substrate Project.

If it cannot do so, it fails closed.

At the workflow layer:

> **Issue = authorized work.**

> **Journal = durable execution narrative and continuity.**

> **Resume Capsule = bounded reconstruction of unfinished work.**

> **Provenance = verifiable execution → artifact lineage.**

> **Closure = why and how an Issue became terminal.**

> **Memory = reusable validated knowledge, separate from the Issue Journal.**

---

# 2. Normal operator experience

The normal repository initialization workflow is:

```bash
cd <repository>
sb init
```

That is the complete normal setup operation.

The operator must not normally need to know or provide:

```text
project id
project prefix
project name
checkout-link id
repository-binding id
base branch
```

After initialization:

```bash
sb issue list
sb issue ready
sb issue create ...
sb issue show ...
sb issue note ...
sb journal ...
sb provenance ...
```

operate on that repository automatically.

`xt init` must consume the same operation:

```text
xt init
   ↓
Substrate enrollment
   ↓
sb init
   ↓
runtime enrollment / verification
```

Core must not independently implement project identity policy.

---

# 3. Git repository is the normal Substrate project boundary

The normal Substrate Project maps to the Git repository, not to an arbitrary checkout path.

One repository may have:

```text
main checkout
feature worktree
Specialist worktree
detached worktree
second local clone
```

All of these refer to the same logical repository and therefore the same Substrate Project when repository identity can be established.

A worktree does not create another Substrate Project.

A moved checkout does not create another Substrate Project.

A second clone of the same remote repository does not normally create another Substrate Project.

---

# 4. Remove global-cardinality project inference

The previous resolution rule:

```text
explicit project
→ SUBSTRATE_PROJECT
→ checkout link
→ if state.db has exactly one project, use it
→ fail
```

is rejected.

The existence of exactly one project in the global database is never evidence that the current repository belongs to it.

The target resolution rule is:

```text
explicit per-command override
→ explicit environment override
→ initialized repository identity
→ fail closed
```

There must be no:

```text
projects.length === 1
```

shortcut in normal authority resolution.

---

# 5. Cross-project isolation is a hard invariant

Given:

```text
~/.xtrm/state.db

prj_xtrm
  XTRM-1
  XTRM-2
```

and an unrelated uninitialized repository:

```text
~/dev/specialists
```

then:

```bash
cd ~/dev/specialists
sb issue list
```

must fail.

Expected guidance:

```text
This repository is not initialized for Substrate.

Run:
  sb init
```

It must never return:

```text
XTRM-1
XTRM-2
```

The same fail-closed rule applies to repository-relative:

```text
issue list
issue ready
issue tree
issue create
planning
journal mutation
provenance mutation
Specialist dispatch
claiming
closure
```

Wrong-project mutation is a P0 authority defect.

---

# 6. `sb init`

Add a canonical:

```bash
sb init
sb init --json
```

surface.

`sb init` performs the repository initialization operation atomically and idempotently.

Conceptually:

```text
discover Git repository
        ↓
resolve Git common repository
        ↓
derive repository identity
        ↓
detect repository base branch
        ↓
derive/find Substrate Project
        ↓
bind repository to Project
        ↓
register/update local checkout aliases
        ↓
verify
        ↓
ready
```

Do not implement this as CLI-recursion such as:

```text
sb project create
sb project link
...
```

Use typed services beneath the CLI.

---

# 7. Git common-root semantics

Repository resolution must be worktree-aware.

Use Git plumbing such as:

```text
git rev-parse --git-common-dir
```

or the equivalent canonical mechanism.

The following must resolve identically:

```text
main checkout
linked worktree A
linked worktree B
detached worktree
```

An operator initializes once at repository level.

Worktrees inherit the repository identity.

---

# 8. Canonical repository identity

When a canonical remote exists, repository identity is derived from a normalized remote identity.

Equivalent inputs such as:

```text
git@github.com:xtrm-dev/specialists.git
https://github.com/xtrm-dev/specialists.git
ssh://git@github.com/xtrm-dev/specialists.git
```

must normalize to one repository key, conceptually:

```text
github.com/xtrm-dev/specialists
```

Normalization must:

- remove credentials/tokens;
- normalize transport differences;
- normalize optional `.git`;
- retain host, owner/path and repository identity;
- remain deterministic.

Authenticated URLs must never be persisted with secrets intact.

---

# 9. Repositories without remotes

GitHub or any remote provider is not required.

`sb init` must support a local Git repository with no remote.

Use a deterministic local repository identity derived from the Git common repository.

Document the limitation:

A remote-less repository moved or independently cloned later may not be globally recognizable as the same repository unless a stable repository identity is subsequently established.

Do not hide this limitation with heuristics.

---

# 10. Base branch discovery

`sb init` automatically detects the repository's canonical/default base branch.

Preferred evidence should be deterministic, e.g.:

```text
remote HEAD
→ configured upstream/default reference
→ unambiguous conventional default branch
→ documented deterministic fallback
```

Examples:

```text
origin/HEAD → main
origin/HEAD → master
```

Running `sb init` from:

```text
feature/foo
```

must not make `feature/foo` the repository base.

Running from a detached worktree must remain valid.

---

# 11. Deterministic project identity

Substrate Project identity must be deterministic and human-legible.

Examples:

```text
github.com/xtrm-dev/xtrm
→
id:     prj_xtrm
prefix: XTRM
name:   xtrm
```

```text
github.com/xtrm-dev/specialists
→
id:     prj_specialists
prefix: SPECIALISTS
name:   specialists
```

Do not generate random Project IDs for ordinary repository initialization.

Internal machine Issue IDs may remain opaque; Project identity should not be needlessly opaque.

---

# 12. Collision policy

Two distinct repositories may share a basename:

```text
github.com/a/service
github.com/b/service
```

They must not collide.

Collision handling must be:

- deterministic;
- stable across machines;
- derived from canonical repository identity;
- non-random.

A later collision must not silently rename an established Project.

If necessary, deterministically incorporate owner/path into the Project identifier/prefix.

Document the algorithm.

---

# 13. Repository binding model

Path-only:

```text
checkout_links(git_root → project_id)
```

is insufficient as the primary authority.

A checkout can move.

A repository can have multiple worktrees.

A repository can have multiple clones.

Introduce an explicit repository-level binding, conceptually:

```text
repository_bindings

repository_key
project_id
base_branch
canonical_remote
created_at
updated_at
```

`repository_key` must be unique.

Checkout/common-root mappings may remain useful as local aliases/caches:

```text
checkout_links
```

but do not constitute canonical repository identity.

---

# 14. Existing Project preservation

Existing valid Substrate Projects must be adopted, not duplicated.

Important current example:

```text
prj_xtrm
prefix XTRM
existing XTRM Issues
```

When `sb init` is run inside the actual XTRM repository, repository identity should be attached to the existing Project.

Do not:

```text
create prj_xtrm_2
renumber XTRM Issues
change immutable human refs
change historical locators
rewrite Issue IDs
```

Imported Beads-era Projects receive the same preservation treatment.

---

# 15. Conflict behavior

If durable state contains contradictory evidence such as:

```text
repository A → project X

but project X is already authoritatively bound to unrelated repository B
```

fail closed.

Report:

- repository identity;
- conflicting Project;
- repair action.

Do not silently relink.

---

# 16. Explicit overrides

Advanced users may still need:

```text
--project
SUBSTRATE_PROJECT
```

for:

```text
cross-project inspection
automation
recovery
administration
tests
```

An override changes **effective command context**.

It does not mean:

```text
this repository is initialized
```

It does not persistently bind the checkout/repository.

Repository binding and effective override are distinct concepts.

---

# 17. `sb doctor`

`sb doctor` must expose these concepts separately.

Example:

```json
{
  "repository": {
    "repositoryKey": "github.com/xtrm-dev/specialists",
    "gitRoot": "/home/user/dev/specialists",
    "initialized": true,
    "baseBranch": "master"
  },
  "project": {
    "id": "prj_specialists",
    "prefix": "SPECIALISTS",
    "name": "specialists"
  },
  "effectiveOverride": null
}
```

For an uninitialized repository:

```json
{
  "repository": {
    "initialized": false
  },
  "project": null
}
```

With:

```bash
SUBSTRATE_PROJECT=prj_xtrm sb doctor --json
```

the output may report:

```text
repository.initialized = false
effectiveOverride = prj_xtrm
```

but must not claim the repository is initialized.

Remove `source:"single"` semantics.

---

# 18. Low-level project administration

Low-level commands may remain where useful:

```text
sb project list
sb project show
sb project links
sb project repair
sb project link --project ...
sb project unlink
```

They are advanced/recovery surfaces.

They are not the normal onboarding workflow.

Bare:

```bash
sb project link
```

must not infer the sole Project.

---

# 19. Core `xt init`

Core must delegate Project creation/resolution to Substrate.

The normal flow becomes:

```text
xt init
     │
     ├── provision/enroll Substrate
     │
     ├── sb init --json
     │
     ├── verify project/repository initialization
     │
     └── continue XTRM runtime setup
```

Current manual/intention surfaces such as:

```text
--sb-project
--sb-create-project PREFIX:Name
```

should disappear from the normal operator UX.

If retained temporarily for compatibility, they must be deprecated/admin-only and absent from normal recommended documentation.

Core must not derive Project IDs, names or prefixes itself.

---

# 20. Specialists integration

The existing Specialists Substrate boundary remains canonical.

Do not redesign:

```text
WorkItemStore
issue_ref dispatch
readiness gate
claim binding
ExecutionBinding
NativeActivationHost
MCP/Pi parity
```

The only repository-identity responsibility of Specialists is to consume the correct Substrate context.

Specialists must never derive its own Project naming algorithm.

---

# 21. Journal is a primary product surface

The Journal is not merely a compaction implementation detail.

It is the durable Issue-local execution narrative.

It replaces the useful parts of:

```text
Beads notes
Jira comments
operator progress comments
agent handoffs
specialist result notes
review findings
execution checkpoints
```

with typed semantics suitable for agentic work.

---

# 22. Canonical Journal kinds

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

Keep this vocabulary bounded.

Do not reduce everything to `note`.

Do not create dozens of nearly synonymous categories.

---

# 23. `note`

A general durable Issue-local annotation.

Examples:

```text
Upstream maintainer confirmed the behavior.

This fixture intentionally differs from production.

Reproduces only on Fedora.
```

Use a stronger type when appropriate.

---

# 24. `finding`

A material discovered fact.

Examples:

```text
SDK loads separate CJS and ESM instances.

Provider does not auto-discover this plugin file.

Race reproduces under eight concurrent writers.
```

A finding does not automatically modify Issue authority.

---

# 25. `decision`

A durable implementation or coordination choice.

Example:

```text
Use the official SDK server rather than maintaining a custom protocol layer.
```

If the decision changes executable authority:

```text
SCOPE
SUCCESS
CONSTRAINTS
VALIDATION
OUTPUT
```

then the Issue must be revised through planning.

A Journal decision cannot silently authorize scope.

---

# 26. `blocker`

A currently unresolved condition preventing progress.

Prefer structured references to:

```text
blocking Issue
PR
external dependency
required decision
provider condition
```

Blocker resolution should be additive; do not erase the original blocker entry.

---

# 27. `milestone`

A meaningful execution boundary.

Examples:

```text
Implementation complete; validation starting.

All child Issues merged; integration remains.

Provider adapter landed.
```

Do not create milestones for every command or trivial action.

---

# 28. `handoff`

A bounded continuation record.

A handoff should capture:

```text
completed
current
next
blocked
open questions
important decisions
important refs
```

It is not a transcript.

---

# 29. `result`

A durable bounded execution outcome.

This is essential for:

```text
Specialists
researchers
reviewers
validators
coordinators
non-code workers
```

A result may exist with zero Git commits.

A result should include or reference:

```text
attempted work
outcome/status
bounded summary
validation
important findings
artifact refs
receipt refs
activation/session lineage
```

---

# 30. `checkpoint`

A durable continuation boundary.

Mechanical data must be persisted first.

Optional semantic summary may follow.

If semantic summarization fails, continuity remains valid.

---

# 31. `compaction`

A checkpoint associated with model/session context compaction.

Before compaction:

```text
mechanical checkpoint
→ durable
→ optional semantic enrichment
→ model compaction
```

After:

```text
Resume Capsule
→ continue
```

Conversation summary is never the work authority.

---

# 32. Journal entry identity

Every Journal entry must have immutable identity and ordering.

At minimum:

```text
journal_entry_id
issue_id
issue_revision
sequence
kind
created_at
```

Then enrich with actor/execution context where known.

---

# 33. Actor model

Durable work events must identify who or what produced them where that information is known.

Canonical conceptual actor types:

```text
human
coordinator
agent
specialist
reviewer
validator
hook
runtime
system
```

Fields:

```text
actor_type
actor_id
actor_name
```

Do not fabricate actor identity.

Unknown stays unknown.

---

# 34. Session and execution lineage

Where the runtime knows them, automatically record:

```text
XTRM session ID
XTRM session name
xt launcher/session name
provider/host
Pi session ID
Claude session ID
participant ID
Specialist name
Specialist activation ID
attempt ID
AgentSession ID
ChainRun ID
coordinator session
workspace
worktree
branch
base commit
head commit
```

The model should not need to manually type these values.

---

# 35. Shared execution-context envelope

Define one common execution-context representation used across:

```text
Journal
Closure
ExecutionBinding
WorkReceipt
Specialists
Pi
Claude
hooks
```

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
    repository_key?
    repo_path?
    worktree?
    branch?
    base_commit?
    head_commit?

  timestamp
}
```

Provider adapters populate known fields.

Unknown values remain absent.

---

# 36. XTRM session identity

`xt` should expose stable session identity across process boundaries.

Conceptually:

```text
XTRM_SESSION_ID
XTRM_SESSION_NAME
```

or a typed equivalent.

These values should propagate to:

```text
Pi
Claude
Specialists
Journal
ExecutionBinding
WorkReceipt
Closure
```

when relevant.

Do not require models to copy them manually.

---

# 37. Specialist lineage

A Specialist activation should bind automatically:

```text
Issue
Issue revision
contract hash

participant
specialist
activation
attempt
AgentSession

coordinator participant/session

workspace
repository
branch
base commit
```

Retry and resume must preserve coherent lineage.

For example:

```text
same activation
different attempt
```

must remain distinguishable.

---

# 38. Automatic Specialist result publication

When a Specialist settles meaningfully:

```text
Specialist
    ↓
runtime result storage
    +
WorkReceipt/provenance
    +
Journal result
```

Journal publication should be automatic.

Do not rely on the Specialist remembering to append its own result note.

---

# 39. Bounded result publication

Do not dump arbitrary raw model output into the Journal.

Prefer:

```text
result.summary
result.outcome
result.completed[]
result.validation
result.findings[]
result.artifact_refs[]
result.provenance_refs[]
```

Full raw output can remain in runtime storage/artifacts.

The Journal references it.

---

# 40. Non-code work

A legitimate work result does not require a Git commit.

Examples:

```text
research
architecture review
security review
validation
diagnosis
provider investigation
planning analysis
```

must still be representable as:

```text
Journal result
+
provenance
+
Closure where applicable
```

Never make Git commit presence the definition of completed work.

---

# 41. Closure is first-class

A terminal Issue transition must preserve more than:

```text
state = done
```

Introduce/normalize immutable closure data.

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
execution_context

validation_refs
journal_result_refs
receipt_refs
artifact_refs

closed_at
```

Closure must be queryable directly.

---

# 42. Closure outcomes

Use a bounded outcome vocabulary such as:

```text
completed
superseded
duplicate
wont_fix
invalid
cancelled
abandoned
```

Lifecycle state and closure outcome are not the same thing.

Example:

```text
lifecycle_state = done
closure.outcome = completed
```

---

# 43. Close reason

A deliberate terminal transition requires a durable close reason.

Canonical UX:

```bash
sb issue close XTRM-227 \
  --outcome completed \
  --reason "Implemented and validated against the accepted contract."
```

Potential references:

```text
--result
--receipt
--validation
```

The close reason must never be recoverable only from:

```text
git log
```

---

# 44. Automatic closure context

If a runtime already knows:

```text
participant
session
activation
attempt
receipt
validation
result
workspace
```

those should be bound automatically.

The human/model supplies only what cannot be derived, notably the semantic closing reason when required.

---

# 45. Reopen semantics

Reopening preserves historical closure.

A reopen:

```text
keeps old Closure
adds reopen event/reason
restores lifecycle state
invalidates/rechecks readiness where required
```

Potential UX:

```bash
sb issue reopen XTRM-227 \
  --reason "Regression reproduced after release."
```

Never mutate away the historical Closure.

---

# 46. Cancellation semantics

Distinguish:

```text
activation cancelled
```

from:

```text
Issue cancelled
```

Stopping one execution does not automatically cancel the Issue.

Cancelling an Issue creates terminal lifecycle/closure state.

---

# 47. Failure history

Failed Specialist attempts remain durable even if a retry later succeeds.

Example:

```text
attempt 1 → failed
attempt 2 → failed
attempt 3 → completed
```

Do not rewrite history into only the final successful attempt.

---

# 48. `sb issue note`

Provide ergonomic Journal append syntax.

Required:

```bash
sb issue note <ref> "text"
sb issue note <ref> --file path
sb issue note <ref> --file -
```

Typed form:

```bash
sb issue note <ref> "..." --kind finding
sb issue note <ref> "..." --kind decision
sb issue note <ref> "..." --kind blocker
sb issue note <ref> "..." --kind milestone
sb issue note <ref> "..." --kind handoff
```

`result`, `checkpoint` and `compaction` may use richer validation/surfaces.

No mutable notes blob.

---

# 49. First-class Journal CLI

Retain a richer Journal surface:

```text
sb journal append
sb journal show
sb journal since
sb journal checkpoint
sb journal render
```

Useful additions may include:

```text
sb journal latest
sb journal timeline
```

All convenience commands must use the same underlying JournalService semantics.

---

# 50. `sb issue show`

Default Issue display should include bounded recent operational context.

Conceptually:

```text
XTRM-227 · Implement feature

state: done
revision: 4
readiness: ready

latest:
  finding   ...
  decision  ...
  result    ...

closure:
  completed
  reason: ...

provenance:
  receipts: 2
  commits: 3
  PRs: 1
```

Do not dump the complete Journal by default.

---

# 51. Coordinator methodology

Coordinator Journals represent programme continuity, not child transcript aggregation.

A root/coordinator Journal should contain:

```text
programme decisions
cross-child blockers
integration milestones
child status transitions
critical path
pending questions
dispatch/retry decisions
release gates
```

A coordinator checkpoint should reference:

```text
child Issues
child states
latest child checkpoints
active claims
active Specialists
pending asks
important receipts/PRs
```

Do not duplicate full child Journal bodies.

---

# 52. Ordinary-worker methodology

Ordinary workers Journal high-signal durable facts only.

Do Journal:

```text
material finding
important decision
external blocker
meaningful milestone
handoff
result
checkpoint
```

Do not Journal:

```text
every shell command
every tool call
chain-of-thought
transient speculation
routine exploration
```

---

# 53. Reviewer and validator methodology

Reviewers and validators are actors.

Their durable output may include:

```text
Journal result
Journal findings
validation refs
receipt/evidence refs
```

Example:

```text
outcome = PASS_WITH_NOTES

findings:
- stale-attestation path lacks test
- retry lineage incomplete
```

No commit required.

---

# 54. Issue versus Journal boundary

The Issue owns execution authority.

The Journal records what happens.

Therefore:

```text
progress update
→ Journal

finding
→ Journal

decision within existing authority
→ Journal

blocker
→ Journal

result
→ Journal

handoff
→ Journal
```

But:

```text
SCOPE changes
SUCCESS changes
CONSTRAINT changes
VALIDATION changes
OUTPUT changes
material scrutiny/ownership changes
```

require:

```text
stop execution
→ /planning
→ new Issue revision
→ readiness
→ continue
```

Do not use Journal entries to bypass contract revision.

---

# 55. Resume methodology

Normal continuation reconstructs from:

```text
current Issue revision
+
latest checkpoint
+
Journal delta since checkpoint
+
claim
+
blockers
+
child status
+
pending asks
+
provenance state
```

This produces the Resume Capsule.

A worker should not need the previous chat transcript.

---

# 56. Provenance is release-critical

Durable state should answer:

```text
What Issue authorized this work?
Which exact revision?
What contract hash?
Which repository/project?
Who executed it?
Which XTRM session?
Which provider session?
Which Specialist?
Which activation?
Which attempt?
Which workspace/worktree?
Which base/head commit?
What result was published?
What validation ran?
Which WorkReceipt represents it?
Which commits/PRs/artifacts resulted?
Who closed the Issue?
Why did it close?
```

If XTRM knew the answer when generating durable evidence but failed to store it, treat that as a provenance defect.

---

# 57. Automatic provenance enrichment

Models should not manually construct execution identity metadata.

Prefer runtime APIs conceptually like:

```text
journal.append({
  issue,
  kind,
  body,
  executionContext: runtimeContext
})
```

rather than requiring model-written:

```text
--session
--activation
--attempt
--participant
--branch
...
```

Manual fields may remain for recovery/testing.

---

# 58. Provenance graph

Use references between durable entities.

Conceptually:

```text
Repository
   ↓
Project
   ↓
Issue revision
   ↓
readiness
   ↓
claim
   ↓
ExecutionBinding
   ↓
participant/session/activation/attempt
   ↓
Journal result
   ↓
WorkReceipt
   ↓
commit / PR / artifact
   ↓
Closure
```

Do not reduce this graph to strings embedded only in prose.

---

# 59. Git relationship

Git remains code/integration truth.

But:

```text
commit message != Journal
commit message != Closure
commit message != Specialist result
```

A commit is an artifact linked by provenance.

A useful result may exist without one.

---

# 60. External projections

GitHub/Jira projection should be selective.

Potentially project:

```text
important finding
decision
result
closure
high-value note
```

Do not normally project:

```text
mechanical checkpoint
compaction checkpoint
low-level runtime event
```

Remote comments remain coordination data.

They never silently modify the local Issue contract.

---

# 61. Inbound external comments

When imported, an external comment should preserve:

```text
provider
remote ID
remote author
timestamp
trust boundary
```

and normally enter as an Issue-local note/external-input record.

It does not become executable authority.

---

# 62. MCP surfaces

Substrate MCP tools must reflect these semantics.

Required capabilities include equivalents for:

```text
issue get/search
issue claim/release
issue update
issue resume
journal append
journal checkpoint
journal query
issue close
provenance trace
```

A convenience Issue note tool may exist if it improves agent behavior.

Do not multiply permanent tool names unnecessarily; op-discriminated tools are acceptable when they remain clear.

---

# 63. Tool descriptions are normative instruction surfaces

Tool descriptions must explain:

- what the tool changes;
- what it does not change;
- whether Issue revision changes;
- whether readiness becomes stale;
- whether Journal should be used instead;
- what actor/session/provenance context is added automatically.

Example:

```text
Issue update changes execution-authoritative Issue fields.
Contract-bearing changes create a new revision and invalidate prior readiness.

Do not use this tool for progress, findings, decisions, handoffs or results.
Use the Journal for those.
```

---

# 64. Journal tool descriptions

Tool descriptions should explain the Journal kinds sufficiently for correct agent use:

```text
note       generic useful annotation
finding    material discovered fact
decision   chosen course/rationale
blocker    unresolved condition preventing progress
milestone  meaningful progress boundary
handoff    bounded continuation state
result     bounded participant outcome
checkpoint resumability boundary
```

---

# 65. Docstrings and API documentation

Public durable-work APIs require useful semantic documentation.

Especially:

```text
IssueService
JournalService
ResumeService
ProvenanceService
ClosureService
WorkItemStore
repository identity/binding service
execution-context utilities
Specialist settlement adapters
```

Document:

```text
authority
durability
side effects
revision/readiness behavior
automatic metadata
idempotency
failure behavior
```

Do not add comments that merely restate function names.

---

# 66. CLI help

`sb` help must teach methodology, not only flags.

Examples:

```bash
sb help init
sb issue edit --help
sb issue note --help
sb issue close --help
sb journal --help
sb provenance --help
```

`issue edit` help should explicitly say not to use it for progress.

`issue close` should explain outcomes/reason/provenance.

`init` should explain repository identity.

---

# 67. Canonical documentation

Maintain a clear documentation hierarchy:

```text
docs/substrate/README.md
docs/substrate/workflow.md
docs/substrate/journal.md
docs/substrate/provenance.md
docs/substrate/repository-identity.md
docs/substrate/cli.md
```

The PRD remains architectural authority.

Operator docs explain the finished system.

---

# 68. Journal documentation

`journal.md` must cover:

```text
purpose
what Journal is not
all Journal kinds
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
result size discipline
querying
resume integration
provenance links
retention
historical Beads notes
```

Include examples of every kind.

---

# 69. Provenance documentation

Show both forward and reverse graphs.

Forward:

```text
Issue
→ ExecutionBinding
→ participant/session
→ result
→ receipt
→ commit/PR/artifact
→ closure
```

Reverse examples:

```text
commit → receipt → Issue
session → Issues touched
activation → Issue
Issue → executions
Issue → results
Issue → PRs
closure → result/receipt
```

---

# 70. Repository identity documentation

Explain:

```text
one global state.db
many Projects
one normal Project per Git repository
sb init
worktree inheritance
clone recognition
remote normalization
base branch detection
local-no-remote behavior
advanced overrides
collision handling
```

Normal operator documentation should remain simple.

Internals belong in reference docs.

---

# 71. Skills are P0 documentation

Skills are executable documentation.

Canonical skills must correctly teach:

```text
using-xtrm
planning
starting-and-resuming-work
using-specialists
implementation
review
handoff/closeout
coordinator workflows
```

Any skill that merely replaces `bd` with `sb` without teaching Issue/Journal/Resume/Provenance semantics fails.

---

# 72. Skill rules for initialization

Skills should teach:

```text
If Substrate reports this repository is uninitialized:
    run sb init.
```

Do not teach:

```text
guess the only project
invent a project id
manually create/link during normal work
```

---

# 73. Skill rules for Journal

Canonical guidance:

```text
material fact
→ finding

architectural choice
→ decision

blocked condition
→ blocker

progress boundary
→ milestone

handoff
→ handoff

completed bounded run
→ result

ordinary useful annotation
→ note

authorized work changed
→ STOP
→ /planning
→ new Issue revision
```

---

# 74. Coordinator skills

Coordinator workflows periodically inspect:

```text
children
claims
pending asks
new results
blockers
provenance
release gates
```

and Journal only material root-level state.

No giant rewritten root description.

No child transcript duplication.

---

# 75. Closeout skills

Before closure:

```text
SUCCESS satisfied
VALIDATION complete
required OUTPUT exists
material result durable
important decisions/findings durable
provenance sufficient
no incompatible blocker remains
```

Then write structured Closure.

Do not close solely because a commit exists.

---

# 76. Hooks

Substrate hooks should enrich durable state without creating noise.

Examples:

```text
PreCompact
→ checkpoint with actor/session identity

commit/provenance hook
→ receipt/commit binding

session stop
→ continuity/claim/result checks
```

Do not append generic Journal entries for every hook invocation.

---

# 77. Stop gate

The stop gate should consider:

```text
active claimed work
unrecorded meaningful result
pending Specialist asks
missing checkpoint/handoff
closure readiness
```

For unfinished work:

```text
checkpoint / handoff
→ release/retain claim per policy
→ session may end
```

For completed work:

```text
result
→ validation/provenance
→ closure
```

Never require fake completion.

---

# 78. Beads historical note mapping

Historical imported Beads content maps conservatively:

```text
ordinary note
→ Journal note

known Specialist result
→ Journal result where deterministic

known handoff
→ Journal handoff where deterministic

ambiguous note
→ Journal note
```

Preserve:

```text
legacy Beads ID
timestamp where known
author where known
source=beads
```

Never guess a stronger semantic type.

---

# 79. Historical Beads close reasons

A historical Beads close reason maps into Substrate Closure where possible.

Preserve:

```text
reason
legacy state
timestamp
actor where known
source=beads
```

Do not bury close reason in generic Journal text.

---

# 80. Query capability

Underlying services should permit queries such as:

```text
results for Issue
latest result
decisions for Issue
current blockers
sessions touching Issue
Issues touched by session
activations for Issue
closure outcomes
closures lacking provenance
results lacking receipts
```

Not every query requires a dedicated CLI command immediately.

The data model must support them.

---

# 81. Session-centric provenance queries

Useful surfaces may include:

```bash
sb provenance session <session-id>
sb provenance activation <activation-id>
```

or equivalent service/MCP operations.

The goal is to answer:

```text
What did this xt session touch?
What did this Claude session modify?
What did activation act_123 produce?
```

---

# 82. Documentation anti-drift

Where practical, mechanically connect docs to runtime definitions.

Examples:

```text
Journal kinds ↔ JOURNAL_KINDS
closure outcomes ↔ enum
CLI docs ↔ command registrations
MCP tool docs ↔ tool registrations
skill command references ↔ supported CLI surface
```

CI should detect drift.

---

# 83. Documentation release gate

Fail CI when appropriate if:

```text
public Journal kind undocumented
public closure outcome undocumented
public sb command lacks help
public MCP tool lacks meaningful description
documented tool inventory differs from registration
skill teaches retired command
skill bypasses Journal methodology
```

---

# 84. Fresh repository acceptance

With an isolated HOME:

```text
no state.db
no existing Substrate project
```

create a Git repository.

Run:

```bash
sb init
```

Prove:

```text
repository detected
base branch detected
deterministic Project created
repository binding persisted
second sb init is idempotent
sb issue list works
```

No project metadata prompt.

---

# 85. Multi-repository isolation acceptance

Create:

```text
repo A: xtrm
repo B: specialists
```

Initialize only A.

From B:

```bash
sb issue list
```

must fail with:

```text
run sb init
```

Initialize B.

Prove:

```text
A only sees A Issues
B only sees B Issues
```

This is release blocking.

---

# 86. Worktree acceptance

For one initialized repository, create several worktrees.

From all of them:

```bash
sb issue list
```

must resolve the same Project.

No repeated initialization.

No worktree-specific Project.

---

# 87. Multi-clone acceptance

Clone the same canonical remote repository to two paths.

The two checkouts must resolve to the same repository identity and Project.

No duplicate Issue namespace.

---

# 88. Remote-normalization acceptance

Prove equivalent repository identity across:

```text
SSH scp form
HTTPS form
ssh:// form
.git / non-.git forms
```

Prove credentials are stripped.

---

# 89. Basename-collision acceptance

Initialize:

```text
org-a/service
org-b/service
```

Prove:

```text
different Projects
deterministic IDs
no random suffix
no accidental sharing
```

---

# 90. Existing-store acceptance

Use a realistic existing state containing:

```text
prj_xtrm
Issues
revisions
Journal
claims
provenance
```

Run `sb init` in the real XTRM repository.

Prove:

```text
existing Project adopted
no duplicate
Issue refs unchanged
Journal/provenance preserved
```

---

# 91. Override acceptance

From an uninitialized repo:

```bash
SUBSTRATE_PROJECT=prj_xtrm sb issue list
```

may intentionally access XTRM.

But:

```text
sb doctor
```

must still say the repository itself is uninitialized.

`xt init` must still initialize that repository rather than accepting the override as a persistent binding.

---

# 92. Journal end-to-end acceptance

Session A:

```text
claim
finding
decision
milestone
checkpoint
end
```

Session B:

```text
resume
read Capsule
dispatch Specialist
automatic result
validate
receipt
close with reason
```

Session C:

```text
inspect Issue
```

Session C must reconstruct:

```text
authorized contract
progress
findings
decisions
Specialist result
validation
execution lineage
artifacts
closure reason
participants/sessions
```

without old chat transcripts.

---

# 93. Coordinator acceptance

Create root Epic + multiple children.

Coordinator Resume Capsule must recover:

```text
child states
latest checkpoints
results
pending asks
blockers
critical decisions
release state
```

without copying all child Journals.

---

# 94. Specialist provenance acceptance

A Specialist run must produce a queryable chain:

```text
Repository
→ Project
→ Issue revision/hash
→ claim
→ ExecutionBinding
→ coordinator/session
→ activation
→ attempt
→ AgentSession
→ Journal result
→ WorkReceipt
→ artifacts
→ Closure if terminal
```

---

# 95. No-commit acceptance

Run a research/review Issue with:

```text
zero code changes
zero commits
```

but with:

```text
findings
result
evidence
closure
```

The Issue must still be complete and understandable.

---

# 96. Close-reason acceptance

Close Issues as:

```text
completed
superseded
duplicate
cancelled
```

Verify:

```text
reason durable
actor durable
session durable when known
revision/hash durable
result/receipt refs durable
history immutable
```

---

# 97. Automatic identity acceptance

Prove automatic propagation:

```text
xt session
→ Pi/Claude
→ Journal
→ same XTRM session id/name
```

and:

```text
coordinator
→ Specialist activation
→ result
→ coordinator lineage preserved
```

and:

```text
retry
→ same activation
→ new attempt
→ both attempts queryable
```

---

# 98. No fabricated provenance

If a value is unknown, store:

```text
null / absent
```

Never heuristically invent:

```text
session id
activation id
participant id
repository identity
```

from model prose or display labels.

---

# 99. Non-goals

This ADR does not authorize:

```text
new issue tracker
new database per repo
Beads reintroduction
Journal-as-memory
Journal-as-authority
commit-message-as-close-reason
project-per-worktree
GitHub-only operation
random project IDs
full transcript persistence
automatic contract mutation from comments
second Specialist authority implementation
```

---

# 100. Implementation ownership

## `xtrm-dev/xtrm`

Own:

```text
repository identity
repository bindings
sb init
Issue/Journal/Closure/Provenance services
execution-context model
Substrate Pi/Claude integration
CLI/MCP/docs
```

## `xtrm-dev/core`

Own:

```text
xt init consumption of sb init
session identity propagation
managed skills/instructions
operator/runtime installation
doctor integration
```

Core does not reimplement repository identity.

## `xtrm-dev/specialists`

Own:

```text
activation/session execution
automatic result publication integration
Specialist lineage
provider adapters
```

Specialists does not own Issue persistence or Project identity.

---

# 101. Recommended implementation order

```text
A. Repository authority
   repository identity schema
   sb init
   resolver isolation
   doctor
   Core consumption

B. Journal/Closure domain
   note/result kinds
   Closure model
   close/reopen semantics

C. Execution identity
   shared ExecutionContext
   xt session propagation
   provider/session bindings

D. Automatic result/provenance
   Specialist settlement
   WorkReceipt links
   closure links

E. Tooling/docs
   CLI
   MCP
   docstrings
   skills
   operator docs

F. Full adversarial acceptance
```

Repository isolation must land before automatic high-volume provenance writes.

---

# 102. Final architectural invariant

The final XTRM work record is:

```text
Git repository
      ↓
sb init
      ↓
Substrate Project
      ↓
Issue rev N
contract hash
      ↓
readiness
      ↓
claim
      ↓
XTRM session
      ↓
coordinator / participant
      ↓
Specialist activation
      ↓
attempt / AgentSession
      ↓
Journal
  finding
  decision
  blocker
  milestone
  result
      ↓
WorkReceipt
      ↓
commit / PR / artifact / evidence
      ↓
validation
      ↓
Closure
  outcome
  reason
      ↓
future worker can reconstruct the work
```

No step depends on Beads.

No step depends on old chat history.

No step depends on project inference from global database cardinality.

No closing explanation depends only on Git commits.

---

# 103. Definition of complete

This ADR is complete only when all of the following are mechanically true:

> **A new Git repository can enter the XTRM/Substrate workflow with one command: `sb init`.**

> **An uninitialized repository can never see or mutate another repository's Issues merely because that Project is the only one in the shared database.**

> **All worktrees and recognizable clones of one repository resolve to the same Project.**

> **Substrate can durably explain what was authorized, what happened, who and which sessions performed it, what result was produced, what evidence/artifacts resulted, and why the Issue reached its terminal state.**

> **A new worker can resume unfinished work from Issue + Journal + Resume Capsule + Provenance without the previous chat transcript.**

> **CLI help, MCP tool definitions, public APIs/docstrings, skills and operator documentation all teach the same model.**

The final normal workflow is:

```bash
git clone <repo>
cd <repo>
sb init

sb issue ...
```

and the final durable execution model is:

```text
Issue
+ Journal
+ Resume
+ Provenance
+ Closure
```

with automatic actor/session lineage wherever XTRM already knows it.
