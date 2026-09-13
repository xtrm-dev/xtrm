# PRD — XTRM Substrate Issues v0

> **Amendment relationship:** [ADR Amendment A1](./sbcloseout3-adr.md) (P0 / release-blocking, accepted) amends the parent closeout ADR [sbcloseout2-adr.md](./sbcloseout2-adr.md). Its implementation board is xtrm-vza; sbcloseout2 remains authoritative for xtrm-6qu scope. [sbcloseout4-adr.md](./sbcloseout4-adr.md) (ACCEPTED 2026-09-12) supersedes sbcloseout3-adr.md as the single authority for repository identity, Journal, outcomes, session lineage, provenance, and documentation. Operator entry point: [README.md](./README.md) and the [workflow.md](./workflow.md) hierarchy (workflow, journal, provenance, repository-identity, cli). Implement from this baseline plus the amendment text as written. Do not implement from conflicting summaries.

**Status:** Final design / implementation baseline v1.0  
**Date:** 2026-09-09  
**Owner:** `xtrm-dev/xtrm`  
**Target package:** `packages/substrate`  
**Primary CLI:** `sb`  
**Primary local authority:** SQLite/WAL through the Substrate library/service  
**Primary agent surfaces:** native Pi extension and native Claude Code plugin/MCP integration  
**Scope:** durable issue/work graph, executable contracts, planning, claims, work journal, resume/compaction continuity, execution provenance, GitHub/Jira projections, Beads migration compatibility

> **Core invariant:** Substrate owns durable work. An agent may only execute tracked work from a current, unambiguous, dispatchable Issue revision. The work journal preserves continuity. Provenance preserves what execution produced. Neither journal entries nor agent messages silently change work authority.

---

## 1. Document role and authority

This PRD defines the first implementable Substrate product slice: **Substrate Issues v0**.

It folds the accepted issue-tracking parts of:

- `docs/substrate/substrate_design_it.md`;
- `docs/substrate/substrate-light-prd.md`;
- `docs/runtime/prd/native-chain-runtime.md` where that document depends on durable work authority;
- `docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md` where that document depends on Beads for tracked work;
- the current `/planning`, `/using-xtrm`, `/starting-and-resuming-work`, `/using-specialists`, board-triage and contract-writing doctrine;
- the migration lessons from current Beads usage and Beads' current claim/GitHub-sync implementation;
- the accepted XTRM direction for native Pi and Claude integrations;
- the work-journal, compaction continuity and Git provenance decisions made during the final Substrate reconciliation.

On merge, this document **supersedes `substrate-light-prd.md` as the implementation baseline**. It does not supersede the full Substrate design outside this bounded slice. The full design remains the target architecture for later Containers, Chains, Channels, memory, daemonization and other domains except where this PRD explicitly replaces issue-system assumptions.

Before production implementation is called complete, the active runtime and Specialists documentation must be reconciled so no current normative document still says that Beads owns durable work.

---

## 2. Product thesis

XTRM needs a durable work substrate designed for agents rather than an issue tracker adapted after the fact.

The system must make four different concepts explicit:

```text
Issue
  what work is authorized

Journal
  what has happened and what the coordinator currently knows

Execution / Provenance
  who or what executed the work and what durable artifacts resulted

Projection
  how selected work appears in GitHub, Jira or other external systems
```

These concepts are related but are not interchangeable.

The target flow is:

```text
intent / requirement
      ↓
/planning
      ↓
PlanDraft
      ↓ atomic validation + apply
Substrate Issues + graph
      ↓
current Issue revision becomes dispatchable
      ↓
claim / assignment
      ↓
Pi / Claude / Specialist / future Chain execution
      ↓
Journal checkpoints + immutable events
      ↓
WorkReceipts + commits + validation + PR
      ↓
close / follow-up / memory candidates
```

The design deliberately removes the need for agents to maintain scattered Markdown handoffs, checkpoint documents, ad-hoc task lists or private prompt-only scope explanations.

Markdown remains a useful **human projection**. It is not the primary mutable storage model.

---

## 3. Goals

Substrate Issues v0 must provide:

1. a three-layer Issue identity model: immutable machine ID, immutable project-scoped human reference, and derived hierarchical locator;
2. immutable Issue revision history;
3. the canonical seven-field executable work contract;
4. explicit SCRUTINY policy input;
5. deterministic structural validation;
6. semantic readiness attestation bound to an exact Issue revision and contract hash;
7. fail-closed dispatch for ambiguous or incomplete work;
8. parent/child hierarchy with human-readable hierarchical locators that never become canonical identity;
9. typed blocking and non-blocking graph relationships;
10. deterministic readiness derived from contract, graph and runtime state;
11. atomic claims with renewable leases and anti-steal behavior;
12. workspace writer leases separate from Issue claims;
13. atomic multi-Issue planning and graph application;
14. deterministic context inheritance with source provenance;
15. append-only Issue events;
16. an Issue-scoped structured Work Journal;
17. mechanical and semantic checkpoints;
18. cheap resume capsules for long-running coordinator work;
19. host-owned compaction checkpoint integration for Pi and Claude Code;
20. execution bindings from Issue revision to participant/activation/attempt/workspace;
21. automatic Git commit provenance;
22. durable WorkReceipts and repository provenance bundles;
23. GitHub native projection using sub-issues, dependencies, issue types and issue fields where available;
24. selective Jira programme projection and stable external bindings;
25. idempotent external integration inbox/outbox semantics;
26. durable aliases and import compatibility for historical Beads IDs;
27. a temporary Beads compatibility backend without permanent dual-write;
28. native `sb` CLI, Pi extension and Claude plugin surfaces over one library/service;
29. agent skills and hooks that teach and enforce the same authority model;
30. a bounded path to later XTRM memory without treating the Journal as memory.

---

## 4. Non-goals

Substrate Issues v0 does **not** implement:

```text
full Chain scheduler
ResolvedChain / ChainRun implementation
Containers
Channels
full participant messaging runtime
full XTRM memory system
universal evidence platform
remote multi-host scheduler
CRDT issue replication
permanent Beads dual-write
GitHub or Jira as authoritative local work stores
generic provenance analytics platform
full state daemon requirement
GUI/TUI issue browser as a release prerequisite
```

A future daemon may host the same service and schema. v0 must not require one to prove the model.

---

## 5. Hard invariants

The implementation must preserve these statements.

```text
Substrate owns durable work.

Canonical Issue identity is stable and does not encode hierarchy. Human-facing hierarchy is represented separately as a derived locator.

An Issue revision is authority; a Journal entry is not.

A message is coordination; a message is not authority.

A prompt argument may not silently supplement an incomplete Issue.

A draft or semantically ambiguous Issue may not be claimed for executable work.

A dispatch gate must use the same readiness service as the CLI and integrations.

Blocked is derived from graph state; it is not a stale stored flag.

In-progress/claimed is derived from a live claim; it is not a stale stored flag.

Issue claim and workspace writer lease are distinct authorities.

Many readers may coexist. At most one active writer may mutate one workspace.

Every mutation that matters is revisioned and evented.

Every execution binds to the exact Issue revision it was authorized from.

The executor does not self-certify provenance.

Compaction is lossy conversation management, never durable work state.

A mechanical checkpoint exists even when semantic checkpoint generation fails.

Markdown, JSONL, Mermaid and HTML are projections/export formats, not canonical mutable storage.

GitHub/Jira are projections and intake surfaces, not silent last-writer-wins authorities.

Legacy Beads identifiers remain resolvable after Beads stops being required.

Journal != memory.
```

