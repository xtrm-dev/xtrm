---
status: current
owner: substrate
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
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

`issue_ref` is the primary Specialist work vocabulary. Historical `bead_id`
exists only as a compatibility alias at boundaries that still accept it.

The older `sp` RPC/Supervisor/Beads job backend remains transitional until the
separate CLI-convergence programme proves its replacement. Do not duplicate
that legacy model into Substrate docs.
