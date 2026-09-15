# XTRM Native Memory System — PRD v0.2

Status: Draft for implementation
Date: 2026-09-15
Scope: XTRM Substrate + Core + future XTRM harness
Supersedes: PRD v0.1 design draft

## 1. Product invariant

XTRM does not need an agent to remember that something happened. Git and Substrate already remember what happened.

XTRM Memory exists to make that history retrievable and to preserve the reusable meaning learned from it.

- Git remembers the change.
- Substrate remembers the work and evidence.
- Memory remembers the lesson.
- Retrieval decides what is useful now.
- The agent reasons over the result.
- Python remembers the investigation.
- Substrate remembers the truth.

## 2. Goals

Build a native, provider-neutral memory subsystem that:

1. Uses Git + Substrate evidence as the canonical historical basis.
2. Adds a sparse semantic MemoryRecord layer for durable reusable lessons.
3. Supports temporal correctness through supersession, invalidation, contradiction, and as-of retrieval.
4. Keeps retrieval progressive, bounded, and pull-based.
5. Lets the Python kernel act as a stateful memory workbench without becoming a second runtime or persistence authority.
6. Exposes the same capabilities to Pi, Claude, future harnesses, and other adapters.
7. Measures retrieval quality and pollution before enabling denser or more autonomous semantic machinery.

## 3. Non-goals

v0 does not include:

- a universal graph database;
- an external vector database;
- a separate memory daemon;
- always-in-prompt memory injection;
- transcript storage as semantic memory;
- chain-of-thought persistence;
- direct SQLite access from agents or Python;
- automatic skill rewrites from single trajectories;
- Python-owned promotion, supersession, invalidation, or lifecycle authority;
- persistent Python namespace as durable memory.

## 4. System boundaries

### 4.1 History
History answers: what actually happened?

Canonical sources:
- Git commits, full immutable SHAs, commit messages and bodies;
- Substrate issues and revisions;
- journal entries;
- WorkReceipts;
- execution bindings;
- reviews;
- evidence;
- operator decisions.

History is not copied into MemoryRecord rows. A rebuildable history index makes these sources searchable.

### 4.2 Memory
Memory answers: what reusable lesson should survive across tasks?

Canonical semantic record types:
- decision
- constraint
- failure
- best_practice
- fact (conservative use only)

A MemoryRecord must be evidence-backed.

### 4.3 Knowledge
Knowledge is current subject truth, such as current source tree / HEAD, current docs, runtime state, Service Knowledge, repository manifests and configuration. Present-tense facts prefer current source over historical memory.

### 4.4 Context
Context is the bounded subset activated for the current execution. Context is not a store. It is a selection.

## 5. Authority model

### 5.1 Durable authority
`xt daemon` + `state.db` remain the local authority. Substrate memory services are clients of the core StateClient boundary. No domain package, provider adapter, or Python kernel opens `state.db` directly.

### 5.2 Python authority
The Python kernel is a stateful execution workbench.

It may retrieve, filter, aggregate, compare, analyze, prepare candidate memory, inspect commit history, run retrieval evaluation, and hold large intermediate result sets outside model context.

It may not promote MemoryRecord directly, supersede or invalidate canonical memory directly, mutate lifecycle state, bypass capability grants, become an indexing daemon, or become a second canonical store.

## 6. Future harness architecture

```text
                    Future XTRM Harness
                           |
                 +---------+---------+
                 | ActivationRuntime |
                 +---------+---------+
                           |
              ResolvedCapabilityGrant
                           |
             +-------------+--------------+
             |                            |
      AgentSessionRuntime        PythonExecutionSession
             |                            |
             |                     persistent Python
             |                            |
             |                    xtrm.history.*
             |                    xtrm.memory.*
             |                            |
             |                    HostCapabilityBridge
             |                            |
             +-------------+--------------+
                           |
                    CapabilityGateway
                     |             |
           HistoryQueryService   MemoryQueryService
                     |             |
                     +------+------+
                            |
                        StateClient
                            |
                        xt daemon
                            |
                        state.db
```

## 7. PythonExecutionSession

### 7.1 Identity
The kernel must not be keyed only by provider session id.

Target scope:

```text
execution_id + generation
  -> PythonExecutionSession
```

