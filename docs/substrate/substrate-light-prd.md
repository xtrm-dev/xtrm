# PRD — Substrate Light: Minimal Native XTRM Work Graph

> **Superseded** by `substrate-issues-v0-prd.md` as the implementation baseline (Phase 11 cutover, bead xtrm-7wc.12). Retained for history; do not implement from this document.

**Status:** Draft v0.1 — SUPERSEDED  
**Date:** 2026-09-08  
**Canonical parent design:** `docs/substrate/substrate_design_it.md`  
**Purpose:** land the smallest coherent Substrate Issue kernel before further Chain work

---

# 1. Summary

Substrate Light is the smallest useful implementation of the canonical Substrate Issue model required to stop making new XTRM runtime features depend directly on Beads.

Its immediate consumers are:

```text
planning
native Specialists
operator inspection
future Chain materialization
```

Substrate Light does **not** replace the full Substrate PRD. It is a bootstrap implementation of the Issue/work-graph subset that the current XTRM runtime already needs.

The product thesis is:

> XTRM work should be represented as structured, machine-readable issues with explicit contracts, ancestry, relations, and provenance — not as Markdown that runtime code reparses into fields.

The canonical Substrate design already assigns ownership of Issues to Substrate and explicitly treats the current `sp + bd + GitHub materializer` integration as disposable bridge infrastructure. Substrate Light implements that direction early, before more Chain work hardens Beads into another generation of runtime contracts.

---

# 2. Why now

Native Specialist activation currently has to perform a compatibility sequence that exposes the wrong abstraction boundary:

```text
Bead
  ↓
read Markdown
  ↓
parse headings
  ↓
recover PROBLEM / SUCCESS / SCOPE / ...
  ↓
read separate contract state
  ↓
walk graph indirectly
  ↓
compile StepContract
```

This has already produced real implementation/debugging problems around contract formatting and parser behavior.

A work authority should not require runtime code to infer typed fields from prose layout.

Substrate Light replaces that path with:

```text
Issue JSON
  ↓
typed structural validation
  ↓
resolve ancestry and relations
  ↓
EffectiveIssueContext
  ↓
Specialist + WorkItem
  ↓
StepContract
```

No seven-heading Markdown parser is required.

---

# 3. Scope

Substrate Light implements only:

```text
Issue identity
Issue current projection
Issue typed contract
Issue hierarchy
Issue relations
SCRUTINY
readiness
context inheritance
provenance
append-only issue events
filesystem inspection
WorkItemStore abstraction
Beads compatibility/import adapter
```

It deliberately excludes the rest of full Substrate until required by later runtime work.

---

# 4. Non-goals

Substrate Light does not implement:

```text
full Substrate daemon
Unix socket protocol
state.db as mandatory storage
Channels
Containers
Seeds
Chain scheduler
Chain reducer
full collision engine
pulse/emitter runtime
full memory system
full capability system
console/dashboard
remote synchronization
full database schema
full Substrate API surface
```

Landing this PRD must not become a backdoor implementation of the entire canonical Substrate design.

---

# 5. Relationship to canonical Substrate

Substrate Light is not a competing architecture.

It is a bootstrap storage/runtime implementation of the following canonical concepts:

```text
Issue
Issue contract
Issue parent/child hierarchy
Issue relations
Issue provenance
SCRUTINY
context-depth / inherited context
work-item lifecycle
```

The eventual full Substrate runtime remains authoritative for long-term architecture.

The filesystem representation defined here is explicitly temporary and must be losslessly importable into the future canonical database representation.

---

# 6. Storage strategy

For v0, plain structured JSON on disk is preferred.

Reasons:

```text
human inspectability
simple debugging
Git diffability
offline operation
no daemon prerequisite
easy recovery
straightforward tests
lossless future DB import
```

The initial persistence backend is therefore a filesystem-backed `WorkItemStore` under `.xtrm/`.

This storage backend must not leak into higher-level consumers. Native Specialists and planning consume a store interface, not paths.

---

# 7. Canonical `.xtrm/` layout

The layout must be deterministic, clean, and understandable without tooling.

One root epic owns one physical folder.

