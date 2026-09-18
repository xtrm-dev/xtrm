---
status: current
owner: substrate
last_verified_against: 3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f
---

# Specialists integration

Specialists and Substrate have different jobs:

```text
Substrate   = durable work authority
Specialists = scoped execution runtime
Pi          = model/session runtime
Git         = code/integration truth
```

Native dispatch consumes a READY Substrate Issue through the WorkItemStore
boundary. The activation binds exact Issue revision/hash and execution identity;
it does not get a second work record.

On meaningful settlement the host publishes a bounded result and WorkReceipt /
artifact provenance. Publication is runtime-owned and hardened for cross-process
exactly-once behavior; the Specialist does not have to remember to write its own
result note.

Publication passes the child Pi session id as the session scalar, and the
service validates it like any other write: a non-canonical value is refused
rather than stored. A host job identifier belongs in `runId`, never in the
session field.

`issue_ref` is the primary Specialist work vocabulary. Historical `bead_id`
exists only as a compatibility alias at boundaries that still accept it.

The older `sp` RPC/Supervisor/Beads job backend remains transitional until the
separate CLI-convergence programme proves its replacement. Do not duplicate
that legacy model into Substrate docs.


## Workspace exclusion

Substrate no longer exposes a workspace writer lease. Migration v12 removes
`workspace_leases`; no replacement Substrate exclusion API is implied.
Per-Issue claims continue to fence mutations. The Specialists activation layer
owns workspace exclusion, so a Substrate claim alone does not guarantee that
another Issue cannot write to the same worktree.