---

## 6. Package and ownership model

The implementation lands as a first-class XTRM package:

```text
packages/substrate/
├── src/
│   ├── domain/
│   │   ├── issue.ts
│   │   ├── contract.ts
│   │   ├── readiness.ts
│   │   ├── edge.ts
│   │   ├── claim.ts
│   │   ├── journal.ts
│   │   ├── execution-binding.ts
│   │   ├── provenance.ts
│   │   └── external-binding.ts
│   ├── service/
│   │   ├── issue-service.ts
│   │   ├── planning-service.ts
│   │   ├── journal-service.ts
│   │   ├── resume-service.ts
│   │   ├── provenance-service.ts
│   │   └── integration-service.ts
│   ├── store/
│   │   ├── sqlite.ts
│   │   ├── migrations/
│   │   └── transactions.ts
│   ├── projections/
│   │   ├── github/
│   │   ├── jira/
│   │   └── filesystem/
│   ├── compatibility/
│   │   └── beads/
│   └── exports/
├── cli/
├── integrations/
│   ├── pi/
│   └── claude-code/
├── hooks/
├── skills/
│   └── using-substrate/
├── contracts/
└── tests/
```

The exact publish/package split may change for ecosystem packaging reasons, but the semantic ownership does not.

### 6.1 Library first, CLI as first consumer

The CLI proves the service. It does not become the service.

Required architecture:

```text
                 ┌──────── sb CLI
                 │
IssueService ────┼──────── Pi extension
                 │
                 ├──────── Claude plugin / MCP
                 │
                 ├──────── Git hooks / adapters
                 │
                 └──────── future Specialists / Chains / UI
```

Forbidden normal architecture:

```text
Pi extension  → exec("sb ...")
Claude MCP    → exec("sb ...")
Specialists   → parse CLI text
```

All first-party integrations call the typed library/service directly where their host allows it. Command hooks are adapters only where the host lifecycle exposes hooks rather than an in-process library seam.

---

## 7. Storage authority

### 7.1 Canonical store

Substrate v0 uses SQLite in WAL mode as the canonical local store.

Default location:

```text
~/.xtrm/state.db
```

The store may contain multiple registered projects/repositories. This keeps Issue identity and cross-project relationships independent from one specific worktree and preserves the full-design direction of one XTRM state authority.

v0 runs the service in-process. A later XTRM daemon may own the same schema and service boundary without changing consumers.

### 7.2 Files are projections

The following may be generated:

```text
JSON
JSONL
Markdown
Mermaid
HTML
portable export bundles
repository provenance bundles
```

They are inspectable and versionable where useful, but they are not the canonical mutable Issue database.

### 7.3 Transaction rule

A successful state mutation transaction must, where applicable:

```text
check expected revision / idempotency key
→ validate command
→ mutate current projection
→ append immutable event
→ append immutable revision if contract changed
→ enqueue external projection work
→ commit atomically
```

A failed transaction commits none of these effects.

---

## 8. Issue identity and aliases

Substrate deliberately separates **canonical identity**, **durable human reference**, and **hierarchical navigation**.

The three forms are:

```text
machine identity
  iss_0199...
  immutable · globally stable · normally hidden

human reference
  XTRM-227
  immutable · project-scoped · safe to cite permanently

hierarchical locator
  XTRM-184.2.3
  derived from the current parent/child tree · optimized for navigation
```

The three values may refer to the same Issue at the same time. They have different semantics and must not be conflated.

### 8.1 Canonical machine identity

Every Issue receives an opaque immutable machine ID. Recommended form:

```text
iss_<uuidv7-or-equivalent>
```

The machine ID is the primary database identity and the value stored in foreign keys, revisions, claims, journal entries, execution bindings, WorkReceipts and provenance records. It survives reparenting, title changes, project display changes and external projection changes.

Normal human-facing surfaces should not require users or agents to work with the opaque ID unless they are debugging, resolving ambiguity or inspecting raw provenance.

### 8.2 Durable human reference

Every Issue also receives one immutable project-scoped human reference, for example:

```text
XTRM-227
```

The project owns the prefix and allocates the numeric component atomically. Human references are never renumbered and never reused.

This is the preferred durable citation for:

```text
commit messages and trailers
PR discussion
Jira/GitHub cross-references
operator conversation
documentation
journal entries and handoffs
CLI input
```

A reparented Issue remains `XTRM-227`.

### 8.3 Hierarchical locator

Substrate also exposes a derived hierarchical locator for tree navigation. Example:

```text
XTRM-184
├─ XTRM-184.1
├─ XTRM-184.2
│  ├─ XTRM-184.2.1
│  ├─ XTRM-184.2.2
│  └─ XTRM-184.2.3   ← durable human reference may be XTRM-227
└─ XTRM-184.3
```

The root component is the root Issue's durable human reference. Each `parent_child` edge receives a monotonically allocated `child_slot` within its parent. Child slots are not sibling sort positions and are not reused. Inserting or reordering siblings therefore does not renumber existing locators.

The locator is a navigation address, not identity. Reparenting changes the current locator but preserves both immutable identities:

```text
before
  machine:  iss_0199...
  human:    XTRM-227
  locator:  XTRM-184.2.3

after reparent
  machine:  iss_0199...
  human:    XTRM-227
  locator:  XTRM-184.4.2
```

The previous locator becomes a historical locator alias that continues to resolve to the same Issue and should report the current locator. This prevents old comments, reports and handoffs from becoming dead references while still allowing the tree to evolve.

This is explicitly rejected as the canonical identity model:

```text
ID = XTRM-184.2.3
```

because reparenting would either require identity renames or leave an ID that lies about current structure.

### 8.4 Display rules

Human-oriented surfaces should normally prefer:

```text
XTRM-184.2.3 · XTRM-227 · Dispatch gate
```

When the tree context is already obvious, a compact renderer may show:

```text
184.2.3  Dispatch gate
```

The opaque `iss_...` value belongs in inspect/debug/provenance detail, not routine lists.

### 8.5 Aliases

Historical and external identifiers are first-class aliases:

```text
unitAI-xoum6
xtrm-q99
KAN-127
ISSUE-92
github:xtrm-dev/xtrm#119
XTRM-184.2.3        # historical locator after a move
```

`sb issue show <ref>` must accept machine ID, durable human reference, current hierarchical locator, historical locator or registered alias when resolution is unambiguous.

Beads IDs remain durable aliases indefinitely even after Beads is no longer installed.

---

## 9. Issue model

The Issue aggregate remains intentionally narrow.

Conceptual current projection:

```ts
interface Issue {
  id: IssueId;                 // immutable iss_... machine identity
  projectId: ProjectId;
  humanNumber: number;         // immutable within project; renders XTRM-227

  kind:
    | "epic"
    | "task"
    | "bug"
    | "decision"
    | "research"
    | "followup";

  title: string;

  lifecycleState:
    | "open"
    | "deferred"
    | "done"
    | "cancelled"
    | "archived";

  priority: number;
  scrutiny: ScrutinyPolicyRef;

  currentRevision: number;
  currentContractHash: string;

  deferUntil?: number;

  createdAt: number;
  updatedAt: number;
}
```

