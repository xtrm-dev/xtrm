# board-audit Beads round-trip

`board-audit-roundtrip.py` is the inverse side of the structured `board-audit --export` workflow. It lets an exported work package be handed to a human or model, edited as desired state, reconciled against the live local Beads board, compiled back to native Beads JSONL/mutations, applied, and verified.

The design deliberately keeps Beads authoritative. A work-package file is an edit/reconciliation artifact, not a database.

## Upstream Beads contract used

Current Beads `bd import` is an incremental JSONL upsert counterpart to `bd export`. It accepts the issue schema emitted by `bd export`, including content fields such as `description`, `design`, `notes`, and `acceptance_criteria`, plus ownership, labels, dependencies, comments, metadata, scheduling fields, external references, and timestamps.

`bd import` provides `--dry-run`, JSON output, stale/timestamp protection, and an explicit `--allow-stale` restore escape hatch. board-audit never uses `--allow-stale` automatically.

Beads import merges/deduplicates auxiliary data such as relationships/comments rather than acting as an exact replacement primitive. For that reason the round-trip compiler emits both a JSONL upsert and explicit native cleanup mutations when user intent removes labels or dependency edges.

## Editing model

An exported package contains immutable source records:

```text
issues.<id>.source
```

Prepare it before editing:

```bash
python3 packages/board-audit/board-audit-roundtrip.py prepare \
  /tmp/board-audit-xtrm/export-.../work-packages/xtrm-123__title.json
```

This creates `xtrm-123__title.editable.json`. The prepared artifact keeps the original package intact and adds:

```text
roundtrip
  schema_version
  base_package_sha256
  base_record_sha256
  edit_contract

desired_issues
  <id> → desired native Beads record
```

Only `desired_issues` is editable. `issues.<id>.source` is immutable base evidence and is hash-checked before compilation.

Selected records are copied to `desired_issues`. Context-only closed ancestors remain read-only unless `--allow-context-edit` is supplied explicitly.

Existing selected issues may not be removed from `desired_issues`; closing or superseding them should be represented as Beads state, not as disappearance from the artifact. New desired issue IDs are allowed when they carry at least a title.

Existing provenance/timestamp fields such as `id`, `created_at`, `created_by`, and `updated_at` are not editor-controlled. The compiler preserves identity/provenance and stamps the outgoing update timestamp after reconciliation.

Existing comments are append-only. Editing, reordering, or deleting historical comments is rejected; new comments may be appended.

## Three-way reconciliation

Before a package can be compiled or applied, the tool compares three states:

```text
base     = issues.<id>.source from original export
desired  = desired_issues edited by human/model
current  = a fresh local `bd export --all`
```

The reconciler preserves disjoint concurrent changes. Example:

```text
base:     description=A, priority=P2
desired:  description=B, priority=P2
current:  description=A, priority=P1
result:   description=B, priority=P1
```

If both current and desired changed the same ordinary field to different values, compilation stops with a conflict instead of overwriting either side.

Labels are reconciled as set deltas so unrelated current additions survive. Metadata is reconciled per top-level key. Existing comments are immutable and independently appended comments are retained. Dependencies are reconciled as typed `(source, target, type)` relations.

A dependency target outside the package is valid only when it exists in the current board or is being created by the same desired package.

## Validate and diff

Schema/edit-contract validation only:

```bash
python3 packages/board-audit/board-audit-roundtrip.py validate package.editable.json --offline
```

Validate against a fresh local board:

```bash
python3 packages/board-audit/board-audit-roundtrip.py validate package.editable.json
```

Show the three-way reconciliation:

```bash
python3 packages/board-audit/board-audit-roundtrip.py diff package.editable.json
```

For tests/offline tooling, any command that needs current state accepts:

```bash
--current-jsonl path/to/bd-export.jsonl
```

## Compile back to Beads

```bash
python3 packages/board-audit/board-audit-roundtrip.py compile-import package.editable.json
```

`compile-apply` is an alias with the same current implementation:

```bash
python3 packages/board-audit/board-audit-roundtrip.py compile-apply package.editable.json
```

