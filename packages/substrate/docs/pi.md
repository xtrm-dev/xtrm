---
status: current
owner: substrate
source_of_truth_for:
  - Pi-facing Substrate integration reference
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# Pi integration

Source: `integrations/pi/extension.ts` + `handlers.ts`.

## Live tools

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

All call typed services directly. `substrate_provenance_trace` delegates to the
canonical `ProvenanceService.trace()` and therefore includes execution bindings,
WorkReceipts with artifacts/context, checkpoints, commits/PRs, external bindings
and closure revision.

Mutating tools return structured success/no-op/warning feedback.

## Session lifecycle

A successful claim binds the Pi session. `SUBSTRATE_ISSUE_REF` is the canonical
fresh-process binding; `SUBSTRATE_ISSUE` is the compatibility alias.
`/substrate-resume` prints the derived Resume Capsule.

`session_before_compact` writes a mechanical checkpoint first and may enrich it
through a secondary model; failure falls back to Pi's normal compaction while
preserving any committed checkpoint.

The `tool_call` edit/write gate applies live claim/workspace authority for bound
sessions. Unknown/unreadable gate state fails open rather than bricking an
operator session; known conflicting authority fails closed.
