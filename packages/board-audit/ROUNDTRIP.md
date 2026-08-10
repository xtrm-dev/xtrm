# board-audit Beads round-trip

`board-audit-roundtrip.py` is the inverse side of the structured `board-audit --export` workflow. It lets an exported work package be handed to a human or model, edited as desired state, reconciled against the live local Beads board, compiled back to native Beads JSONL plus guarded native mutations, applied, and verified.

Beads remains authoritative. A work-package file is an edit/reconciliation artifact, not a database.

## Repository-local interchange

`board-audit` writes user-visible artifacts under the repository-local `.xtrm/board-audit/` tree by default. This is deliberate: a selected work package can be committed and pushed on a branch, after which a GitHub-connected ChatGPT session can read exactly the same snapshot without access to the operator's local filesystem.

The tool never commits or pushes automatically. A normal handoff is:

```bash
git switch -c board-audit/xtrm-123
board-audit --export --epic xtrm-123
board-audit-roundtrip prepare \
  .xtrm/board-audit/exports/export-.../work-packages/xtrm-123__title.json
git add .xtrm/board-audit/
git commit -m "chore(board-audit): prepare xtrm-123 handoff"
git push -u origin HEAD
```

The exact artifact can then be located/read through GitHub. `--output-dir` or `BOARD_AUDIT_OUTDIR` may override the artifact root for tests or intentionally non-versioned runs.

## Upstream Beads contract used

Current Beads `bd import` is an incremental JSONL upsert counterpart to `bd export`. It accepts issue rows plus relational labels, dependencies and comments, provides `--dry-run`, and has stale/timestamp guards. `--allow-stale` is an explicit recovery escape hatch; board-audit never generates it automatically.

Import is intentionally a migration/recovery surface, not the normal claim/lifecycle API. Round-trip v1 therefore uses import only for planning/content row changes and creation, while operations that need stronger native semantics are either compiled to native `bd` commands or fenced out completely.

In particular, historical comment objects are never editor-controlled. Proposed new comments are represented separately and compiled to `bd comments add`, so Beads—not an uploaded JSON artifact—assigns comment authorship and creation time.

## Prepared edit artifact

An exported package contains immutable source records:

```text
issues.<id>.source
```

Prepare it:

```bash
board-audit-roundtrip prepare \
  .xtrm/board-audit/exports/export-.../work-packages/xtrm-123__title.json
```

The resulting `.editable.json` remains beside the work package inside the repository and keeps the complete source package while adding:

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

Only `desired_issues` and `new_comments` are editable. `issues.<id>.source` is immutable base evidence and is hash-checked before compilation.

Selected records are copied to `desired_issues`; context-only ancestors stay read-only unless `--allow-context-edit` is explicitly supplied. Existing selected issues may not be deleted by omission from `desired_issues`.

For an existing bead, round-trip v1 allows edits to this planning/content surface:

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

The lossless source still carries everything else. Existing `status`, `assignee`, `owner`, lease/heartbeat state, timestamps/provenance, scheduling controls, persistence/storage-plane state, compaction data, gate/event fields and comparable operational state are rejected if changed in `desired_issues`. Historical `comments` are also read-only.

New comments go only in `new_comments`, for example:

```json
{
  "new_comments": {
    "xtrm-123": [
      "Reconciled acceptance criteria against the current implementation."
    ]
  }
}
```

They compile to:

```bash
bd comments add xtrm-123 "Reconciled acceptance criteria against the current implementation."
```

This preserves local Beads provenance. Existing comment objects cannot be edited, reordered, removed, or forged through import.

A new desired issue may be represented with an explicit ID and planning/content fields, but lifecycle state remains compiler-owned. If omitted, the compiler sets conservative creation defaults:

```text
status=open
priority=2
issue_type=task
```

The editor cannot set `status` directly in round-trip v1. Native-ID generation/mapping and guarded lifecycle transitions are candidates for a later compiler rather than being hidden inside this first round-trip format.

## Three-way reconciliation

Before compilation or apply, the tool compares:

```text
base     = issues.<id>.source from the original export
desired  = desired_issues from the edited artifact
current  = fresh local bd export --all
```

Disjoint concurrent changes are retained:

```text
base:     description=A, priority=P2
desired:  description=B, priority=P2
current:  description=A, priority=P1
result:   description=B, priority=P1
```

If current and desired changed the same ordinary field differently, reconciliation stops with a conflict rather than overwriting either side.

Labels are reconciled as set deltas, metadata per top-level key, and dependencies as typed `(source, target, type)` graph deltas. A dependency target outside the package is accepted only if it exists on the current board or is being introduced by the same desired package.

`new_comments` are append intents rather than issue-row deltas and therefore do not force an otherwise unchanged issue through `bd import`.

## Validate and diff

Edit-contract validation only:

```bash
board-audit-roundtrip validate package.editable.json --offline
```

Validate against fresh local Beads:

```bash
board-audit-roundtrip validate package.editable.json
```

Show base/current/desired reconciliation:

```bash
board-audit-roundtrip diff package.editable.json
```

For deterministic tests or offline tooling, commands that need current state accept:

```bash
--current-jsonl path/to/bd-export.jsonl
```

## Compile back to Beads

```bash
board-audit-roundtrip compile-import package.editable.json
```

`compile-apply` is currently an alias:

```bash
board-audit-roundtrip compile-apply package.editable.json
```

The generated directory is created beside the editable package, and therefore also remains inside the repository-local interchange tree when the default export layout is used:

```text
beads-import.jsonl
changes.json
apply-plan.json
apply.sh
```

`beads-import.jsonl` contains only issue rows that actually require an import/create/update. A comment-only proposal therefore produces an empty JSONL file and a native comment command in the apply plan.

`changes.json` records the reconciliation result. `apply-plan.json` records source/current digests, changed IDs, actual import IDs and explicit post-import commands. `apply.sh` is dry-run-only unless passed `--execute`.

Beads import has merge semantics for auxiliary data, so exact removals need native follow-up commands. Label removals use `bd update --remove-label`. Dependency removals use `bd dep remove`; because that command is pair-scoped, the compiler restores any relation types on the same source/target pair that should remain. Comment additions use `bd comments add`.

## Direct apply

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
-> validate immutable base + editable-field contract
-> three-way reconcile base/current/desired
-> reject conflicts and missing relation targets
-> compile native Beads issue JSONL + native mutation commands
-> bd import --dry-run --json when issue rows exist
-> stop unless --execute
-> capture bd dep cycles --json baseline
-> bd import --json when issue rows exist
-> native removals/rewires/comment additions
-> capture bd dep cycles --json again
-> fail if the change introduced a new scheduling cycle
-> fresh bd export --all
-> verify the user-intended delta
```

`bd dep cycles` itself reports cycles with a successful command exit, so the round-trip tool compares the JSON reports rather than treating exit code zero as "no cycles". Pre-existing cycles are not attributed to the package; newly introduced cycles fail verification.

The compiler never passes `--allow-stale`. Beads' own stale/tie guard remains a second race barrier around imported issue rows. Post-apply verification is mandatory for executed changes.

## Verification semantics

Independent verification is available with:

```bash
board-audit-roundtrip verify package.editable.json
```

Verification checks the user's intended delta rather than requiring unrelated concurrent fields to equal the old export. Metadata is checked only for keys the editor changed; label/dependency checks use set/edge deltas. Proposed comments are verified by text-count increase relative to the exported base, while author/time remain Beads-owned.

## Exit semantics

```text
0  valid / safe / compiled / verified
2  invalid artifact, source tampering, unsupported mutation, command failure
3  three-way conflict
4  post-apply verification failure or newly introduced dependency cycle
```

## ChatGPT workflow

The intended practical flow is now GitHub-backed rather than `/tmp`-backed:

```text
local repo on dedicated branch
-> board-audit --export --epic <id>
-> board-audit-roundtrip prepare <repo-local work-package>
-> git add/commit/push .xtrm/board-audit/... artifact
-> ChatGPT reads the exact artifact through GitHub
-> ChatGPT edits desired_issues and/or new_comments only
-> proposed artifact is committed/pushed back or saved locally
-> validate + diff locally
-> compile/apply
-> fresh export + verification
```

This makes ChatGPT aware of the complete Beads work package while local Beads remains the authority for mutation and provenance.

## Safety boundaries in v1

Round-trip v1 does not treat issue omission as deletion. It does not permit existing lifecycle, assignment, ownership, scheduling, lease, storage-plane, compaction or event/gate mutation. Historical comments are immutable. Context-only ancestors are read-only by default. `--allow-stale` is never generated.

The import plus exact-removal/native-command sequence is not claimed to be one database transaction. A concurrent write in the small post-import window can cause final verification to fail; failure means reconcile again, not silently accept divergence.

Beads/Dolt backup and history restoration remain outside this feature. This is issue/work-package interchange and mutation, not disaster recovery.

## Future GitHub Actions automation

After representative local trials prove the edit contract and concurrency behavior, the natural automation is:

```text
workflow_dispatch / controlled request
-> export + prepare on an authorized runner into .xtrm/board-audit/
-> commit/push or PR the versioned editable work package
-> ChatGPT/human returns proposed desired artifact
-> non-mutative validate/diff workflow
-> PR containing desired artifact + generated changes/apply plan
-> protected apply job on an authorized runner
-> post-apply export + verification artifact
```

The current implementation intentionally adds only non-mutative CI for syntax/unit tests. It does not automate Beads mutation.

If the authoritative Beads database is workstation/VPS-local, the eventual apply stage must run on a constrained self-hosted runner that can reach that authoritative database. A fresh GitHub-hosted checkout must not be assumed to contain authoritative local Beads state.
