# board-audit Beads round-trip

`board-audit-roundtrip.py` is the deterministic inverse side of structured board-audit export. It lets an exported work package be edited as desired state, reconciled against current local Beads/Dolt, compiled to native Beads mutations, applied and verified.

Beads/Dolt remains authoritative. GitHub transport artifacts are snapshots and desired-state proposals, not a second database.

## Normal workflow

Users normally do not invoke the low-level round-trip commands directly. The supported happy path is:

```bash
board-audit handoff xtrm-123
# GitHub-connected ChatGPT/human edits desired_issues/new_comments
board-audit reconcile xtrm-123
board-audit reconcile xtrm-123 --execute
```

`board-audit handoff` performs export, prepare, indexing, commit and push through an isolated Beads-managed worktree. `board-audit reconcile` performs fetch, validation, fresh three-way diff and apply dry-run. `--execute` is the explicit mutation boundary.

The caller's current checkout is never switched.

## GitHub transport model

User-visible interchange state lives under:

```text
.xtrm/board-audit/
```

The stable remote branch for a root is:

```text
board-audit/<bead-id>
```

The stable lookup surface is:

```text
.xtrm/board-audit/index.json
```

Schema: `xtrm.board-audit.index.v1`.

Normal GitHub-connected consumers resolve the current editable artifact through the index rather than searching timestamped export directories.

Repeat handoffs are intentionally fresh from the current remote default branch. The handoff implementation:

```text
fetch origin
→ record exact current transport-branch SHA if present
→ stage from current origin/HEAD (normally origin/main)
→ restore only prior .xtrm/board-audit/** artifacts
→ generate the new export/editable/index
→ rewrite board-audit/<id> with exact --force-with-lease=<ref>:<observed-sha>
```

This keeps the transport branch artifact-only and prevents stale code history from accumulating. The exact lease prevents overwriting a concurrent remote edit that landed after fetch.

First-time handoffs use a normal push.

## PR-checkpoint read projection

`board-audit pr-checkpoint <PR>` publishes a per-Bead read projection bound to an exact remote PR head on transport branch `board-audit/pr-<number>`. It is a versioned evidence/read surface, not a mutation path: nothing compiles from it and it is never input to `reconcile`. Only the existing round-trip artifact — `desired_issues` plus `new_comments` — compiles to Beads mutations, and only through local `reconcile` followed by explicit `reconcile --execute`.

```text
.xtrm/board-audit/
├── index.json                    # index.v1 + open_issues + pr_checkpoints + packages
├── handoffs/pr-<n>.json          # pr-handoff.v1 (exact PR-head binding)
├── snapshots/<snapshot-id>/      # read projection (per-Bead issues, roots, manifest)
└── exports/export-<ts>/          # bounded work-package handoff (existing exporter)
    ├── manifest.json
    ├── raw-beads.jsonl           # same single acquisition as the snapshot
    └── work-packages/
        ├── <root>__<title>.json          # work-package.v1 (issues.<id>.source)
        └── <root>__<title>.editable.json # roundtrip.v1 prepared desired state
```

The PR transport branch therefore carries the same bounded work-package handoff
and prepared editable artifacts that the `handoff` flow publishes (derived from
the same canonical acquisition). The standard round trip — Web edits the
editable, then local `reconcile` and explicit `reconcile --execute` — resolves
against a PR checkpoint transport branch unchanged; the per-Bead projection
under `snapshots/` remains read-only evidence.

## Upstream Beads contract used

`bd import` is an incremental JSONL upsert counterpart to `bd export`: new issues are created and existing issues are updated. It accepts issue rows plus relational labels/dependencies/comments and provides dry-run/stale guards.

`--allow-stale` is an explicit recovery escape hatch in Beads; board-audit never generates it automatically.

Import is used only for planning/content row changes and new issue creation. Mutations that require stronger native semantics are either compiled to native `bd` commands or rejected by round-trip v1.

Historical comment objects are never editor-controlled. Proposed comments are represented separately and compile to:

```bash
bd comments add <id> "<text>"
```

so Beads assigns author/time provenance.

## Exported and prepared artifacts

A structured export begins from one canonical acquisition:

```bash
bd export --all
```

and produces:

```text
.xtrm/board-audit/exports/export-YYYYMMDDTHHMMSS/
├── raw-beads.jsonl
├── manifest.json
└── work-packages/
    └── <root>__<title>.json
```

The package contains immutable source records under:

```text
issues.<id>.source
```

Low-level prepare:

```bash
board-audit-roundtrip prepare package.json
```

adds:

```text
roundtrip
  schema_version
  prepared_at
  base_package_sha256
  base_record_sha256
  edit_contract

desired_issues
  <id> -> desired issue state

new_comments
  <id> -> ["comment text", ...]
```

Only `desired_issues` and `new_comments` are editable. `issues.<id>.source` is immutable base evidence and is hash-checked before reconciliation.

## Editable fields

For existing selected beads, round-trip v1 permits planning/content edits to:

```text
title
description
design
acceptance_criteria
notes
spec_id
priority
issue_type
estimated_minutes
external_ref
metadata
labels
dependencies / deps / relations
```

Existing lifecycle/authority/provenance state remains read-only, including status, assignment/owner, lease/heartbeat, scheduling, timestamps, storage/persistence, compaction and gate/event fields.

Historical comments are read-only.