Rules:
- provider reconnect or compaction may keep the kernel if the same logical execution remains active;
- a new attempt may receive a fresh kernel;
- a new execution generation receives a fresh kernel;
- terminal execution kills the kernel;
- crash or timeout loses Python state but not durable XTRM state;
- no pickle/snapshot of arbitrary Python namespace into durable memory.

### 7.2 Kernel role
The kernel is optimized for multi-step repository analysis, progressive retrieval, local aggregation, retrieval drill-down, keeping intermediate corpus outside model context, code/history comparison, and evaluation workflows inside the agent session.

## 8. HostCapabilityBridge

The Python process receives capability proxies, never database handles.

Conceptual transport:

```text
fd0  cell request
fd1  cell response
fd2  diagnostics
fd3  XTRM capability RPC
```

Example:

```python
hits = xtrm.memory.search(
    "provider completion authority",
    lens="herd",
    types=["decision", "failure"],
    limit=20,
)
```

Internal flow:

```text
Python proxy
  -> HostCapabilityBridge
  -> CapabilityGateway.authorize(execution_id, capability)
  -> typed service
  -> StateClient
  -> xt daemon
```

The transport can evolve; the invariant is host-owned authorization and provider-neutral typed capabilities.

## 9. Provider-neutral capability contract

Canonical read capabilities:

```text
history.search
history.get
memory.search
memory.get
memory.explain
```

Governed write/proposal capability:

```text
memory.propose
```

Promotion and lifecycle mutation remain host-owned operations.

Adapters for Pi, Claude, Python, TUI, GUI, ACP, or future runtimes consume the same contracts.

## 10. Python client surface

The Python package should expose thin immutable clients, not a second domain runtime.

```python
class Xtrm:
    history: HistoryClient
    memory: MemoryClient
```

### 10.1 HistoryClient

```python
class HistoryClient:
    def search(
        self,
        query=None,
        *,
        path=None,
        symbol=None,
        issue=None,
        since=None,
        until=None,
        as_of=None,
        limit=20,
    ) -> HistoryPage: ...

    def for_file(
        self,
        path,
        *,
        query=None,
        as_of=None,
        limit=8,
    ) -> HistoryPage: ...

    def get(
        self,
        ref,
        *,
        include=("message", "provenance"),
    ) -> HistoryRecord: ...
```

### 10.2 MemoryClient

```python
class MemoryClient:
    def search(
        self,
        query,
        *,
        lens="workgroup",
        types=None,
        as_of=None,
        include_superseded=False,
        limit=8,
    ) -> MemoryPage: ...

    def get(self, memory_id) -> MemoryRecord: ...

    def explain(self, memory_id) -> MemoryExplanation: ...

    def candidate(
        self,
        *,
        type,
        statement,
        rationale=None,
        source_refs=(),
    ) -> MemoryCandidate: ...
```

Intentionally absent:

```text
promote()
delete()
supersede()
invalidate()
```

## 11. Bounded result objects

Persistent Python makes result objects more valuable than large tool outputs.

```python
r = xtrm.history.search(
    "completion race",
    path="packages/runtime",
    limit=50,
)

r.preview(5)
r.by_path()
r.refs()
r.failures()
```

A result may hold many records in Python memory while only a compact preview enters model context.

Requirements:
- bounded `__repr__`;
- stable source refs;
- deterministic pagination;
- result snapshot identity;
- explicit expansion methods;
- no accidental dump of raw corpora.

Core objects:
- HistoryHit
- MemoryHit
- HistoryPage
- MemoryPage
- MemoryExplanation
- PreflightResult

## 12. preflight v2

`preflight()` remains a client-side composition, not a new server authority.

```python
def preflight(path, *, task=None, history=5, memories=5):
    h = xtrm.history.for_file(
        path,
        query=task,
        limit=history,
    )

    m = xtrm.memory.search(
        task or path,
        lens="workgroup",
        types=[
            "constraint",
            "failure",
            "decision",
            "best_practice",
        ],
        limit=memories,
    )

    d = workspace.diffstat(path)

    return PreflightResult(
        history=h,
        memories=m,
        diff=d,
    )
```

v2 removes bd memory lookup, basename-only matching, short SHA dependence, and the `0 commits == wrong path` assumption.

It adds full immutable commit refs, path/symbol/task-aware retrieval, Substrate history, active semantic memory, explicit empty-history vs invalid-path distinction, current diff awareness, and a bounded structured result.

