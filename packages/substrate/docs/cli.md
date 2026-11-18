---
status: current
owner: substrate
source_of_truth_for:
  - human sb terminal behavior
last_verified_against: 3f3e3cbfbbd03de8fc0926599d6797f4b7eab79f
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

## Journal text limit (XTRM-678)

- Summary text (`semantic.summary`) is limited to 20,000 characters
  (`JOURNAL_SUMMARY_MAX`, `src/domain/journal.ts`). The CLI applies the limit on
  every one of its append paths (`journal append`, `issue note`, checkpoint
  enrichment); the Pi `substrate_journal_append` tool applies the same bound. A
  longer summary fails with its size and the limit, and no row is written:
  supplied text is never cut. The Claude MCP append path still cuts to 2,000
  characters with no marker; aligning it is step-12 work (XTRM-724 part B).
- Long text: `sb journal append <ref> --kind handoff --summary-file <path|->`
  (`-` reads stdin; other `--semantic` fields still apply). The file is read on
  the machine that runs the command: an absolute path, a path relative to the
  current directory and `-` all work, and in remote mode the bytes are uploaded,
  so a path that does not exist locally is refused locally.
- Host-generated text that must fit — imported provider comments — is stored with
  an explicit `[cut: N more chars of … not stored]` marker. Beads history above
  the limit is imported as `[part i/n]` entries.
- Text views end a cut preview with `… (+N chars, …)`; `--json` always carries the
  full stored text. `result.summary` keeps its 4,000-character limit and the error
  now reports the received length.

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

## Claim holder

`sb issue claim` and `sb issue release` take their holder from `--holder` when it
is given, and otherwise from `SUBSTRATE_HOLDER`, which the xt launcher already
exports for the session (`xt pi|claude|codex <name>`). Inside an xt session,

```bash
sb issue claim XTRM-123
```

is enough. Pass `--holder` only to claim or release on someone else's behalf;
releasing another holder's claim still requires it. With neither `--holder` nor
a non-empty `SUBSTRATE_HOLDER` the command fails closed with a message naming
both ways to supply the holder — there is no implicit unix-user holder. The
claim output names the holder it used and whether it came from the flag or the
environment: `issue claim` adds `holder` and `holderSource` (`"flag"` or `"env"`)
to its `data`, and a release answer carries `released` plus the resolved `holder`
and `holderSource`. The Claude MCP `issue_claim` tools and the Pi
`substrate_issue_claim` tool resolve the same way and report `holderSource` too.

`sb issue renew` extends a lease that is still live and resolves `--holder` by
the same rule. The expiry moves; the generation does not, so a renewal cannot
look like a re-claim:

```bash
sb issue renew XTRM-123 --ttl-ms 3600000
```

A lease that has already expired is not renewable — claim it again, which
records a new generation and is the honest signal that ownership lapsed.

A remotely forwarded `issue claim`, `issue renew` or `issue release` resolves on the client
before anything is sent: with neither the flag nor the client's
`SUBSTRATE_HOLDER` the client fails closed with the message above, otherwise the
explicit flag crosses as the flag or the client's `SUBSTRATE_HOLDER` crosses and
overrides the server's. The remote MCP server applies the same rule at launch —
it deletes any identity it inherited from the server's own environment before it
applies the caller's `--identity` — so a server-side `SUBSTRATE_HOLDER` cannot
decide a holder on either remote path.

## Session precedence

Journal `append`/`checkpoint` and provenance `dispatch` accept `--session`.
An explicit session wins over `XTRM_SESSION_ID`. On success, a canonical
mismatch emits a warning on stderr in both human and JSON modes; JSON stdout
remains unchanged. Equal IDs, including UUID case variants, produce no warning.
Invalid identity still fails at the service boundary.

```bash
sb journal checkpoint XTRM-123 --session '$2'
sb provenance dispatch XTRM-123 --participant coordinator --session '$2'
```

Quote tmux IDs so the shell does not expand `$2`. `provenance dispatch` also
accepts `--dispatcher-participant <holder>` and `--dispatcher-session <id>` to
record who dispatched the execution; they are never taken from
`XTRM_SESSION_ID` (see [Provenance and Closure](provenance-and-closure.md)).
`provenance allocate` does
not accept `--session`: it inherits the execution binding. Receipt allocation,
checkpoint links and commit binding are documented in
[Provenance and Closure](provenance-and-closure.md#allocate-and-link-a-receipt).

## One-way Beads import

```bash
sb import beads --file export.jsonl --project prj_example --dry-run --json
sb import beads --file export.jsonl --project prj_example --json
```

Review the dry-run report before import. The importer extracts recognized
contract sections from the description, including supported heading variants;
it reports unmapped headings rather than inventing contract meaning. Missing
required content remains a readiness gap, not a fabricated executable contract.

Usable source creation/update/closure timestamps are preserved. Contradictory
times are normalized and reported. For terminal time, the fallback order is
`closed_at` → `updated_at` → `created_at` → import time. Inspect
`timestampProvenance` in the report to distinguish preserved, normalized and
fallback values. The CLI also records imported Closure reasons and source
provenance. This is one-way migration, not dual-write or a lossless archive of
every Beads field; retain the source export.

Re-import is not the repair path for previously imported rows. See
[Troubleshooting](troubleshooting.md#previously-imported-beads-data).

Sources: [`sb.ts`](../cli/sb.ts),
[`Beads importer`](../src/compatibility/beads/import.ts).