The Issue does not own:

```text
Chain topology
Specialist role
AgentSession state
messages
memory
review gates
all evidence
PR state
Git commit state
runtime telemetry
```

Those remain separate domains linked by stable references.

---

## 10. Immutable Issue revisions

Every material contract edit creates a new immutable revision.

Conceptual revision:

```ts
interface IssueRevision {
  issueId: IssueId;
  revision: number;
  contractHash: string;

  contract: WorkContract;
  contextRefs: ContextRef[];
  ownership?: OwnershipContract;

  authoredBy: ActorRef;
  source?: SourceRef;
  createdAt: number;
}
```

The current Issue row points to the latest revision. Older revisions remain queryable.

This is mandatory because execution and provenance must be able to answer:

> What exact contract was dispatched when this commit or PR was produced?

An execution never binds merely to `issue_id`. It binds to:

```text
issue_id
issue_revision
contract_hash
resolved_context_hash
```

---

## 11. Canonical executable work contract

The canonical required fields are:

```text
PROBLEM
SUCCESS
SCOPE
NON_GOALS
CONSTRAINTS
VALIDATION
OUTPUT
```

SCRUTINY is required as policy input rather than ordinary prose.

Conceptual shape:

```ts
interface WorkContract {
  problem: string;
  success: string;
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  validation: ValidationRequirement[];
  output: OutputRequirement[];
}
```

Optional typed extensions may include:

```text
libraries
references
telemetry
rollback
dependencies
```

They do not replace the seven required fields.

### 11.1 The fresh-worker test

The durable doctrine is:

> A competent fresh worker with repository access and the Issue's declared context must be able to execute the work without the chat that created the Issue.

If the worker would need hidden coordinator prose to decide what success, scope, non-goals, validation or output mean, the Issue is not ready.

---

## 12. Readiness is structural and semantic

Substrate does not treat “all JSON keys exist” as sufficient dispatch authority.

Readiness has two layers.

### 12.1 Structural validation

Deterministic checks include:

```text
required fields present
required arrays non-empty where policy requires
no forbidden placeholders such as unresolved TBD/TODO markers
valid SCRUTINY reference
valid ownership structure
valid context references
valid output/validation shapes
valid lifecycle state
```

Structural validation produces deterministic diagnostics.

### 12.2 Semantic readiness

A semantically ready contract must establish that:

```text
mandate is unambiguous
success is observable
scope identifies the actual ownership boundary
non-goals prevent adjacent scope expansion
constraints are actionable
validation can establish success
outputs are durable and identifiable
no unresolved contradiction materially affects execution
```

Semantic readiness is represented by an attestation bound to the exact contract hash.

Conceptual shape:

```ts
interface ReadinessAttestation {
  id: AttestationId;
  issueId: IssueId;
  issueRevision: number;
  contractHash: string;
  outcome: "ready" | "reject";
  policy: ScrutinyPolicyRef;
  attestedBy: ActorRef;
  evidenceRefs?: EvidenceRef[];
  blockingGaps?: string[];
  createdAt: number;
}
```

`/planning`, a configured independent reviewer, or an explicit human operation may produce a semantic attestation according to SCRUTINY policy.

Editing the contract invalidates prior readiness because the contract hash changes.

### 12.3 Dispatchable state

Dispatchability is derived, not manually toggled.

Conceptually:

```text
terminal lifecycle state?           → no
currently deferred?                 → no
structural contract invalid?        → no
current semantic attestation absent?→ no
unsatisfied blocking edge?          → no
required external prerequisite bad? → no
active claim holds the issue?       → no (state `claimed`)
otherwise                           → yes
```

A `claimed` issue is not dispatchable to others: the holder dispatches
through the claim → binding pipeline (the dispatch gate accepts `ready` +
`claimed`; the claim already passed structure, attestation, blockers, and
scrutiny). Releasing the claim restores `ready`. The ready queue therefore
lists unheld work only — a second dispatcher is refused at claim time with
holder info (anti-steal), never by silently widening dispatch authority.

There is no normal `--allow-unready` escape hatch.

An emergency operator may repair or supersede the Issue. The runtime does not make ambiguous work executable merely because someone supplied a reason string.

---

## 13. Derived operational state

Operational state should be computed from durable facts.

A useful projection is:

```text
if lifecycle terminal           → terminal
else if defer_until in future   → deferred
else if current contract unready→ draft
else if blockers unsatisfied    → blocked
else if active claim exists     → claimed
else                            → ready
```

`blocked` and `in_progress` are not independently writable long-lived fields.

This prevents stale state such as:

```text
status=in_progress
but no live worker exists
```

or:

```text
status=blocked
but blocker closed yesterday
```

---

## 14. Issue graph

### 14.1 Parent/child hierarchy

`parent_child` is structural hierarchy.

Rules:

```text
one direct parent maximum
zero or more children
cycle forbidden
reparenting preserves Issue ID
parent and child revisions remain independent
```

A coordinator may therefore own a root Epic while Specialists or workers claim child Issues.

### 14.2 Blocking graph

`blocks` is the only core relation that directly affects readiness.

Rules:

```text
blocks graph must be acyclic
closing/satisfying blocker updates derived readiness automatically
blocking is distinct from parent/child hierarchy
```

### 14.3 Non-blocking relations

Initial relation vocabulary:

```text
relates_to
discovered_from
supersedes
duplicates
```

These preserve causality and navigation but do not automatically block dispatch.

### 14.4 Ownership contract

Planning may attach structured ownership metadata:

```ts
interface OwnershipContract {
  repositories?: string[];
  paths?: string[];
  services?: string[];
  interfaces?: string[];
}
```

Ownership supports overlap detection, coupling analysis and safer parallelism. It is not a replacement for the human-readable SCOPE.

---

## 15. Deterministic context inheritance

Context may be inherited from ancestors, but every inherited value must preserve source provenance.

Conceptually:

```text
root epic context
     ↓ inherited unless overridden
child issue context
     ↓ inherited unless overridden
leaf issue context
```

A resolved value records:

```text
value
source_issue_id
source_revision
source_field
resolution_rule
```

Execution binds to a resolved context snapshot/hash so later ancestor edits do not rewrite history.

No worker should need to reread a giant parent Markdown document merely to reconstruct inherited constraints.

---

## 16. Atomic planning

Planning should not progressively create partially valid work while still reasoning about the plan.

The planning flow is:

```text
/planning
   ↓
PlanDraft
   ↓
sb plan check
   ↓
all contracts / edges / aliases / ownership validated
   ↓
sb plan apply
   ↓
one transaction
```

Conceptual commands:

```text
sb plan check plan.json
sb plan apply plan.json
```

`plan check` should report at least:

```text
created / updated Issues
newly ready Issues
newly blocked Issues
missing semantic attestations
parent cycles
block cycles
alias collisions
ownership overlaps
invalid references
```

`plan apply` commits all Issue revisions, edges, aliases and events or none.