### 12.1 Trigger policy

```text
bugfix
OR architectural/high-impact file
OR GitNexus impact >= medium
OR agent explicitly uncertain about historical rationale
  -> preflight

otherwise
  -> continue without memory retrieval
```

The system should optimize both recall and pollution avoidance.

## 13. Semantic data model

### 13.1 MemoryCandidate

```text
type
statement
rationale?
sourceRefs[]
reusableFor[]
proposedBy
  participantId?
  executionId?
  mechanism
    chain_close
    failure_recovery
    operator
    history_backfill
```

Candidate is not canonical memory.

### 13.2 MemoryRecord

```text
id
projectId
type
statement
rationale?
status
  active
  superseded
  invalidated
sourceRefs[]
semanticKey?
supersededBy?
metadata
```

### 13.3 Source refs

A memory must trace back to one or more immutable or durable refs:

```text
git_commit
issue_revision
work_receipt
journal_entry
evidence
review
operator_decision
```

## 14. Semantic lifecycle

```text
Gather evidence
  -> Propose 0..N MemoryCandidate
  -> Validate source refs / safety / present-state misuse
  -> Reconcile with existing memory
  -> classify:
       duplicate
       support
       supersede
       contradiction
       invalid
  -> Promote valid MemoryRecord
```

Zero candidates is valid.

## 15. Candidate submission in governed chains

In governed ChainRuns, memory candidates should travel through the execution result envelope.

Preferred:

```text
Coordinator/worker result
  -> ResultEnvelope
       memory_candidates: [...]
  -> host validates
  -> MemoryCandidate state
  -> policy-controlled promotion
```

Avoid:

```text
agent
  -> python
  -> hidden side effect
  -> canonical memory mutation
```

Interactive agents may use `memory.propose`, but proposal is still not promotion.

## 16. Supersession and temporal correctness

Memory mutation is append/version oriented.

Relations:

```text
supports
supersedes
contradicts
invalidates
```

Rules:
- active memory returned by default;
- superseded memory excluded by default;
- historical/as-of mode can retrieve superseded rows;
- no silent overwrite;
- contradiction can remain unresolved until sufficient evidence exists.

## 17. Query lenses

`herd`, `workgroup`, and `identity` are query lenses, not physical stores.

### workgroup
Retrieves memories relevant to active issue/container/chain, parent/child lineage, related files, and causal local work.

### identity
Retrieves reusable role/specialist practice.

### herd
Retrieves project/domain-wide promoted knowledge: architectural decisions, broad constraints, cross-cutting failures, and reusable best practices.

Execution lineage is provenance/filter context, not a fourth memory store.

## 18. Storage and indexing

Authoritative semantic state remains in `state.db`.

Initial conceptual tables:

```text
memories
memory_sources
memory_relations
memory_index_documents
memory_fts
```

`memory_index_documents` and `memory_fts` are derived and rebuildable. No external vector service in v0.

## 19. Retrieval v0

Baseline:

```text
query
  -> scope filters
  -> exact identifier/path/SHA matching
  -> SQLite FTS5 lexical retrieval
  -> deterministic ranking
  -> bounded results
```

## 20. Dense / hybrid retrieval gate

Dense retrieval is optional and eval-gated.

Candidate implementation:

```text
sqlite-vec exact KNN
```

Do not depend on experimental ANN functionality.

If dense retrieval beats lexical baseline:

```text
FTS5
 +
dense retrieval
 -> RRF baseline
 -> optional rerank
```

Hybrid is not automatically better. Each branch must be evaluated independently and in fusion.

## 21. MemoryIndexWorker

If embeddings or heavy index rebuilds are introduced, they run in dedicated infrastructure workers.

Never use the interactive agent PythonExecutionSession as the canonical index worker.

```text
Agent PythonExecutionSession
  = exploratory state

MemoryIndexWorker
  = deterministic/rebuildable infrastructure
```

Both may use Python technology, but they have different lifecycle and authority.

## 22. Historical bootstrap

Bootstrap has two independent layers.

### deterministic
Rebuild source/history indexes from Git, Substrate issue history, journal, evidence, WorkReceipts, and reviews. No LLM required.

### semantic
Optional agentic consolidation over prioritized history:
- high-change areas;
- high-impact files;
- bug/fix history;
- architectural decisions;
- failures;
- recent active surfaces.

