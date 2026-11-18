---
status: current
owner: substrate
last_verified_against: 3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f
---

# Provenance and Closure

## Evidence spine

```mermaid
flowchart LR
  I[Issue rev/hash] --> B[ExecutionBinding]
  B --> X[session / participant / activation / attempt]
  X --> R[Journal result]
  X --> W[WorkReceipt]
  W --> A[commit / PR / artifact / validation]
  R --> C[Closure]
  A --> C
```

`ProvenanceService.trace()` returns the canonical forward view: Issue identity,
revision/hash, attestation, claims, execution bindings, WorkReceipts with
artifacts and execution context, checkpoints, commits, PRs, external bindings
and closure revision.

Reverse queries answer questions such as:

```text
What did this session touch?
What did this Specialist activation produce?
Which Issue/receipt authorized this commit or PR?
```

## WorkReceipts

Receipts are host-allocated and inherit authority from an ExecutionBinding.
Executor output cannot mint its own Issue revision/hash authority. Artifacts are
attached to receipts and can be reconciled across Git rewrite where supported.

## Closure

Closure is a first-class immutable row. Bounded outcomes are:

```text
completed
superseded
duplicate
wont_fix
invalid
cancelled
abandoned
```

A deliberate close needs a reason. Evidence refs may point to Journal results,
receipts, validation and artifacts. Reopen preserves the old Closure and adds a
new lifecycle event; stopping one activation is not cancelling the Issue.

## Allocate and link a receipt

Dispatch before execution, then allocate a receipt from that binding. Use the
live claim holder as `--participant`; do not take over another participant's
claim.

```bash
sb provenance dispatch XTRM-123 --participant coordinator
sb provenance allocate <binding-id> --checkpoint <checkpoint-entry-id>
sb provenance bind <receipt-id> <40-char-sha>
sb provenance receipt <receipt-id>
sb provenance commit <40-char-sha>
```

`allocate` copies the binding's Issue revision/hash. `--checkpoint` is optional;
omission stores null, not a guessed latest checkpoint. The CLI checks that a
supplied entry exists and has kind `checkpoint` or `compaction`. The caller must
select the correct Issue's continuity boundary: allocation does not check that
the checkpoint and binding belong to the same Issue.

`bind` uses the caller-supplied commit SHA. Binding the same receipt to the same
SHA is idempotent; a different SHA fails closed. Git rewrite reconciliation is
a separate `reconcileRewrite` service operation used by the post-rewrite adapter.
Neither allocation nor binding invents a commit or checkpoint.

## Execution identity

The execution envelope and legacy scalar columns describe the same facts.
Journal and provenance writes project envelope identity into their queryable
columns. Session projection prefers XTRM session identity, then provider session
identity, then a legacy scalar. Conflicting stated counterparts fail closed
before a row is written; XTRM and provider sessions are distinct facets, not
conflicting values of one field. `runId` remains optional and
caller-supplied; it is not inferred from an activation or session.

New writes validate identity at the service boundary. XTRM session identity is
a UUID (normalized to lowercase) or a tmux session ID such as `$2`. Provider
session labels belong to `host.sessionId`; they do not become XTRM session IDs.
Participant and run labels must be shell-safe identifiers. Activation and
attempt IDs accept validated legacy labels as well as canonical forms.
Closure and reopen apply the same canonicalization to their execution envelopes;
an invalid identity leaves lifecycle and Closure history unchanged. Historical
rows are not rewritten by these validation rules.

A binding can also record who dispatched it: `--dispatcher-participant
<holder>` and `--dispatcher-session <id>` (a lowercase UUID or a tmux `$N`
id). Both are optional and independent, are stored as observed labels beside
the executor identity (`--participant`, `--session`), and are never defaulted
from the environment. A binding written without them, including every binding
written before migration 017, reads as absent (`null` in `--json`), never as a
placeholder. A malformed value fails closed and writes no binding.

```bash
sb provenance dispatch XTRM-123 --participant worker-1 --session '$2' \
  --dispatcher-participant lead-1 --dispatcher-session '$1'
```

Human `sb provenance trace` names each binding's participant, activation,
session and dispatcher (`dispatched by <participant> (sess <id>)`), shows
`(unattributed)` for absent execution identity, and bounds long
sections with an omitted-item count. Use `sb provenance trace XTRM-123 --json`
for the untruncated service view. Rendering does not manufacture missing
bindings, receipts or identity. `sb provenance session <id>` and
`sb provenance activation <id>` print a `dispatchers:` block with the same
`dispatched by …` line per binding, or `dispatchers: (none recorded)`; their
`--json` carries a `dispatchers` array with `null` for an absent field.

```bash
sb provenance graph --project prj_xtrm --since 1763000000000 --limit 200
```

`sb provenance graph` reads one project's dispatch tree in a single bounded
call instead of joining per-Issue traces. Nodes are participants, activations,
Issues (human refs) and pull requests; edges are `works_on` (a binding's
executor to its Issue), `dispatched_by` (the binding's recorded dispatcher to
the executor) and `delivers` (an Issue to a live `created_from` PR link). An
activation node carries its holder in `participantId`, so a leaf worker that
dispatched nothing still has an identity. `--since` bounds the binding window
by millisecond timestamp or ISO timestamp; `--limit` defaults to 200 and is
capped at 1000 newest bindings. `matchedBindings`, `omittedBindings` and
`truncated` state exactly what the bound cut, so a truncated answer is never
mistaken for a complete one. A binding with no recorded dispatcher keeps its
`dispatched_by` edge with a `null` source, and a binding with no execution
identity contributes no edge; nothing is defaulted from the environment. The
same read is available to the typed service as `provenance.dispatchGraph`
(`projectId`, optional `since` and `limit`).

Sources: [`execution-context.ts`](../src/domain/execution-context.ts),
[`provenance-service.ts`](../src/service/provenance-service.ts),
[`closure-service.ts`](../src/service/closure-service.ts).