A plan document is an input artifact. After apply, the Substrate graph is authority.

---

## 17. Claims: durable work ownership

Issue claims are lease-backed work ownership.

Required properties, based on mature current tracker behavior:

```text
atomic compare-and-swap
idempotent re-claim by same actor/activation
anti-steal
claimable-state check
renewable lease
explicit expiry
lost-race result
claim-ready in one transaction
```

Conceptual claim:

```ts
interface IssueClaim {
  id: ClaimId;
  issueId: IssueId;
  issueRevision: number;
  holder: ActorRef;
  activationId?: ActivationId;
  acquiredAt: number;
  expiresAt: number;
  generation: number;
}
```

A claim does not expand the Issue contract.

A coordinator may hold a root Epic claim while child Issues are separately claimed.

---

## 18. Workspace writer lease

Work ownership and mutation authority are separate.

A write-capable activation additionally needs a lease for the mutable workspace/worktree.

Invariant:

```text
N readers
+
maximum one writer per mutable workspace
```

Conceptual identity:

```ts
interface WorkspaceIdentity {
  repositoryRoot: string;
  gitCommonDir?: string;
  worktreePath: string;
  branch?: string;
}
```

A writer lease records holder participant/activation/attempt and generation.

The coordinator is also subject to the writer lease. When a child writer owns the workspace, parent mutation-capable tools must be fenced.

Issue claim answers:

> Who owns this work?

Workspace lease answers:

> Who may mutate this worktree now?

They must not be conflated.

---

## 19. Issue events

`issue_events` is the exhaustive machine audit trail.

Example events:

```text
issue.created
issue.revised
readiness.attested
readiness.invalidated
edge.added
edge.removed
claim.acquired
claim.renewed
claim.released
claim.expired
journal.appended
execution.bound
dispatch.admitted
dispatch.rejected
work_receipt.created
artifact.bound
external_binding.created
projection.enqueued
issue.done
issue.cancelled
```

Events are append-only and sequenced.

The event stream is not the Work Journal.

---

## 20. The Work Journal

Every Issue may have an append-only structured Work Journal.

Its purpose is continuity, not authority.

This is especially important for long-running coordinator-owned Epics, long PRs, multi-session implementation programmes and work that crosses context compactions.

### 20.1 Journal entry kinds

Initial kinds:

```text
checkpoint
handoff
milestone
decision
finding
blocker
compaction
```

Conceptual entry:

```ts
interface JournalEntry {
  id: JournalEntryId;
  issueId: IssueId;
  issueRevision: number;
  sequence: number;

  runId?: string;
  participantId?: string;
  activationId?: string;
  sessionId?: string;

  kind:
    | "checkpoint"
    | "handoff"
    | "milestone"
    | "decision"
    | "finding"
    | "blocker"
    | "compaction";

  mechanical?: MechanicalCheckpoint;
  semantic?: SemanticCheckpoint;
  refs?: EvidenceRef[];

  createdAt: number;
}
```

### 20.2 Mechanical checkpoint

The host populates everything it already knows without requiring model reasoning.

At minimum, where available:

```text
Issue ID
Issue revision / contract hash
current claim
participant
activation
attempt
session
workspace
base/head Git commit
changed files
commits since previous checkpoint
pending blockers
child Issue summary
active Specialist references
pending questions / asks
external bindings such as Jira/GitHub
checkpoint cursor / timestamps
```

The mechanical checkpoint is small, structured and deterministic.

### 20.3 Semantic checkpoint

A bounded summarizer may add:

```text
summary
completed
current
next
blocked
open_questions
key_decisions
material_findings
```

Semantic checkpoint text cannot change the Issue contract.

If it reveals a scope or success change, `/planning` or another authorized Issue edit creates a new Issue revision.

### 20.4 Mechanical-first guarantee

Checkpoint creation order is:

```text
collect mechanical state
      ↓
append durable mechanical checkpoint
      ↓
run optional semantic summarizer
      ↓
append enrichment / finalize semantic portion
```

If semantic generation fails, times out or has no usable context, the mechanical checkpoint remains durable.

This prevents:

> context was compacted, therefore the useful handoff disappeared.

### 20.5 Journal cursors

Journal entries use stable sequence/cursor semantics.

Required query:

```text
sb journal since <issue> <cursor>
```

This allows a resumed agent to read only what changed since its last known checkpoint rather than rereading a long mutable Markdown file.

---

## 21. Resume capsules

`sb issue resume <issue>` is the high-level continuity operation.

It assembles a bounded Resume Capsule from:

```text
current Issue revision
current resolved context
latest meaningful checkpoint
Journal delta after that checkpoint
current child/blocker state
current claim/workspace lease state
pending asks
recent provenance
Git state
external bindings
```

Conceptual result:

```text
ISSUE
iss_... @ revision 17

CURRENT CONTRACT
...

LATEST CHECKPOINT
jrn_...

DONE
...

CURRENT
...

NEXT
...

BLOCKERS / OPEN QUESTIONS
...

CHANGES SINCE CHECKPOINT
2 journal entries
1 commit
1 reviewer finding

EXTERNAL
GitHub PR #...
Jira ISSUE-...
```

Resume capsules are derived projections. They do not become another mutable source of truth.

---

## 22. Coordinator journals and child aggregation

A root coordinator may own a durable Epic whose journal becomes the operational history of a long programme.

Example:

```text
Epic iss_root
├─ child A — done
├─ child B — claimed
└─ child C — blocked by B
```

The root Journal should not copy every child transcript or child journal.

A root checkpoint records references and current projections:

```text
child A done @ checkpoint 12
child B active @ checkpoint 8
child C blocked by B
root coordinator checkpoint 31
```

This gives the next coordinator a stable reconstruction without document sprawl.

---

## 23. Pi compaction integration

Pi exposes a native `session_before_compact` extension event with the selected compaction preparation, branch entries, previous summary, file operations, token count and retained-boundary information. Pi also supports custom compaction output and a separate summarization model.

The XTRM Pi integration should use that seam directly.

### 23.1 Pi flow

```text
Pi decides to compact
      ↓
session_before_compact
      ↓
Substrate mechanical checkpoint
      ↓ durable
bounded semantic checkpoint model
      ↓ optional
render semantic checkpoint into compaction summary
      ↓
return custom compaction OR allow Pi default fallback
      ↓
Pi compacts
      ↓
next context receives Substrate Resume Capsule
```

The semantic summarizer should normally be a separate cheap/fast model or caller-owned child request, not the already-exhausted main context.

The same structured semantic result may be rendered both into:

```text
Journal checkpoint
Pi compaction summary
```

This avoids two independent summaries disagreeing.

The Journal remains durable even if Pi later chooses a different compaction cut point.

### 23.2 Pi failure behavior

If semantic checkpoint generation fails:

```text
keep mechanical checkpoint
allow Pi default compaction
record degraded checkpoint outcome
```

If the SQLite write itself fails, compaction should not enter an infinite context-overflow loop. The adapter records a degraded incident where possible and relies on Pi's retained session JSONL as recovery evidence. A later reconciliation can reconstruct the missing checkpoint.

---

## 24. Claude Code compaction integration

Claude Code exposes:

```text
PreCompact
PostCompact
SessionStart(source=compact)
```

