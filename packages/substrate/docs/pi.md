---
status: current
owner: substrate
source_of_truth_for:
  - Pi-facing Substrate integration reference
last_verified_against: 3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f
---

# Pi integration

Source: `integrations/pi/extension.ts` + `handlers.ts`.

## Live tools

```text
substrate_issue_get
substrate_issue_list
substrate_issue_claim
substrate_issue_update
substrate_issue_close
substrate_journal_append
substrate_journal_read
substrate_resume_capsule
substrate_provenance
```

| Tool (Pi: `substrate_` prefix) | Purpose |
|---|---|
| `issue_get {ref}` | Contract, readiness, claim, attestation |
| `issue_list {project?, status?, query?, kind?, limit?, claimedBy?}` | Replaces `issue_list`/`issue_ready`/`issue_search`; `claimedBy` (holder or `me`) lists held issues with the latest handoff |
| `issue_claim {ref, op?, holder?, ttlMs?, activationId?}` | `op` claim\|renew\|release; `holder` defaults to `SUBSTRATE_HOLDER`, else the xt worktree name |
| `issue_update {ref, title?, priority?, contract?}` | Metadata or revision-bearing change |
| `issue_close {ref, outcome, reason, *Refs?, participant?}` | Warns when `completed` cites no refs; `participant` defaults to the resolved identity |
| `journal_append {ref, kind, summary?, next?, details?, result?}` | All writable kinds; `checkpoint` takes the mechanical path; Pi entries now carry the summary |
| `journal_read {ref, mode, kind?, cursor?, limit?}` | `mode` latest\|since\|timeline\|show, full bodies |
| `resume_capsule {ref}` | Derived continuation capsule |
| `provenance {ref? \| sessionId? \| activationId?}` | Exactly one selector |

These are the same nine tools as the Claude MCP server (shared definitions in
`integrations/tool-surface.ts`, behaviour in `integrations/tool-core.ts`).
`substrate_provenance` with `ref` delegates to `ProvenanceService.trace()`:
execution bindings, WorkReceipts with artifacts/context, checkpoints,
commits/PRs, external bindings and closure revision.

Mutating tools return structured success/no-op/warning feedback.

## Session lifecycle

A successful claim binds the Pi session. `SUBSTRATE_ISSUE_REF` is the canonical
fresh-process binding; `SUBSTRATE_ISSUE` is the compatibility alias.
`/substrate-resume` prints the derived Resume Capsule.

`session_before_compact` writes a mechanical checkpoint first and may enrich it
through a secondary model; failure falls back to Pi's normal compaction while
preserving any committed checkpoint.

The `tool_call` edit/write gate applies live per-Issue claim authority for bound
sessions; it provides no cross-Issue workspace exclusion. Unknown/unreadable gate state fails open rather than bricking an
operator session; known conflicting authority fails closed.


## Compaction usage

When the secondary summarizer reports token/cost usage, the integration returns
it in Pi's compaction result. Usage is not stored inside the Journal semantic
checkpoint schema. If a summarizer runs without reporting usage, a best-effort
Journal note records the absence; no usage is estimated. Failure to write that
note does not block compaction. Pi computes its own post-compaction token
estimate. Mechanical-first durability and fallback to normal compaction remain
unchanged.

Journal and checkpoint adapters preserve trusted execution-envelope facets and
fill unstated holder/activation from ambient identity. See
[Integrations](integrations.md#identity-propagation).

Sources: [`extension.ts`](../integrations/pi/extension.ts),
[`handlers.ts`](../integrations/pi/handlers.ts).