```text
.xtrm/
└── substrate/
    ├── version.json
    ├── index.json
    └── issues/
        ├── unitAI-a/
        │   ├── issue.json
        │   ├── events.jsonl
        │   ├── artifacts/
        │   └── children/
        │       ├── 1/
        │       │   ├── issue.json
        │       │   ├── events.jsonl
        │       │   └── children/
        │       │       └── 1/
        │       │           ├── issue.json
        │       │           └── events.jsonl
        │       └── 2/
        │           ├── issue.json
        │           └── events.jsonl
        │
        └── unitAI-b/
            ├── issue.json
            └── events.jsonl
```

Logical IDs:

```text
unitAI-a
unitAI-a.1
unitAI-a.1.1
unitAI-a.2
```

Physical paths:

```text
issues/unitAI-a/
issues/unitAI-a/children/1/
issues/unitAI-a/children/1/children/1/
issues/unitAI-a/children/2/
```

A human should be able to run:

```bash
tree .xtrm/substrate/issues/unitAI-a
```

and understand the epic topology immediately.

---

# 8. Stable identity

Issue identity must not depend on mutable titles.

Root IDs should preserve the existing compact human-friendly XTRM style or another stable generated equivalent.

Child IDs are hierarchical:

```text
<root>
<root>.<sibling-number>
<root>.<sibling-number>.<sibling-number>
```

Sibling numbers are monotonic and are never reused after cancellation/deletion.

Changing a title never changes an ID.

---

# 9. `issue.json` schema

Each issue has one current structured projection.

Example:

```json
{
  "schema": "xtrm.substrate.issue.v1",
  "id": "unitAI-a.1.1",
  "root_id": "unitAI-a",
  "parent_id": "unitAI-a.1",

  "type": "task",
  "title": "Implement Specialist transcript inspector",

  "state": "open",
  "priority": 2,
  "scrutiny": "medium",

  "contract": {
    "problem": "...",
    "success": ["..."],
    "scope": ["..."],
    "non_goals": ["..."],
    "constraints": ["..."],
    "validation": ["..."],
    "output": ["..."]
  },

  "context": {
    "summary": "...",
    "evidence_refs": [],
    "artifact_refs": []
  },

  "relations": [],

  "provenance": {
    "created_by": "...",
    "created_at": "...",
    "discovered_from": null
  },

  "revision": 1
}
```

No required semantic field is encoded only in Markdown formatting.

---

# 10. Minimal issue types

v0 issue types:

```text
epic
task
bug
decision
followup
```

Do not implement the full future taxonomy until a real consumer requires it.

---

# 11. Minimal work states

v0 states:

```text
draft
open
in_progress
blocked
waiting
done
closed
cancelled
```

`draft` replaces the current bridge-era `contract:draft` compatibility state.

A `draft` issue is not dispatchable.

---

# 12. Typed contract

The seven planning fields become first-class structured values:

```text
problem
success
scope
non_goals
constraints
validation
output
```

SCRUTINY is a sibling policy field, not an eighth Markdown heading that must be parsed from prose.

This means structural readiness can be determined from the issue schema directly.

---

# 13. Readiness

A work item is structurally ready when:

```text
state is dispatchable
contract.problem is present
contract.success is non-empty
contract.scope is non-empty
contract.non_goals is present
contract.constraints is present
contract.validation is non-empty
contract.output is non-empty
scrutiny is present and valid
```

Readiness is deterministic.

The tracker validates structure, not whether the planning judgment is good.

Planning quality remains an agent/operator/reviewer concern.

---

# 14. SCRUTINY

Substrate Light uses the canonical scrutiny vocabulary needed by current XTRM work:

```text
none
low
medium
high
critical
```

Inheritance rule:

> A child may increase SCRUTINY but may not silently lower inherited SCRUTINY.

Any explicit future downgrade mechanism must be an authority-bearing operation, not ordinary child editing.

---

# 15. Parent/child integrity

Parentage is explicit in both logical identity and structured fields.

For:

```text
unitAI-a.1.1
```

`issue.json` must say:

```json
{
  "id": "unitAI-a.1.1",
  "root_id": "unitAI-a",
  "parent_id": "unitAI-a.1"
}
```

and the physical location must be:

```text
issues/unitAI-a/children/1/children/1/
```

If logical ancestry and physical ancestry disagree, validation fails.

This redundancy is intentional: it makes corruption obvious during the JSON bootstrap phase.

