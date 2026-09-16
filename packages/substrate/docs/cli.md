---
status: current
owner: substrate
source_of_truth_for:
  - human sb terminal behavior
last_verified_against: 4d83048bb86d5924b864278ff106640c6046e271
---

# `sb` CLI

The machine command engine and the human terminal projection are deliberately
separate. `cli/sb.ts` owns the stable command/JSON contract;
`cli/sb-ux.ts` owns TTY/plain presentation.

## Active board

Human `sb issue list` is an **active board** by default: terminal history is not
mixed into the normal work view. Hierarchy is preserved so Epic/child context is
visible.

```bash
sb issue list
sb issue list --status open,in_progress
sb issue list --status ready
sb issue list --status blocked
sb issue list --status deferred
sb issue list --status closed
sb issue list --all
sb issue list --flat
sb issue list --search provenance
```

Known status filters are `open`, `in_progress`, `ready`, `blocked`, `deferred`,
`done`, `cancelled`, `archived`, and `closed`. `in_progress`, `ready` and
`blocked` are derived views over claim/readiness state, not persisted lifecycle
values.

Filtering keeps ancestor context unless `--flat` is requested.

Human-only list filters combined with `--json` fail closed; the machine JSON
contract returns its unfiltered service/tree representation rather than silently
pretending the filter was applied.

## Rich `show`

```bash
sb issue show XTRM-123
```

TTY output uses sparse terminal chrome, terminal Markdown for the contract,
status/readiness/claim metadata, bounded recent Journal context, provenance and
Closure summaries. `NO_COLOR`, `TERM=dumb`, `--plain` and `--no-color` degrade to
plain text.

## Interactive browser

```bash
sb issue browse
sb issue browse --help
```

The read-first browser is TTY-only and uses the alternate screen. Navigation:
`↑↓`/`j k`, Enter preview expansion, `/` search, `f` active/all/closed filter,
`+/-` child expansion/collapse, `q` or Ctrl-C to leave. Terminal state is
restored on exit.

## Operation feedback

Mutating commands emit explicit post-operation acknowledgement:

```text
✓ success
○ no-op / idempotent repeat
! warning / degraded-but-durable result
✗ failure + actionable reason/remediation where known
```

Routine mutations do not add confirmation prompts merely for ceremony.
Destructive/batch flows may require confirmation separately. Pi and Claude
mutations use the same structured feedback vocabulary without making feedback a
second authority model.

## Help surfaces

Help is side-effect-free and is part of the product contract:

```bash
sb --help
sb help issue edit
sb issue list --help
sb issue show --help
sb issue close --help
sb issue browse --help
sb provenance --help
```

`edit` help teaches Issue-vs-Journal methodology; `close` names outcomes/reason
and evidence refs; list/browser help teaches the human-only filtering model.
