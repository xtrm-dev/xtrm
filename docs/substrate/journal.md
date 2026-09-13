# Substrate Journal — operator reference

Covers ADR §68 in full. The Journal is the durable execution narrative
and continuity for one Issue. It is never authority (§68 "what Journal is
not"): it records progress, it never changes the contract. A separate
promotion step (not in v0) would be required before any Journal content
becomes reusable truth — Journal != Memory.

Kind list below is illustrative of the checklist order, not a copy of the
runtime definition: the release gate imports `JOURNAL_KINDS` from
`packages/substrate/src/domain/journal.ts` at run time and fails CI if any
registered kind lacks a section here
(`packages/substrate/tests/docs-drift-gate.test.ts`).

## Purpose

Durable, append-only, per-Issue continuity: what was observed, decided,
blocked on, completed, and handed over — readable by the next worker
without the previous chat transcript.

## What Journal is not

- Not authority: entries never change the contract or revision.
- Not memory: findings never become reusable truth without promotion.
- Not a transcript: bounded entries, never pasted shell logs or child
  transcripts.

## All Journal kinds, with an example of every kind

Nine kinds, bounded (ADR §22): `note`, `finding`, `decision`, `blocker`,
`milestone`, `handoff`, `result`, `checkpoint`, `compaction`. Every kind below
has an example; the anti-drift gate asserts this list against `JOURNAL_KINDS`
in the code.

### `note` — ordinary useful annotation

```bash
sb issue note GATE-1 "Retry queue depth looks normal after the restart" --kind note
sb journal append GATE-1 --kind note --semantic '{"summary":"Retry queue depth looks normal"}'
```

Default kind. Anything worth keeping that is not one of the kinds below.

### `finding` — material observation

```bash
sb issue note GATE-1 "p99 latency doubles when the compaction worker runs" --kind finding
```

A material fact discovered during execution. Record it; do not re-derive
it next session.

### `decision` — architectural choice plus reason

```bash
sb issue note GATE-1 "Use cursor pagination: offset breaks under concurrent inserts" --kind decision
```

Choice + reason. Decisions that change authorized work still require a
new Issue revision via planning — the entry records the choice, it does
not authorize it.

### `blocker` — external dependency

```bash
sb issue note GATE-1 "Waiting on REVIEW-7 before the migration can land" --kind blocker
```

A blocked condition outside the worker's control. Incompatible blockers
must clear before closure.

### `milestone` — progress boundary

```bash
sb issue note GATE-1 "All three replicas acknowledge writes" --kind milestone
```

A completed step on the way to SUCCESS. Marks progress; does not close.

### `handoff` — continuation for the next worker

```bash
sb issue note GATE-1 "Remaining: rerun the load test, then attest; capsule has the cursor" --kind handoff
```

Bounded: blockers, pending work, provenance refs. The next worker starts
from `sb issue resume`, never from chat history.

### `result` — bounded outcome of a completed run (payload required)

```bash
sb issue note GATE-1 "Ran the load test" --kind result
sb journal append GATE-1 --kind result --result '{"outcome":"pass","summary":"load test green at 2k rps","artifacts":["/var/tmp/load.txt"]}'
```

A `result` records a completed bounded run — most often an automatic
Specialist result — with a bounded structured payload (outcome, summary,
validation, findings, artifact and receipt references). It is legal with zero
Git commits: the outcome is the entry, not a commit. The payload is
mandatory, and a non-`result` kind must not carry one. Publication stays
bounded: never paste raw model output.

### `checkpoint` — mechanical-first durable state (requires mechanical row)

```bash
sb journal checkpoint GATE-1 --workspace /home/op/xtrm --branch feat/x
sb journal append GATE-1 --kind checkpoint --mechanical '{"issueId":"…","issueRevision":2,"contractHash":"…","collectedAt":…}'
```

Everything the host already knows (issue/revision/contract-hash,
workspace, branch, commits, claim/session identity) is written FIRST and
stays durable even if the semantic pass fails. Checkpoint at durable
boundaries; mechanical first, semantic second.

### `compaction` — compaction marker (requires mechanical row)

```bash
sb journal append GATE-1 --kind compaction --mechanical '{"issueId":"…","issueRevision":2,"contractHash":"…","collectedAt":…}'
```

Marks a compaction boundary. Same ordering guarantee as checkpoint:
mechanical row stays durable; compaction is never blocked.

> `result` is a Journal kind (see its section above): a completed bounded run
> records a bounded `result` payload with artifact and receipt references —
> see "Specialist results" below. The gate fails if a `result` kind is
> registered without a section here.

## Actor identity

Every entry may carry the actor the host knows: claim holder, claim
activation, participant, activation, session, run. The host records what
it observed; the service validates shapes fail-closed. Executor output
never self-certifies.

## Session lineage

Entries bind to the session/execution that produced them (`--session`,
`--run`, `--participant`, `--activation`). Session A checkpoints, session
B resumes from the capsule and dispatches a Specialist, session C
reconstructs authorized contract, progress, findings, decisions, result,
validation, lineage, artifacts, and closure reason — all from durable
state.

## Automatic metadata

Checkpoints collect mechanically: issue/revision/contract-hash,
workspace, branch, base/head commits, changed files, commits since the
previous checkpoint, pending blockers, child summaries, specialist refs,
pending asks, external bindings, cursor. Only
issueId/revision/contractHash/collectedAt are required; the rest is
populated where available.

## Manual metadata

`--refs` binds explicit references (receipts, commits, PRs, external
bindings) to an entry. Semantic text stays bounded (MCP appends cap the
summary at 2000 chars).

## Coordinator methodology

Periodically inspect children, claims, pending asks, new results,
blockers, provenance, release gates. Journal only material root-level
state: no giant rewritten root description, no child transcript
duplication.

## Ordinary worker methodology

Claim → work → journal findings/decisions as they happen → checkpoint at
durable boundaries → handoff entry → release/retain the claim. Resume from
the capsule and `sb journal since`, never from compacted chat.

## Specialist results

Automatic publication on Specialist completion: result content lands as
Journal entries (finding/milestone/handoff by shape, never a guessed
stronger type), bound to the activation/session with receipts. Result size
stays bounded — references and projections, never transcripts.

## Review / validator results

Reviewers consume findings/decisions and the provenance trace; they record
verdicts as entries and attest or block without redefining kind meanings.
Closure requires SUCCESS satisfied, VALIDATION complete, OUTPUT present,
and provenance sufficient.

## Checkpointing

See the `checkpoint` kind above. Rule: mechanical checkpoint first at
every durable boundary (session end, compaction, handoff, pre-mutation).
A session that would otherwise leave none writes a mechanical checkpoint
on exit.

## Compaction

The `compaction` kind marks the boundary; the mechanical row survives and
the host default proceeds on semantic failure. Post-compaction work
restarts from `sb issue resume`, never from the compacted transcript.

## Handoff

A bounded entry: blockers, pending work, provenance refs, and the resume
cursor. The receiver runs `sb issue resume <ref>` then `sb journal since
<ref> <cursor>`.

## Root / child aggregation

Root epics aggregate children by reference (child checkpoint refs +
projections), never by transcript duplication. `sb journal since` between
checkpoints shows only what changed.

## External comments

Inbound external comments (provider, scope, remoteId, URL) bind to
entries as external bindings. They are evidence, not authority.

## Notes vs findings

`note` is an ordinary annotation; `finding` is a material fact the next
worker relies on. When in doubt, `finding` for anything that changes what
the next session does, `note` for the rest. Never journal every shell
command.

## Decisions vs Issue revisions

A `decision` entry records an architectural choice + reason. If the choice
changes authorized work, execution pauses: repair through planning (new
Issue revision + fresh attestation). The entry never authorizes the
change; the revision does. Never smuggle new scope into a dispatch
prompt — `requestedScope` may only narrow contract SCOPE.

## Blockers

`blocker` entries name the external dependency. Current blockers are
queryable per Issue; no incompatible blocker may remain at closure.

## Result size discipline

Bounded entries: summaries and refs, never transcripts. `sb journal show`
returns full bodies; `sb journal since` stays compact.

## Querying

```bash
sb journal show <ref> [--kind <k>] [--limit <n>]  # full bodies, newest last
sb journal since <ref> <cursor>                   # compact delta after cursor (0 reads all)
sb journal render <ref> [--sequence <n>]          # render latest (or selected) checkpoint as text
```

Useful service-level queries the model supports: results for an Issue,
latest result, decisions, current blockers, sessions touching an Issue,
Issues touched by a session, activations, closures lacking provenance,
results lacking receipts.

## Resume integration

`sb issue resume <ref>` builds the bounded capsule (contract, checkpoint,
deltas, blockers, claim, provenance). The capsule is derived, never a
source of truth. Never dump the full history; `since` deltas compose with
the latest checkpoint.

## Provenance links

Entries bind to execution bindings, receipts, commits, PRs, and closures
via `--refs` and the provenance service. Closure → result/receipt
tracing answers what the work produced: see
[`provenance.md`](./provenance.md).

## Retention

Journal entries are append-only and survive closure — continuity stays
readable after the Issue is done. Compaction marks boundaries; it never
deletes history.

## Historical Beads notes

Imported Beads content maps conservatively: ordinary notes → `note`,
known Specialist results → result-pattern entries where deterministic,
known handoffs → `handoff` where deterministic, ambiguous notes → `note`.
Legacy Beads IDs, timestamps, authors, and `source=beads` are preserved;
a stronger semantic type is never guessed.