The default output directory is `<package>.roundtrip/` and contains:

```text
beads-import.jsonl
changes.json
apply-plan.json
apply.sh
```

`beads-import.jsonl` contains native Beads issue records for changed/new desired issues after three-way reconciliation with current local state.

`changes.json` records user changes, current concurrent changes, relation/label deltas, and any conflicts.

`apply-plan.json` records the current snapshot digest, changed issue IDs, and explicit post-import Beads commands.

`apply.sh` always performs `bd import --dry-run --json` first. Without `--execute` it exits after the dry-run. With `--execute`, it performs the import, applies any required exact-removal commands, and runs `bd dep cycles`.

Dependency removals require special handling because `bd dep remove` is pair-scoped. When a relation type changes on the same source/target pair, the generated plan removes the pair and restores every relation type that should remain after reconciliation.

## Direct apply

The Python tool can run the same guarded path itself:

```bash
python3 packages/board-audit/board-audit-roundtrip.py apply package.editable.json
```

This is dry-run only.

Actual mutation requires the explicit flag:

```bash
python3 packages/board-audit/board-audit-roundtrip.py apply package.editable.json --execute
```

The apply sequence is:

```text
fresh bd export --all
→ validate immutable base + edit contract
→ three-way reconcile base/current/desired
→ refuse conflicts
→ compile native Beads JSONL
→ bd import --dry-run --json
→ bd import --json
→ explicit removals/rewires where import merge semantics are insufficient
→ bd dep cycles
→ fresh bd export --all
→ verify actual board satisfies user-intended delta
```

The compiler intentionally does not pass `--allow-stale`. A local write racing the compiled import remains protected by Beads' import stale/tie guard; post-apply verification then detects if intended state was not actually reached.

## Verify later

The desired delta can be checked against the board independently:

```bash
python3 packages/board-audit/board-audit-roundtrip.py verify package.editable.json
```

Verification focuses on the user's intended delta rather than demanding that unrelated concurrent fields equal the old export.

## Exit semantics

The CLI uses non-zero exits for machine automation:

```text
0  valid / safe / compiled / verified
2  invalid package, source tampering, command failure, or unsupported operation
3  three-way conflict
4  post-apply verification failure
```

## ChatGPT workflow

The intended practical workflow is:

```text
local repo
→ board-audit --export --epic <id>
→ board-audit-roundtrip prepare <work-package>
→ upload the single editable JSON to ChatGPT
→ ChatGPT edits desired_issues only
→ return/save edited artifact
→ validate + diff locally
→ compile/apply
→ fresh export + verification
```

This gives ChatGPT a complete Beads work package while keeping all mutation authority and concurrency checks in the local repository.

## Safety boundaries in v1

The first round-trip version intentionally does not treat omission of an issue as deletion. Historical comments cannot be rewritten. Context-only ancestors are read-only by default. `--allow-stale` is never generated. The tool does not claim transactionality across the JSONL import and subsequent exact-removal commands; verification is mandatory for executed changes. For dependency/label removals, a concurrent write in the small post-import window can therefore cause verification to fail and require reconciliation rather than being silently accepted.

Beads/Dolt database backup and history restoration are outside this feature. This is issue/work-package interchange and mutation, not disaster-recovery backup.

## Future GitHub Actions automation

After real-board trials prove the edit contract and conflict behavior, this flow is suitable for GitHub Actions automation. The natural staged design is:

```text
workflow_dispatch / issue command
→ export + prepare on an authorized runner
→ upload editable work-package artifact
→ human/ChatGPT produces proposed desired artifact
→ validation/diff workflow
→ PR containing desired artifact + generated changes/apply plan
→ protected apply job on an authorized runner
→ post-apply export + verification artifact
```

The apply job should not be enabled until the manual/local round-trip has been exercised on representative boards. It should run only where the authoritative Beads database is reachable; for workstation/VPS-local Beads state that normally means an appropriately constrained self-hosted runner rather than assuming a fresh GitHub-hosted checkout has the authoritative database.