Current Claude Code allows command, HTTP and MCP-tool handlers on `PreCompact`; direct `type: "agent"` hooks are not supported on that event.

Therefore XTRM must not design around an unsupported direct PreCompact subagent hook.

### 24.1 Claude flow

Preferred integration:

```text
Claude about to compact
      ↓
PreCompact
      ↓
native XTRM/Substrate MCP-tool or command adapter
      ↓
Substrate mechanical checkpoint
      ↓ durable
Substrate-owned bounded semantic summarizer / child model
      ↓ optional
allow Claude compaction
      ↓
PostCompact records actual Claude summary reference/hash if useful
      ↓
SessionStart(source=compact)
      ↓
Substrate Resume Capsule injected as additionalContext
```

The semantic summarizer may be implemented behind the Substrate service using a separate model process, Specialist, or other bounded child execution. It is not the main Claude session and it is not a direct `type: agent` PreCompact hook.

### 24.2 Why SessionStart(compact) matters

After compaction, Claude Code can run `SessionStart` with source `compact`, and that hook can inject `additionalContext`.

The Claude plugin should inject the current Resume Capsule there.

This means the new context window starts from durable Substrate state even if Claude's own compact summary omitted a detail.

### 24.3 Failure behavior

As with Pi:

```text
mechanical checkpoint succeeds
semantic checkpoint fails
→ compaction proceeds
→ resume from mechanical + existing durable state
```

If checkpoint persistence itself fails, do not repeatedly block overflow-recovery compaction. Preserve an incident, retain transcript references and allow recovery.

---

## 25. Journal is not memory

The Journal is Issue-scoped working history.

Memory is reusable promoted knowledge.

```text
Journal finding
      ↓
possible memory candidate
      ↓
validation / promotion policy
      ↓
future XTRM memory
```

A finding does not become reusable truth merely because a coordinator wrote it into the Journal.

The future `bd memories` migration therefore remains a separate lane.

---

## 26. Execution binding

Before tracked execution begins, Substrate creates an immutable execution binding.

Conceptual shape:

```ts
interface ExecutionBinding {
  id: ExecutionBindingId;

  issueId: IssueId;
  issueRevision: number;
  contractHash: string;
  resolvedContextHash: string;

  claimId?: ClaimId;
  participantId?: string;
  activationId?: string;
  attemptId?: string;
  sessionId?: string;

  workspace: WorkspaceIdentity;
  baseCommit?: string;

  createdAt: number;
}
```

This answers:

> What exact durable work authorized this execution?

The binding is created by the host/runtime, not reconstructed from final prose.

---

## 27. WorkReceipts and artifact provenance

A WorkReceipt links one governed execution to durable artifacts.

Conceptual shape:

```ts
interface WorkReceipt {
  id: WorkReceiptId;
  executionBindingId: ExecutionBindingId;

  issueId: IssueId;
  issueRevision: number;
  contractHash: string;

  artifactRefs: ArtifactRef[];
  validationRefs?: EvidenceRef[];
  journalCheckpointId?: JournalEntryId;

  createdAt: number;
}
```

Artifact references may include:

```text
Git commit
GitHub PR
merge commit
released artifact
file/bundle
validation receipt
review result
```

The executor should not be required to remember to create these links.

---

## 28. Automatic Git provenance

Tracked Git mutations should bind automatically to the active execution.

### 28.1 Commit trailers

When an XTRM-tracked commit is created, host-owned tooling should add stable trailers such as:

```text
XTRM-Issue: iss_...
XTRM-Issue-Revision: 17
XTRM-Receipt: rcp_...
```

This creates an immutable link inside the Git commit object without requiring the executor to write it.

### 28.2 Git hook compatibility boundary

Native XTRM runtimes should call the provenance library directly where possible.

Raw `git commit` remains possible, so installed Git hooks provide an enforcement/fallback layer:

```text
prepare-commit-msg
  attach active XTRM trailers

post-commit
  finalize receipt → commit SHA binding

post-rewrite
  reconcile rewritten/amended/rebased commit identities
```

The active execution/claim is resolved from Substrate state. The agent does not choose arbitrary provenance metadata.

### 28.3 Self-reference problem

A receipt ID is allocated before the commit.

```text
create rcp_7
    ↓
stage code / optional bundle
    ↓
commit created = abc123
    ↓
finalize rcp_7 → abc123
```

The receipt therefore does not need to contain the SHA of a commit that has not yet been created.

---

## 29. Repository provenance bundle

Operational provenance lives in SQLite, but Git should retain a compact archival artifact for long-term auditability.

At a governed finalization boundary such as PR creation/update or Issue completion, the host may generate an immutable repository bundle:

```text
.xtrm/provenance/bundles/<bundle-id>.json
```

The repository must explicitly allow this versioned path while keeping runtime state ignored.

A bundle should include enough information to survive loss of the local SQLite database:

```text
bundle ID
Issue ID
exact dispatched Issue revision
contract hash
minimal contract snapshot or canonical portable representation
execution binding IDs
selected checkpoint IDs / checkpoint summaries
implementation commit SHAs
validation references
review references
known external binding identifiers
creation time
```

The bundle should be generated by XTRM, not manually edited by the executor.

The bundle does not need to copy the complete Journal or full transcript.

---

## 30. Provenance queries

Required operator/agent queries:

```text
sb provenance trace <issue>
sb provenance commit <sha>
sb provenance receipt <receipt-id>
sb provenance pr <provider-ref>
```

A trace should reconstruct, where available:

```text
Issue revision dispatched
readiness attestation
authorizing claim
participant / activation / attempt
workspace / base commit
journal checkpoint
commits produced
validation performed
PR containing work
review/finalization
merge result
Issue closure revision
```

The inverse lookup from commit to Issue must also work.

---

## 31. External bindings

An Issue may have multiple external identities.

Conceptual shape:

```ts
interface ExternalBinding {
  issueId: IssueId;
  provider: "github" | "jira" | string;
  remoteScope: string;
  remoteId: string;
  remoteKey?: string;
  url?: string;

  mode: "projection" | "intake" | "mirror_read";

  lastPushedRevision?: number;
  lastSeenRemoteVersion?: string;
  mappedContentHash?: string;
  syncState?: string;
}
```

One Issue is not limited to one external reference.

Example:

```text
iss_...
├─ GitHub xtrm-dev/xtrm#241
├─ Jira ISSUE-92
└─ historical Beads alias xtrm-q99
```

---

## 32. GitHub projection

GitHub should use native structured issue features where available instead of label hacks.

Preferred mapping:

```text
Substrate parent_child → GitHub sub-issue relationship
Substrate blocks       → GitHub issue dependency
Issue kind             → GitHub issue type
priority               → GitHub issue field
human-readable contract→ GitHub issue body
external binding       → stable remote identity
```

Projection writes use a mapped content hash. If the mapped content did not change, no remote PATCH is sent.

GitHub is not a permanent dual-write authority.

### 32.1 GitHub intake

A GitHub-created issue may be imported as:

```text
contract state = draft
source = github
external binding = intake
```

It becomes dispatchable only after `/planning` grounds the full XTRM contract and semantic readiness is attested.

---

## 33. Jira projection

Jira is primarily a programme/portfolio projection for XTRM v0.