---

# 16. Context inheritance

Context inheritance is a defining feature of Substrate Light.

Resolving:

```text
unitAI-a.1.1
```

walks:

```text
unitAI-a
  ↓
unitAI-a.1
  ↓
unitAI-a.1.1
```

and produces one deterministic `EffectiveIssueContext`.

Core rule:

> Children narrow or add context; they do not silently erase parent authority.

Consumers must not independently walk parent files and concatenate prose.

The store owns context resolution.

---

# 17. Contract inheritance semantics

Inheritance must be defined per field rather than by text concatenation.

## `problem`

The current issue's problem is primary.

Ancestor problems are retained as objective/background context, not copied into the local problem field.

## `success`

Local success criteria are required.

Applicable ancestor success requirements remain inherited unless explicitly discharged by a governed parent decision.

## `scope`

Scope is progressively narrowed.

A child cannot silently expand outside the effective parent scope.

## `non_goals`

Effective non-goals are the inherited union plus local additions.

A child cannot remove an ancestor non-goal through omission.

## `constraints`

Effective constraints are inherited union plus local additions.

A child cannot erase an ancestor constraint by failing to repeat it.

## `validation`

Mandatory ancestor validations remain applicable unless the parent explicitly delegates/discharges them.

Local validation is added to inherited validation.

## `output`

The current issue's output is primary for its activation.

Ancestor output obligations remain visible as root/parent acceptance context but are not blindly duplicated as local deliverables.

## `scrutiny`

Effective scrutiny is at least the highest inherited level.

---

# 18. Provenance of inherited context

Every inherited value must preserve where it came from.

Conceptually:

```json
{
  "value": "Do not create a second runtime ontology",
  "source_issue": "unitAI-a",
  "field": "constraints"
}
```

This allows a Specialist working on `.1.1.2` to answer:

```text
why is this constraint here?
which ancestor imposed it?
```

without searching the whole epic manually.

---

# 19. `EffectiveIssueContext`

Conceptual runtime type:

```ts
interface EffectiveIssueContext {
  issueId: string;
  rootId: string;

  ancestry: IssueRef[];

  rootObjective: string;

  current: IssueContract;

  inherited: {
    success: InheritedValue<string>[];
    nonGoals: InheritedValue<string>[];
    constraints: InheritedValue<string>[];
    validation: InheritedValue<string>[];
  };

  effectiveScrutiny: Scrutiny;

  evidenceRefs: EvidenceRef[];
  artifactRefs: ArtifactRef[];
}
```

The exact TypeScript shape may evolve, but ancestry and source provenance are required semantics.

---

# 20. Context depth

The canonical Substrate design already treats context depth as an explicit runtime concern.

Substrate Light should preserve a future seam for policies such as:

```text
full ancestry
root + parent
parent only
bounded depth
```

For v0, full ancestry resolution is acceptable because issue trees are expected to remain small.

The key invariant is that context-depth policy belongs to the resolver, not individual consumers.

---

# 21. Relations

Parentage is not the only graph edge.

Minimal v0 relations:

```text
blocks
relates_to
discovered_from
supersedes
```

`blocked_by` can be derived as the reverse view of `blocks`; do not persist both directions unless a later storage backend requires it.

Example:

```json
{
  "kind": "blocks",
  "target": "unitAI-b.2"
}
```

The canonical Substrate design already identifies relation metadata, cycle prevention, mutation authority, and query semantics as areas requiring discipline. Substrate Light intentionally implements only the minimal safe subset.

---

# 22. Graph integrity

The following must be impossible:

```text
parent cycle
issue parenting itself
root pointing to a descendant
duplicate child identity
blocking self-edge
invalid relation target syntax
```

Blocking-cycle policy may initially reject all cycles for simplicity.

The relation layer should be replaceable later without changing issue identity.

---

# 23. Append-only issue events

Each issue folder contains:

```text
events.jsonl
```

Example:

```jsonl
{"seq":1,"kind":"issue.created","at":"2026-09-08T20:00:00Z","by":"operator"}
{"seq":2,"kind":"issue.state_changed","from":"open","to":"in_progress","at":"2026-09-08T20:10:00Z","by":"agent"}
{"seq":3,"kind":"issue.contract_updated","revision":2,"at":"2026-09-08T20:15:00Z","by":"agent"}
```