Do not create one semantic memory per commit.

## 23. Git as episodic memory

Git history is already a durable episodic memory layer.

Commit messages are first-class retrieval signals but not complete truth.

A commit bundle may combine:

```text
commit
issue
review
journal
receipt
operator decision
```

Current source is the authority for present behavior. History explains how and why that behavior emerged. Memory distills only reusable meaning.

## 24. Security and capability model

Capabilities are distinct:

```text
memory.read
memory.propose
memory.promote
memory.invalidate
history.read
```

A participant can search without receiving mutation authority.

Memory retrieval cannot widen access beyond underlying source permissions.

Reject or redact secrets, credentials, private keys, unrelated personal data, hidden reasoning traces, and sensitive source content outside the execution grant.

## 25. Observability

Record:
- retrieval count;
- source class;
- lens;
- latency;
- result count;
- empty-result rate;
- expansion rate;
- candidate count;
- promotion rate;
- duplicate rate;
- supersession rate;
- stale-memory use;
- retrieval token/context cost.

Do not use high-cardinality memory text as metric labels.

## 26. Evaluation

### 26.1 Retrieval
Use temporal splits so evaluation does not retrieve future evidence.

Metrics:
- Recall@K;
- MRR;
- nDCG;
- empty-result rate;
- false-positive / pollution rate;
- latency;
- context/token cost.

### 26.2 Agent outcomes

Compare:

```text
baseline
history-only
semantic-memory-only
history + semantic memory
```

Measure task success, repeated mistakes, stale-memory induced failures, unnecessary retrieval, and reasoning/context cost.

### 26.3 Mutation correctness

Explicitly test:
- superseded decisions;
- changed constraints;
- reverted fixes;
- conflicting evidence;
- abstention when no memory applies.

## 27. Roadmap

### MEM-0 — History and lexical retrieval
Deliver source projection, history index, FTS5, exact path/SHA/identifier retrieval, `history.search`, `history.get`, rebuild command, and telemetry.

### MEM-0B — Stateful workbench integration
Deliver read-only HostCapabilityBridge, PythonExecutionSession identity model, Python HistoryClient, bounded result objects, `preflight()` v2, and retrieval telemetry/pollution measurement.

This phase intentionally dogfoods retrieval before semantic memory is fully enabled.

### MEM-1 — Semantic memory lifecycle
Deliver MemoryCandidate, MemoryRecord, source refs, duplicate/support/supersede/contradict, `memory.search`, `memory.get`, and `memory.explain`.

### MEM-2 — Consolidation
Deliver issue/chain close proposal flow, semantic failure proposal flow, ResultEnvelope candidate transport, validation and promotion policy, and release/receipt evidence.

### MEM-3 — Provider parity
Deliver Pi adapter, Claude adapter, Python MemoryClient, TUI/GUI hooks where needed, governed `memory.propose`, and no adapter-private authority.

### MEM-4 — Historical semantic bootstrap
Deliver prioritized history analysis, candidate generation, reviewable promotion, and no one-memory-per-commit behavior.

### MEM-5 — Retrieval evaluation and dense gate
Deliver temporal benchmark, FTS5 baseline, sqlite-vec experiment, hybrid/RRF experiment, stale-memory benchmark, and production decision.

### MEM-6 — Advanced relational memory, conditional
Only if evidence shows flat + relational SQL retrieval is insufficient: richer semantic relations, temporal relation queries, causal traversal, and no pre-authorized graph database migration.

## 28. Acceptance criteria

The first production-quality milestone is achieved when:

1. an agent can retrieve relevant commit/Substrate history without raw corpus injection;
2. `preflight()` v2 works without Beads;
3. Python can keep large retrieval sets outside model context;
4. Python has no direct canonical mutation authority;
5. MemoryRecord is evidence-backed;
6. superseded memory does not appear in normal retrieval;
7. all adapters consume provider-neutral capability contracts;
8. `state.db` remains the single local authority;
9. retrieval telemetry can quantify both recall and pollution;
10. memory can be disabled without preventing normal execution.

## 29. Final architecture rule

```text
Git remembers the change.
Substrate remembers the work and evidence.
Memory remembers the lesson.
Retrieval decides what is useful now.
The agent reasons over the result.

Python remembers the investigation.
Substrate remembers the truth.
```
