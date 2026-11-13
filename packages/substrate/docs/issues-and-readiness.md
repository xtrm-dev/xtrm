---
status: current
owner: substrate
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# Issues and readiness

## Identity

Each Issue has:

1. immutable machine ID (`iss_...`),
2. immutable project-scoped human reference (`XTRM-227`),
3. derived hierarchical locator (`XTRM-184.2.3`) with historical aliases after
   reparenting.

All normal Issue-taking surfaces resolve those forms plus registered aliases.

## Contract and revision

Execution authority lives in the seven-field contract plus SCRUTINY. Title and
priority are metadata; contract/ownership/context/scrutiny changes are
revision-bearing. `expectedRevision` provides optimistic conflict protection.

### Contract shape normalisation

`validation` entries are objects `{"check": "…"}` and `output` entries are
objects `{"artifact": "…"}`. `sb issue create` and `sb issue edit` repair a
plain string entry to that shape before the revision is written, store the
normalised contract, and report the repair in one line
(`validation: 2 entries normalised to {check}`); `--json` carries the same facts
as `contractNormalised`. An entry that cannot be repaired unambiguously — an
object without the key, a number, an array, `null`, an empty string — is refused
with the field, the entry and the expected shape named. The repair happens in
the service write, so MCP, Pi and Beads-import callers get it too.

The rule is a write-path repair, never a migration: a contract pinned before it
existed keeps its stored bytes and its readiness verdict, and `sb issue validate`
still reports the read-side shape hint for such a contract.

## Readiness states

The durable lifecycle is separate from derived operational readiness. Human
views may show `ready`, `blocked` or `in_progress` without persisting those as
new lifecycle values.

A claim does not attest readiness. A READY unclaimed Issue can enter the
claim→binding flow; a claimed Issue is fenced by matching holder/activation.

## Relations

`parent_child` is structural. `blocks` affects readiness. Other relations such
as `relates_to`, `discovered_from`, `supersedes` and `duplicates` carry graph
meaning without becoming readiness blockers.