A new desired issue may use an explicit ID and planning/content fields. Lifecycle is compiler-owned; current defaults are:

```text
status=open
priority=2
issue_type=task
```

The editor does not directly control new-issue status in round-trip v1.

## Three-way reconciliation

Every validation/apply compares:

```text
base     = immutable issues.<id>.source from the original export
current  = fresh local bd export --all
desired  = desired_issues/new_comments from the edited artifact
```

Disjoint concurrent changes survive. If current and desired changed the same ordinary field differently, reconciliation fails closed.

Labels use set deltas, metadata uses per-key reconciliation, and dependencies use typed `(source, target, type)` edge deltas.

Dependency targets outside the package must resolve on the current board or be introduced by the same desired package.

`new_comments` are separate append intents and do not force an otherwise unchanged issue row through import.

## Low-level validation and diff

Edit-contract validation only:

```bash
board-audit-roundtrip validate package.editable.json --offline
```

Validate against current Beads:

```bash
board-audit-roundtrip validate package.editable.json
```

Show reconciliation:

```bash
board-audit-roundtrip diff package.editable.json
```

For deterministic tests/offline tooling:

```bash
--current-jsonl path/to/bd-export.jsonl
```

may replace live acquisition.

## Compile

```bash
board-audit-roundtrip compile-import package.editable.json
# alias
board-audit-roundtrip compile-apply package.editable.json
```

Generated output:

```text
beads-import.jsonl
changes.json
apply-plan.json
apply.sh
```

`beads-import.jsonl` contains only issue rows that require create/update. A comment-only proposal can therefore produce an empty issue JSONL plus a native comment command.

Exact removals are compiled separately because Beads import merges auxiliary records. Label removals use `bd update --remove-label`; dependency removals use `bd dep remove` and required relation types are restored as needed; comments use `bd comments add`.

## Apply

Dry-run:

```bash
board-audit-roundtrip apply package.editable.json
```

Execute:

```bash
board-audit-roundtrip apply package.editable.json --execute
```

The guarded sequence is:

```text
fresh bd export --all
→ validate immutable source hashes and editable-field contract
→ reconcile base/current/desired
→ reject conflicts/missing targets
→ compile issue JSONL + native post-import mutations
→ bd import --dry-run --json when issue rows exist
→ stop unless --execute
→ capture bd dep cycles --json baseline
→ real bd import --json
→ dependency removals/rewires + new comments
→ capture cycles again
→ reject newly introduced dependency cycles
→ fresh bd export --all
→ verify user-intended delta
```

The compiler never passes `--allow-stale`. Beads' own stale/timestamp guard remains a second race barrier around issue-row import.

Executed high-level apply additionally marks the transport index entry `applied`, records `applied_at`, and pushes that transport metadata only after post-apply verification succeeds.

## Dry-run output caveat for Beads 1.1.0

The Beads 1.1.0 build used during the first live round-trip reports `created = len(issue rows)` in JSON dry-run output rather than classifying create versus update. Therefore a dry-run result such as:

```json
{"created": 5, "dry_run": true}
```

can mean five rows will be upserted, not five new issue IDs will be created. Real import distinguishes created and updated outcomes.

Board-audit's reconciliation output is the authoritative pre-apply semantic delta for existing-versus-new classification.

## Verification semantics

Independent low-level verification:

```bash
board-audit-roundtrip verify package.editable.json
```

Verification checks the desired delta rather than requiring unrelated concurrent fields to equal the old export. Metadata checks only user-modified keys; labels/dependencies use set/edge deltas; proposed comments are verified by text-count increase while authorship/time remain Beads-owned.

## Exit semantics

```text
0  valid / safe / compiled / verified
2  invalid artifact, source tampering, unsupported mutation, command failure
3  three-way conflict
4  post-apply verification failure or newly introduced dependency cycle
```

## Live end-to-end validation

The complete high-level flow has been exercised on a real local Beads/Dolt board with root `xtrm-2zd`:

```text
Beads/Dolt
→ handoff
→ remote transport/index
→ ChatGPT desired-state edit
→ reconcile with no conflicts
→ dry-run
→ execute
→ four existing issue updates
→ one new child issue
→ dependency rewiring
→ native comment append
→ post-apply verification
→ index state applied
```

The trial validated the full GitHub-backed round-trip and exposed the need for fresh-from-main transport branches; the current transport policy includes that remediation and exact lease protection.

## Safety boundary

Round-trip v1 does not treat omission as deletion. It does not permit existing lifecycle, assignment, ownership, scheduling, lease, storage-plane, compaction or event/gate mutation. Historical comments are immutable. Context-only ancestors are read-only by default. `--allow-stale` is never generated.

The issue import plus native post-import mutation sequence is not claimed to be one database transaction. A concurrent write in the post-import window can cause final verification to fail; failure means reconcile again, not silently accept divergence.

Beads/Dolt disaster recovery remains outside this feature. This is issue/work-package interchange and guarded mutation, not backup restoration.

## Future protected automation

The same contract can later be used by an authorized runner:

```text
export + prepare
→ versioned transport artifact
→ human/model desired-state proposal
→ non-mutative validate/diff
→ protected apply
→ post-apply export/verification
```

If authoritative Beads state is workstation/VPS-local, the apply stage must run where that database is reachable. A fresh GitHub-hosted checkout must not be treated as authoritative Beads state.
