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

Every write confirmation names the issue ref, what was written (journal kind
and sequence), the actor, and a `next:` hint:

```text
✓ Recorded finding on XTRM-5
  finding · seq 3 · by wed-coord
  next: sb journal timeline XTRM-5
```

- create: reports the readiness state and reasons when the issue is draft
  (wrong `contract` nesting is rejected; plain-string `validation`/`output`
  entries produce a shape warning) and points at `sb issue validate <ref>` or
  the exact `sb issue attest <ref> --outcome ready --policy default --attested-by <you>`.
- attest: shows the resulting readiness; `!` when a `ready` attestation leaves
  the issue draft, with the reasons.
- claim: shows the ISO expiry and `sb issue release`. A repeat claim by the live
  holder prints `already held by you; expires … — use sb issue renew <ref> --ttl-ms <ms> to extend`.
  `sb issue renew <ref> [--holder h] [--ttl-ms ms]` extends the lease:
  `✓ Renewed XTRM-5 · expires 2026-10-22T14:03:00Z (in 15 min)`.
- journal result: `next: sb issue close <ref> --outcome completed --reason … --result <id>`.
- close: `!` warning when `--outcome completed` carries no `--result`,
  `--validation`, `--receipt` or `--artifact`; bare `close`/`cancel`/`reopen` warn that no
  Closure row is recorded.
- Null actor: the confirmation shows `(none recorded)` and warns
  `export SUBSTRATE_HOLDER=<name>`.

`--json` output is backward compatible: fields are only added (`ref`,
`warnings: string[]`, `readinessState`, `reasons`, `expiresAtIso`, `alreadyHeld`).

### Rejected input

- Extra positional text after the ref fails (`sb journal append <ref> --kind note "text"`
  names `--semantic '{"summary":"…"}'`); the same applies to every ref-taking verb.
- A value flag with no value fails with `--X requires a value`. A flag and its
  value glued into one argv token (`"--parent XTRM-1"`) is reported with the hint
  that they must be separate arguments.
- A journal entry with no semantic, mechanical or result payload is rejected for
  `note|finding|decision|blocker|milestone|handoff`, in the CLI and the service.
  A summary under 8 words, or `done|wip|ok|todo|tbd|...|-`, is accepted with a
  warning and the template `what changed / evidence / next step`.
- A `--contract`/`--semantic`/`--result` argument that is neither inline JSON nor
  an existing file reports `file not found`, not invalid JSON.

### Journal text limit (XTRM-678)

- Summary text (`semantic.summary`) is limited to 16,000 characters
  (`SEMANTIC_SUMMARY_MAX`, `src/domain/journal.ts`). The CLI, the MCP server and
  the Pi extension apply the same limit. A longer summary fails with its size and
  the limit, and no row is written. No surface cuts supplied text.
- Long text: `sb journal append <ref> --kind handoff --summary-file <path|->`
  (`-` reads stdin; other `--semantic` fields still apply), `sb issue note --file`,
  or `summaryFile` on the `journal_append` tool.
- Host-generated text that must fit (PostCompact `compact_summary`, imported
  provider comments) is stored with an explicit `[cut: N more chars of … not stored]`
  marker. Beads history above the limit is imported as `[part i/n]` entries.
- Text views end a cut preview with `… (+N chars, …)`. `--json` always carries the
  full stored text. `result.summary` keeps its 4,000-character limit; the error
  now reports the received length.

### Errors name the remedy

Errors use human refs and ISO UTC times, never `iss_` ids or epoch milliseconds.
The machine prefix (`not-claimable:`, `claim-held:`, `already terminal:`,
`revision conflict`) is stable. `not-claimable` prints the exact
`sb issue attest …` command when attestation is missing and `sb issue validate <ref>`
otherwise; an unknown journal kind lists the valid kinds.

### Identity

`--holder` on `claim`/`renew`/`release` defaults to `SUBSTRATE_HOLDER`; the
command fails naming the variable when both are missing and warns on stderr
when `--holder` differs from it. `sb issue close` fills the participant from
`SUBSTRATE_HOLDER`.

### Doctrine topics

`sb help contract`, `sb help kinds` and `sb help identity` print the contract
JSON shape, the journal kinds with their `--semantic`/`--result` schemas, and
the holder / `SUBSTRATE_HOLDER` / participant model.

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

Quote tmux IDs so the shell does not expand `$2`. `provenance allocate` does
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