`issue.json` is the current projection.

`events.jsonl` is durable mutation history.

This is required for:

```text
manual debugging
provenance
DB migration
replay/import validation
later forensic correlation
```

---

# 24. Mutation events

Minimum event kinds:

```text
issue.created
issue.updated
issue.state_changed
issue.contract_updated
issue.scrutiny_changed
issue.relation_added
issue.relation_removed
issue.child_created
issue.closed
issue.cancelled
```

More detailed event vocabulary can be added only when consumed.

---

# 25. `index.json`

`.xtrm/substrate/index.json` is a regenerable projection.

Example:

```json
{
  "schema": "xtrm.substrate.index.v1",
  "issues": {
    "unitAI-a": {
      "path": "issues/unitAI-a",
      "state": "in_progress",
      "type": "epic"
    },
    "unitAI-a.1": {
      "path": "issues/unitAI-a/children/1",
      "state": "open",
      "type": "task"
    }
  }
}
```

It is an optimization only.

If removed or corrupted, it must be rebuildable by walking issue folders.

Authority remains `issue.json` + issue event history.

---

# 26. Atomic filesystem writes

Plain JSON does not mean unsafe writes.

Projection updates use:

```text
write temp file
flush/fsync where appropriate
atomic rename
```

Never rewrite `issue.json` directly in place.

Events are append-only under the same mutation lock/transaction boundary used by the filesystem backend.

A crash must not leave half-written JSON presented as a valid issue.

---

# 27. Concurrency

Substrate Light does not require the final daemon.

v0 may use a filesystem lock scoped to the root epic or exact issue mutation domain.

The storage implementation must isolate locking behind the store so a later backend can replace it with the canonical state-engine transaction model.

Readers should not require exclusive locks.

---

# 28. Human inspection

The filesystem backend is intentionally inspectable.

Useful operator commands should include:

```text
sb issue show <id>
sb issue tree <id>
sb issue children <id>
sb issue context <id>
sb issue ready <id>
```

`sb issue context unitAI-a.1.1` should render something like:

```text
unitAI-a
└─ unitAI-a.1
   └─ unitAI-a.1.1

ROOT OBJECTIVE
...

PARENT CONTEXT
...

CURRENT MANDATE
...

INHERITED CONSTRAINTS
- ... [unitAI-a]
- ... [unitAI-a.1]

LOCAL VALIDATION
...
```

This is a primary debugging surface, not a cosmetic feature.

---

# 29. Minimal CLI

The initial CLI should stay small:

```text
sb issue create
sb issue show
sb issue edit
sb issue close
sb issue children
sb issue tree
sb issue ready
sb issue context
sb issue relate
```

The canonical Substrate package already owns the `sb` binary namespace; Substrate Light should not invent another work-tracker CLI unless the package layout changes first.

No daemon is required to use these commands in v0.

---

# 30. `WorkItemStore`

Consumers must not know whether work came from JSON, Beads compatibility, or a future database.

Conceptual interface:

```ts
interface WorkItemStore {
  get(id: string): Promise<WorkItem>;

  resolveContext(id: string): Promise<EffectiveIssueContext>;

  validateReady(id: string): Promise<ReadinessResult>;

  children(id: string): Promise<WorkItemRef[]>;

  relations(id: string): Promise<Relation[]>;
}
```

Implementations:

```text
SubstrateLightWorkItemStore
    canonical for new XTRM work

BeadsWorkItemStore
    compatibility/import backend only
```

The interface is part of the stopping point.

---

# 31. Native Specialist integration

Native Specialists should stop depending directly on Beads syntax.

**Implementation status: IMPLEMENTED.** The migration has landed in `xtrm-dev/specialists`. Implementing
commit: `4bc708f9` — "feat: migrate native activation boundary to Substrate work items (xtrm-6qu.7)". The
Beads bridge path previously shown here no longer exists; the shipped path is below.

Implemented path:

```text
specialist_dispatch
    ↓
WorkItemStore boundary (src/activation/workitem-store.ts)
    ↓
Substrate Issue: view / check / bind
    ↓
SpecialistLoader
    ↓
Markdown section parser
    ↓
StepContract
```

Target path:

```text
specialist_dispatch
    ↓
WorkItemStore.get()
    ↓
validateReady()
    ↓
resolveContext()
    ↓
SpecialistLoader
    ↓
StepContract
    ↓
NativeActivationHost
```

The activation runtime does not need to know which backend supplied the `WorkItem`.

---

# 32. StepContract integration

The existing StepContract abstraction remains correct.

Its input changes from:

```text
parsed Bead compatibility contract
```

to:

```text
EffectiveIssueContext
+
SpecialistActivationProfile
```

This means the Specialist receives:

```text
root objective
relevant parent context
current mandate
inherited constraints/non-goals/validation
current output requirements
source provenance
```

without prompt-time recursive filesystem walking.

---

# 33. Planning integration

Planning should eventually create structured Substrate Light issues directly.

For example:

```text
unitAI-a             epic
├─ unitAI-a.1        task
│  ├─ unitAI-a.1.1  task
│  └─ unitAI-a.1.2  task
└─ unitAI-a.2        task
```

The root stores product/architectural context.

Children store bounded local mandates.

Agents must not need to duplicate all ancestor prose into each child merely to preserve context.

The resolver provides that inheritance.

---

# 34. Beads compatibility

Beads becomes a temporary compatibility source, not the long-term work authority.

The bridge may provide:

```text
read existing Bead
convert current fields into WorkItem
walk Beads parent/dependency graph
import an epic tree into Substrate Light
```

Do not extend Beads-specific parsing once Substrate Light is available unless required for migration correctness.

---

# 35. No permanent dual-write

Do not build a permanent:

```text
Beads ↔ Substrate
```

bidirectional mirror.

Dual authority is worse than either implementation individually.

Preferred migration model:

```text
Beads legacy source
    ↓
read/import adapter
    ↓
Substrate Light
    ↓
canonical new state
```

Once an epic is imported and declared canonical in Substrate Light, new mutations go there.

---

# 36. Migration phases

## S0 — filesystem issue kernel

Land:

```text
issue schema
folder layout
atomic store
hierarchy
relations
readiness
context inheritance
events
minimal CLI
```

## S1 — WorkItemStore integration

Native Specialists consume `WorkItemStore`.

Substrate Light becomes the preferred backend.

Beads remains readable through compatibility.

## S2 — planning defaults to Substrate Light

New planned work is created as Substrate issues by default.

## S3 — per-epic Beads import

Existing active Beads can be imported root-by-root.

No global forced migration is required on day one.

## S4 — Chain materialization targets Substrate

Only after the issue/work graph is stable should new Chain work materialize into Substrate issues.

## S5 — retire Beads from XTRM runtime

Remove direct Beads dependency after active compatibility requirements disappear.

---

# 37. Future database import

Every filesystem field must map directly to the future Substrate database model.

Migration must preserve:

```text
issue ID
root ID
parent ID
revision
state
contract
scrutiny
relations
provenance
timestamps
event sequence
artifact/evidence refs
```

Import should be semantic identity preservation, not a migration that reinterprets work.

The JSON representation is a bootstrap backend for the Substrate model, not a separate model.

---

# 38. Versioning

`.xtrm/substrate/version.json` identifies the filesystem schema.

Example:

```json
{
  "schema": "xtrm.substrate.fs.v1",
  "issue_schema": "xtrm.substrate.issue.v1"
}
```

Schema migrations must be explicit and testable.

Do not silently mutate old files during ordinary reads.

---

# 39. Provenance

Every issue records at minimum:

```text
created_by
created_at
updated_at or revision timestamps
discovered_from where applicable
```

Future runtime activation lineage may reference issue IDs directly without making issue files store AgentSession-specific state.

Work authority and execution telemetry remain separate domains linked by opaque IDs.

---

# 40. Evidence and artifacts

Substrate Light stores references, not arbitrary duplicated payloads.

Issue context may carry:

```text
evidence_refs
artifact_refs
```

The format should be future-compatible with canonical Substrate/telemetry evidence references.

The filesystem backend does not need to implement the full evidence store.

---

# 41. Deletion policy

Normal work items should not be physically deleted.

Use:

```text
cancelled
closed
superseded relation
```

Physical deletion is an administrative/recovery operation only.

This preserves IDs, ancestry, and historical references.

