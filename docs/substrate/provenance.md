# Substrate provenance — operator reference

Covers ADR §69. Provenance is verifiable execution → artifact lineage:
what was authorized, what ran, what it produced, and why the Issue
reached its terminal state. Release-critical: closure requires
provenance sufficient to explain the terminal state.

## Forward graph

```text
Issue
→ ExecutionBinding
→ participant/session
→ result
→ receipt
→ commit/PR/artifact
→ closure
```

Record it:

```bash
sb provenance dispatch GATE-1 --session sess_1 --activation act_1
# ... work happens, receipts bind commits and artifacts ...
sb provenance trace GATE-1
```

`dispatch` binds an execution (workspace, participant, activation,
attempt, session, base commit, claim) to the Issue revision. Receipts
then bind what that execution produced: commits, PRs, artifacts. The
trace renders the whole spine: bindings, receipts with artifacts,
attestation, claims, checkpoints, commits, PRs, closure revision.

## Reverse graphs

Answer "what produced this" from any end:

```bash
sb provenance trace GATE-1        # Issue -> executions, results, PRs
sb provenance commit <40-char-sha>  # commit -> receipt -> Issue
sb provenance receipt <id>          # receipt -> Issue + artifacts
sb provenance pr <provider-ref>     # PR -> Issue
```

Conceptually:

```text
commit → receipt → Issue
session → Issues touched
activation → Issue
Issue → executions
Issue → results
Issue → PRs
closure → result/receipt
```

Session-centric questions ("what did this xt session touch?",
"what did activation act_123 produce?") are answered from the same spine;
dedicated `provenance session|activation` surfaces may follow without
changing the model.

## Commands

```bash
sb provenance dispatch <ref> [--workspace/--participant/--activation/--attempt/--session/--base-commit/--claim-id <v>]
sb provenance trace <ref>
sb provenance commit <40-char-sha>
sb provenance receipt <id>
sb provenance pr <provider-ref>
sb provenance bundle <ref> [--repo-root <dir>]
```

`bundle` assembles the portable evidence set for an Issue. Full flag
reference: [`cli.md`](./cli.md).

## Git relationship

Commits bind to receipts post-hoc: the commit check nudges (never blocks)
when Issue/revision/contract-hash/claim/binding context is missing, and
the post-commit SHA bind recovers a receipt-less commit. A commit alone
never closes an Issue — closure needs the reasoned terminal state plus
sufficient provenance.

## Closure and failure history

Closure is first-class: why and how an Issue became terminal, with the
close reason durable and the closure revision recorded
(`closureRevision`). Reopen returns the Issue to open; cancellation is a
terminal state with its own reason; failure history stays queryable
(closures lacking provenance and results lacking receipts are first-class
queries, not silent gaps).

> The normative closure-outcome enum lives in `src/domain/closure.ts`
> (owner C1): `completed|superseded|duplicate|wont_fix|invalid|cancelled|abandoned`.
> It is distinct from lifecycle state (`open|deferred|done|cancelled|archived`)
> and from the attestation `ready|reject` outcome in `src/domain/readiness.ts`,
> which authorizes a revision — it is not closure. The canonical close is
> `sb issue close <ref> --outcome <o> --reason <r>`; it writes an immutable
> Closure row (migration 011) and rests on `done` (`cancelled` for the
> cancelled outcome).