Default policies should support:

```text
roots only
explicitly tagged Issues
all Issues
```

The default should avoid mirroring every implementation leaf unless the project explicitly requests it.

Stable remote links and remote keys are stored in `external_bindings`.

Jira webhook intake must be idempotent. Webhook identifiers/retry identities should be recorded in the integration inbox so retries do not create duplicate local mutations.

Journal entries are **not** mirrored to Jira by default. Selected milestones may later be projected by explicit policy.

---

## 34. External sync conflict model

Substrate does not implement naive bidirectional last-writer-wins.

The model is:

```text
Substrate local authority
      ↓
outbox projection
      ↓
GitHub / Jira

GitHub / Jira event
      ↓
integration inbox
      ↓
policy evaluation
      ↓
intake / drift / proposed mutation
```

Protected remote edits that conflict with current local authority create explicit drift/proposal state unless policy says the remote field is inbound-authoritative.

Every inbox event is idempotent.

---

## 35. WorkItemStore / IssueService seam

Before broad skill/runtime migration, XTRM must expose a backend-neutral work service.

Minimum conceptual surface:

```ts
interface WorkItemStore {
  get(...): Promise<IssueSnapshot>;
  search(...): Promise<IssueSnapshot[]>;
  ready(...): Promise<IssueSnapshot[]>;

  validate(...): Promise<ValidationResult>;
  resolveContext(...): Promise<ResolvedContext>;

  claim(...): Promise<ClaimResult>;
  claimReady(...): Promise<ClaimResult>;
  renew(...): Promise<ClaimResult>;
  release(...): Promise<void>;

  update(...): Promise<IssueSnapshot>;
  addEdge(...): Promise<void>;
  addJournal(...): Promise<JournalEntry>;
  checkpoint(...): Promise<JournalEntry>;
  close(...): Promise<IssueSnapshot>;

  changesSince(...): Promise<ChangeBatch>;
}
```

Transition shape:

```text
skills / hooks / runtime
          ↓
     WorkItemStore
       ├─ SubstrateIssueStore   canonical
       └─ BeadsWorkItemStore    temporary compatibility
```

After cutover, Beads is removed from normal first-party agent instructions and runtime requirements.

---

## 36. CLI surface

The CLI should remain compact and composable.

Recommended v0 surface:

```text
sb issue create
sb issue show
sb issue edit
sb issue validate
sb issue list
sb issue ready
sb issue tree
sb issue children
sb issue relate
sb issue claim
sb issue release
sb issue close

sb plan check
sb plan apply

sb journal append
sb journal checkpoint
sb journal show
sb journal since
sb journal render

sb issue resume

sb provenance trace
sb provenance commit
sb provenance receipt

sb import beads
sb export
```

All Issue-taking commands accept an unambiguous machine ID, durable human reference, current hierarchical locator, historical locator or registered alias.

The CLI returns structured JSON with a stable schema for automation and a concise human projection for terminals. Routine human output should prefer the hierarchical locator plus durable human reference and hide the opaque machine ID unless requested.

No integration should parse decorative terminal text.

---

## 37. Pi extension

The native Pi extension must consume the Substrate library directly.

Responsibilities:

```text
active Issue context
ready/claim/release tools
contract gate feedback
session/activation binding
journal checkpoint integration
resume capsule injection
commit/provenance integration where host-visible
compact status/diagnostics
```

The extension should expose a small model-facing tool surface rather than the whole CLI.

Example conceptual tools:

```text
substrate_issue_get
substrate_issue_search
substrate_issue_claim
substrate_issue_update
substrate_journal_append
substrate_journal_checkpoint
substrate_issue_resume
substrate_provenance_trace
```

Mutation tools enforce readiness/revision/idempotency policy in the service.

---

## 38. Claude Code plugin / MCP integration

The Claude integration belongs to the same Substrate semantic runtime.

Packaging may include:

```text
Claude Code plugin
MCP server
hooks
using-substrate skill
SessionStart integration
PreCompact/PostCompact integration
Git provenance adapters
```

The MCP server calls the Substrate library/service directly.

Forbidden normal implementation:

```text
MCP handler → exec("sb ...")
```

Hook commands may invoke a small adapter where Claude exposes only a hook process boundary, but the adapter itself calls the typed Substrate service.

---

## 39. Specialists reconciliation

The existing native-Specialists PRD already defines the correct activation shape:

```text
Pi / Claude coordinator
        ↓
specialist_delegate
        ↓
NativeActivationHost
        ↓
Pi AgentSession
        ↓
real Specialist
```

This remains valid.

The required reconciliation is:

```diff
- Bead is authoritative tracked work
+ Substrate Issue revision is authoritative tracked work

- beadId
+ issueId

- sourceBeadRevision
+ issueRevision + contractHash

- validate Bead sections inside Specialist-specific gate
+ call shared Substrate readiness service

- future Substrate integration deferred
+ native Substrate dependency for production tracked dispatch
```

`NativeActivationHost` remains Specialist-owned. Substrate does not absorb Specialist resolution, model policy, AgentSession lifecycle, result validation or participant interaction.

### 39.1 No prompt smuggling remains mandatory

The existing principle becomes native:

```text
Issue incomplete
      ↓
DO NOT dispatch
      ↓
repair Issue through /planning
      ↓
new revision + readiness attestation
      ↓
dispatch
```

Free-form Specialist delegation text may narrow an already-authorized activation where policy allows, but it may not repair or expand the durable work contract invisibly.

---

## 40. Agent instruction doctrine

The following doctrine must exist in one maintainable source and be injected/derived into supported agent environments.

```text
Substrate owns durable work.

A ready Issue is an executable contract.

Never begin implementation from a title + description issue.

Never use hidden prompt prose to make an ambiguous Issue executable.

If the contract is insufficient, stop execution and repair the Issue.

Messages coordinate. They do not silently change SCOPE, SUCCESS, NON_GOALS,
CONSTRAINTS, VALIDATION, OUTPUT or SCRUTINY.

Use the Journal for checkpoints/handoffs; do not create ad-hoc Markdown handoff
files unless a human-facing artifact is explicitly required.

Use Issue resume capsules instead of rereading long mutable handoff documents.

Do not self-author provenance that the host can capture mechanically.

Live source/evidence outranks stale prose.

Git remains code/integration truth.
```

---

## 41. Skill and hook migration

The migration must inventory and replace current Beads-coupled surfaces, including at least:

```text
/planning
/using-xtrm
/starting-and-resuming-work
/using-specialists
board triage / board audit guidance
AGENTS.md / CLAUDE.md managed blocks
Codex setup guidance
Beads stop gate
Beads claim sync
Beads edit gate
Beads commit gate
Beads memory gate
Beads compact save/restore
Beads status cache
Pi Beads extension
install/help text
XTRM-GUIDE templates
```

The goal is not a global search-and-replace from `bd` to `sb`.

Each surface receives one disposition:

```text
native Substrate replacement
backend-neutral WorkItemStore adaptation
Beads compatibility only
retired
memory-lane migration
```

No current first-party agent instruction should continue teaching Beads as authority after Substrate cutover.

---

## 42. Beads migration

Beads compatibility is durable; Beads authority is temporary.

### 42.1 Import