---

# 42. Editing semantics

An edit to `issue.json` through the official store:

```text
validates schema
validates graph invariants
increments revision
appends event
atomically replaces projection
updates regenerable index
```

Direct manual JSON edits are permitted for bootstrap/recovery debugging but must be detected by `sb issue doctor` or equivalent integrity validation later.

---

# 43. Scope narrowing

Substrate Light should not pretend to solve semantic set theory for arbitrary prose scope.

For v0:

- structural inheritance is deterministic;
- inherited constraints/non-goals/validation are not erasable by omission;
- child scope expansion is flagged for review when explicitly marked as an expansion;
- planning/reviewer judgment determines whether natural-language local scope actually exceeds its parent.

The tracker must not claim mechanical semantic understanding it does not possess.

A future structured scope-ref system may strengthen this.

---

# 44. Readiness versus quality

Important distinction:

```text
ready
    structurally dispatchable

well-planned
    judgment about quality/completeness
```

Substrate Light mechanically proves the first only.

A planner/reviewer/chain coordinator may refuse work that is structurally ready but semantically poor.

---

# 45. Specialist transition rule

Once S1 lands, the native-Specialists PRD should change its durable-work invariant from:

> Bead is authoritative tracked work.

into:

> `WorkItem` is authoritative tracked work. `SubstrateLightWorkItemStore` is canonical for new work; `BeadsWorkItemStore` is a temporary compatibility/import backend.

The native activation runtime should not change again when Substrate later moves from JSON to `state.db`.

---

# 46. Chain sequencing rule

No substantial new Chain implementation should harden a new dependency on Beads after Substrate Light is available.

Preferred sequence:

```text
Native Specialists
        ↓
Substrate Light
        ↓
typed work/context graph
        ↓
Chain materialization
        ↓
full Substrate runtime
```

This avoids building Chain materialization against Beads only to replace that work graph shortly afterward.

---

# 47. Acceptance criteria

Substrate Light v0 is complete when all of the following are proven.

## Storage and identity

1. create a root epic;
2. create `.1`, `.1.1`, and `.2` children;
3. physical folder ancestry matches logical ancestry;
4. invalid ancestry is refused;
5. sibling IDs are monotonic and not reused;
6. title edits do not change IDs.

## Contracts

7. all seven work-contract fields are structured values;
8. SCRUTINY is structured;
9. no Markdown-heading parser is required for canonical Substrate Light issues;
10. `draft` issues are refused for Specialist dispatch;
11. structural readiness is deterministic.

## Context

12. resolving `.1.1` walks to the root epic;
13. inherited non-goals do not disappear through omission;
14. inherited constraints do not disappear through omission;
15. inherited mandatory validation remains visible;
16. scrutiny cannot silently decrease;
17. every inherited value identifies its source issue;
18. `sb issue context` renders the effective ancestry/context clearly.

## Graph

19. parent cycles are impossible;
20. blocking self-edges are rejected;
21. children and relations are queryable without scanning Markdown;
22. `index.json` can be deleted and rebuilt.

## Durability

23. every mutation increments revision;
24. every mutation appends an issue event;
25. an interrupted projection write never leaves partially valid JSON;
26. closed/cancelled work remains addressable.

## Specialist integration

27. native Specialist dispatch works through `WorkItemStore`;
28. a Substrate Light issue compiles into a StepContract;
29. the activation receives root/ancestor/current context with provenance;
30. the native Specialist path no longer directly depends on Beads Markdown parsing when using the canonical backend;
31. the Beads compatibility backend still permits legacy work during migration.

## Migration

32. a complete root epic tree can be read into an equivalent in-memory/database representation without losing IDs, revisions, relations, provenance, contracts, or event history.

---

# 48. Stopping point

Once Substrate Light S0 + S1 are working:

- stop expanding Beads integration except migration fixes;
- update planning to prefer Substrate issues;
- update the native-Specialists PRD to make `WorkItem` canonical;
- validate real daily work against the JSON issue graph;
- only then resume substantial Chain materialization work.

The intentionally small stopping point is:

```text
structured work authority
clean hierarchy
inherited context
relations
readiness
provenance/events
Specialist consumer seam
```

Everything else remains in the canonical full Substrate design until a real runtime consumer requires it.
