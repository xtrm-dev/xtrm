---
status: current
owner: substrate
source_of_truth_for:
  - Claude plugin and MCP integration reference
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# Claude integration

The packaged `substrate` Claude Code plugin starts the MCP server through
`${CLAUDE_PLUGIN_ROOT}/scripts/substrate-mcp.mjs`; it ships no repo-local DB
default.

## Live MCP tools

```text
issue_get
issue_list
issue_ready
issue_claim
issue_update
issue_note
issue_close
journal_append
journal_checkpoint
journal_show
journal_query
provenance_trace
provenance_session
provenance_activation
resume_capsule
```

`issue_claim` is `claim|release`; `journal_query` is
`since|latest|timeline`. Tool descriptions are normative instruction surfaces
and are exported from the same `TOOL_DEFS` registration table.

Repository project resolution is explicit project → `SUBSTRATE_PROJECT` →
repository binding/checkout alias → fail closed with `sb init` guidance. There
is no single-project default.

## Hooks

```text
PreCompact              mechanical checkpoint first
PostCompact             compaction occurrence
SessionStart(compact)   Resume Capsule head as additionalContext
```

Other packaged gates protect edit/write authority, provenance commit binding and
stop-time continuity. Provider feedback is presentation over the typed service
result, not another state machine.