`sb import beads` must:

```text
be idempotent
preserve original Beads ID as alias
preserve useful hierarchy/edges
preserve current human-readable content
map known contract fields
mark incomplete imported work as unready
record import provenance
avoid duplicate imports
```

Legacy malformed/thin work is imported honestly. It is not silently upgraded to ready.

### 42.2 Transition policy

Recommended transition:

```text
Phase A
WorkItemStore seam lands; Beads still current backend.

Phase B
Substrate DB + import + aliases proven; new pilot work can use Substrate.

Phase C
Skills/hooks/runtime move to backend-neutral service and then Substrate canonical.

Phase D
Per-epic/workstream cutover. No permanent dual write.

Phase E
Beads becomes read/import compatibility only.

Phase F
Normal XTRM install no longer requires bd/Dolt for issue tracking.
```

### 42.3 Historical IDs

Historical Beads IDs remain queryable aliases even in Phase F.

This protects commit messages, PRs, ADRs, reports and old conversations from link rot.

---

## 43. `bd memories` transition

Beads currently mixes issue tracking and durable memory. Substrate Issues v0 must not repeat that coupling.

Transition:

```text
Phase 1
existing bd memory remains readable

Phase 2
memory retrieval moves behind a backend-neutral XTRM memory capability

Phase 3
native XTRM memory becomes canonical

Phase 4
bd memory becomes import/archive compatibility only
```

Journal entries may produce memory candidates at closeout, but the Issue system does not become the memory system.

---

## 44. Conceptual SQLite schema

The exact DDL is an implementation artifact, but the v0 domain requires approximately these tables:

```text
projects
issues
issue_revisions
issue_aliases
issue_locator_history
issue_edges
readiness_attestations
issue_claims
workspace_leases
issue_events
issue_journal
execution_bindings
work_receipts
artifact_bindings
external_bindings
integration_inbox
projection_outbox
command_receipts
schema_migrations
```

Important constraints include:

```text
unique Issue machine ID
unique durable human number/reference within project
unique (issue_id, revision)
unique alias within resolution scope
unique historical locator within project resolution scope
one active parent edge per child
unique child_slot within each parent; slots are monotonic and never reused
no graph cycles by service validation
one active claim generation per claimable ownership slot
one active writer lease per workspace
unique integration inbox idempotency key
unique command idempotency key
append-only revision/event/journal identities
```

---

## 45. Compact read APIs

Agents should not need to retrieve full Issue history for routine operations.

Required compact projections include:

```text
IssueSummary
ReadyIssueSummary
IssueTreeSummary
ResumeCapsule
JournalDelta
ProvenanceTraceSummary
```

`IssueSummary` should usually fit in a small model context and include only:

```text
current hierarchical locator / durable human reference
opaque machine ID only when requested
aliases
title / kind
operational state
priority / scrutiny
current revision
short problem/success summary
parent
blockers
claim holder if active
external keys
```

Full contract and full Journal are explicit reads.

---

## 46. Security and trust

Substrate data is authority-bearing.

Requirements:

```text
fail closed on corrupt schema or unknown migration state
validate all provider payloads
never treat peer/agent message text as authority
never accept arbitrary claimed provenance from untrusted model output
protect token/credential config outside exported state
bound hook execution time
preserve actor/trust class on attestations and mutations
record manual overrides explicitly
```

External provider tokens are configuration, not Issue content.

---

## 47. Recovery model

The canonical DB must tolerate process crashes without inventing completed work.

Required behavior:

```text
WAL-backed committed transactions survive restart
expired claims are reclaimable according to policy
writer lease uncertainty is explicit
idempotency keys prevent duplicate mutations
projection outbox retries safely
integration inbox retries safely
Journal remains append-only
execution receipt uncertainty is reconciled, not guessed
```

If a runtime cannot determine whether an external effect completed, it records `uncertain` and requires reconciliation rather than blind replay.

---

## 48. Implementation phases

### Phase 0 — canonical reconciliation and source census

Before production coding:

```text
freeze this PRD
inventory current Beads hooks/extensions/skills
inventory Specialists Bead assumptions
inventory runtime Beads assumptions
produce migration matrix
confirm package/toolchain placement
```

### Phase 1 — domain + SQLite kernel

Implement:

```text
projects and project human-reference counters
Issue machine identity + durable human references + revisions
contract schema
parent edges with child_slot allocation
current locator derivation + historical locator aliases
edges
aliases
events
migrations
transaction/idempotency primitives
```

### Phase 2 — readiness + planning

Implement:

```text
structural validator
semantic readiness attestation contract
SCRUTINY policy seam
derived readiness
PlanDraft check/apply
context inheritance/provenance
```

No production dispatch before this phase passes adversarial tests.

### Phase 3 — claims + workspace leases

Implement:

```text
atomic claim
claim-ready transaction
renew/expiry/reclaim
anti-steal
workspace writer lease
read/write authority helpers
```

### Phase 4 — `sb` CLI vertical

Prove the complete local workflow using the typed service directly.

### Phase 5 — Work Journal + resume

Implement:

```text
journal entries
mechanical checkpoints
semantic checkpoint schema
cursor reads
resume capsules
root/child aggregation
```

### Phase 6 — Pi native integration

Implement:

```text
Pi Issue tools
session binding
resume injection
session_before_compact checkpoint
secondary-model semantic checkpoint
custom/default compaction fallback
```

### Phase 7 — Claude native integration

Implement:

```text
plugin/MCP surface
PreCompact MCP/command adapter
Substrate semantic child-model service
PostCompact audit reference
SessionStart(compact) resume injection
```

### Phase 8 — provenance

Implement:

```text
execution bindings
WorkReceipts
Git trailers
prepare-commit-msg/post-commit/post-rewrite adapters
commit trace
repository provenance bundles
```

### Phase 9 — Specialists integration

Replace Bead dispatch authority in the native-Specialists implementation plan with Substrate Issue readiness and execution binding.

### Phase 10 — GitHub/Jira projections

Implement outbox/inbox, idempotency, GitHub native mapping and selective Jira projection.

### Phase 11 — Beads migration + instruction cutover

Import/alias pilot work, migrate skills/hooks/managed instructions and remove Beads from normal agent runtime authority.

### Phase 12 — production promotion

Promote only after migration, recovery, provenance and long-session continuity acceptance matrices pass.

---

## 49. Mandatory acceptance tests

### A. Contract and readiness

1. A title + description only Issue cannot be claimed or dispatched.
2. Missing any required contract field prevents readiness.
3. Structural validity without current semantic attestation prevents dispatch.
4. Editing an attested contract invalidates the attestation.
5. A hidden dispatch prompt cannot expand Issue SCOPE.
6. A blocked Issue becomes ready automatically when its final blocker is satisfied.
7. Reparenting preserves both machine ID and durable human reference while changing only the current hierarchical locator.
8. An old hierarchical locator remains resolvable as a historical locator after reparenting.
9. Adding or reordering siblings does not renumber existing locators because child slots are stable.
10. Parent/child and blocks cycles are rejected.

### B. Planning

11. A PlanDraft containing one invalid Issue commits zero Issues.
12. A PlanDraft containing a graph cycle commits zero edges/Issues.
13. Ownership overlap is reported before apply.
14. Reapplying the same idempotent PlanDraft does not duplicate work.

### C. Claims and leases

15. Two concurrent claims have exactly one winner.
16. Same holder retry is idempotent.
17. A live claim cannot be stolen.
18. Expired claim can be reclaimed according to policy.
19. Two writers cannot hold the same workspace lease.
20. Read-only participants can coexist with the writer.
21. Parent/coordinator mutation is fenced while child writer owns the workspace.

### D. Journal and compaction

22. Mechanical checkpoint persists before semantic summarization starts.
23. Semantic summarizer failure still leaves resumable mechanical state.
24. `journal since` returns only entries after the supplied cursor.
25. Resume Capsule reconstructs current contract + latest checkpoint + deltas.
26. Pi compaction failure falls back without losing the durable checkpoint.
27. Claude PreCompact writes checkpoint without relying on unsupported direct agent hook semantics.
28. Claude SessionStart(source=compact) receives the current Resume Capsule.
29. Root Epic resume summarizes child state without copying child transcripts.

### E. Provenance

30. Dispatch creates an execution binding to exact Issue revision/hash.
31. A tracked commit automatically receives XTRM provenance trailers.
32. `post-commit` binds receipt to exact commit SHA.
33. Commit amend/rebase is reconciled by post-rewrite handling.
34. `sb provenance commit <sha>` returns the authorizing Issue revision.
35. `sb provenance trace <issue>` returns commits and known PR binding.
36. Repository provenance bundle survives export/import and still names exact dispatched contract.
37. Executor cannot forge host-owned receipt authority through ordinary model output.

### F. External integrations

38. GitHub unchanged projection produces zero PATCH calls.
39. GitHub parent maps to native sub-issue relationship where supported.
40. GitHub blocks maps to native dependency where supported.
41. Remote intake creates an unready draft until XTRM planning completes it.
42. Jira duplicate webhook delivery mutates local state once.
43. Protected remote edit does not silently overwrite current local authority.

### G. Migration

44. Beads import is idempotent.
45. Beads ID resolves as alias after import.
46. Thin legacy Bead imports as unready rather than being silently promoted.
47. Export/import preserves Issue revisions and graph equivalence.
48. Normal post-cutover agent instructions contain no statement that Beads owns durable work.
49. Post-cutover XTRM issue workflow does not require a running Dolt server or `bd` binary.

---

## 50. Documentation reconciliation required by this PRD

The implementation programme must reconcile at least:

```text
docs/substrate/substrate-light-prd.md
  superseded by this implementation baseline

docs/substrate/substrate_design_it.md
  retain full architecture; mark issue-system conflicts superseded by this PRD

docs/runtime/prd/native-chain-runtime.md
  Beads work authority → Substrate Issue authority

docs/runtime/README.md
  same authority correction

docs/specialists/PRD—Native-Specialist-Subagents-for-Pi.md
  Bead gate → Substrate Issue gate

docs/specialists/PRD-Native-Specialists-Subagents-for-Pi-amendment-2026-09-08.md
  wording only where it names future Substrate Issue; UI semantics otherwise unchanged

core/.xtrm/skills/default/planning/**
core/.xtrm/skills/default/using-xtrm/**
starting/resuming/specialists/triage skills
managed AGENTS.md / CLAUDE.md / Codex instruction sources
Beads hooks/extensions/install docs
```

The migration should modify the source generators/templates that produce managed instruction blocks rather than repeatedly hand-edit generated copies.

---

## 51. Implementation choices intentionally left local

These are implementation details, not open architecture decisions:

```text
exact TypeScript module boundaries
whether CLI and Pi extension publish as one or multiple npm artifacts
exact SQLite query builder / migration library
exact semantic checkpoint model selection
exact UUIDv7 string formatting
exact repository provenance bundle sharding
exact GitHub/Jira retry backoff
exact terminal formatting
```

They must preserve the contracts in this PRD.

---

## 52. Final system model

The v0 system should be understandable as this pipeline:

```text
                         AUTHORITATIVE WORK

      requirement
          ↓
      /planning
          ↓
      PlanDraft
          ↓
  atomic check/apply
          ↓
  ┌─────────────────────┐
  │  SUBSTRATE ISSUE    │
  │  revision + contract│
  └─────────┬───────────┘
            │ current readiness attestation
            ↓
       claim / assign
            ↓
   execution binding
            ↓
  Pi / Claude / Specialist
            │
     ┌──────┴───────────────┐
     │                      │
     ↓                      ↓
Work Journal           WorkReceipts
continuity             provenance
     │                      │
     ↓                      ↓
resume/compaction      commits / PR / validation
     │                      │
     └──────────┬───────────┘
                ↓
        Issue completion
                ↓
       memory candidates

External GitHub/Jira systems observe or intake through explicit bindings and
idempotent adapters. They do not silently replace local authority.
```

The design is successful when a future auditor can start from any of these:

```text
Issue
commit
PR
Journal checkpoint
historical Beads ID
Jira/GitHub binding
```

and reconstruct the same governed work lineage without needing the original chat that happened to perform it.

---

## 53. Final invariant

The intended end state is:

> XTRM can take a requirement, turn it into an explicit executable Issue contract, refuse ambiguous work, coordinate long-running execution without Markdown handoff sprawl, survive context compaction through a durable Journal, attach results to the exact contract revision that authorized them, and project the work to GitHub/Jira without creating another competing source of truth.

In compact form:

```text
Issues authorize.
Journals preserve continuity.
Claims assign responsibility.
Leases control mutation.
Executions bind to exact revisions.
Receipts prove outputs.
Git preserves durable lineage.
Projections communicate externally.
Memory promotes reusable knowledge later.
```

---

## 54. Verified implementation references

These references informed concrete v0 integration choices and should be rechecked against current dependency versions at implementation time.

### Pi compaction

- Pi compaction internals and `session_before_compact`:  
  `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md`
- Pi custom compaction example using a different summarization model:  
  `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/custom-compaction.ts`
- Pi trigger-compaction extension example:  
  `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/trigger-compact.ts`

The v0 design relies only on the documented extension seam: mechanical checkpointing happens before compaction; an optional secondary model may produce the semantic checkpoint; failure falls back to normal Pi compaction.

### Claude Code lifecycle

- Claude Code hooks reference:  
  `https://code.claude.com/docs/en/hooks`

Verified current properties used by this PRD:

```text
PreCompact exists for manual and automatic compaction.
PreCompact supports command / HTTP / MCP-tool hooks.
PreCompact does not currently support prompt/agent hooks.
PostCompact exposes the generated compact summary.
SessionStart has a source=compact lifecycle.
SessionStart command/MCP hooks can inject additionalContext.
```

The Claude integration therefore routes PreCompact into the Substrate checkpoint service rather than depending on a direct Claude agent hook at that event.

### Current Beads reference

- Current repository: `https://github.com/gastownhall/beads`

The migration should preserve useful lessons from mature claim/lease/idempotency behavior while avoiding the accumulated issue mega-aggregate and permanent second authority.

### External projection APIs

GitHub and Jira mappings are capability-sensitive. Implementations must verify current provider APIs before coding and must degrade explicitly rather than silently emulating unavailable native relationships with lossy labels.
