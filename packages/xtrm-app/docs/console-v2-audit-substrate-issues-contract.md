# Substrate Issues — integration contract audit

> **Console v2 / ISSUE-140 audit artifact.** Read-only source inspection at a pinned revision.
> Audited source: `xtrm-dev/xtrm` @ `9263f917c232db266f27468f558861f86a5e5cb0` (`packages/substrate/**`)
> Every load-bearing claim carries a `path:line` reference and is tagged `VERIFIED` (read in source), `INFERENCE` (derived from cited facts), or `UNKNOWN`.
> Current source and tests outrank older planning prose. `docs/substrate/sbcloseout4-adr.md` was untracked at the audited SHA and is not landed authority.
> **Correction from the companion Console audit (`console-v2-audit-console-program-graph-drawer.md` §A.5):** the Console's `/api/substrate/*` namespace currently serves *both* the Beads-materialized issue feed (`.../projects/:id/issues`, `/closed`, `/issues/:issueId`, `/runtime-graph`, `/stats`) *and* Beads/Dolt source health plus a `bd`-spawning write passthrough. Where this document characterises that namespace as source health only, this correction applies.
> Consumed by `adoption-audit.md`, `console-v2-migration-plan.md`, and `xtrm-gui-prd.md`.

---

## 1. Header

| Field | Value |
|---|---|
| Repository | `/home/dawid/dev/xtrm` (`xtrm-dev/xtrm`) |
| Ref | `main` (checked-out worktree `xt/vhhe`-equivalent; no tracked delta) |
| **Audited SHA** | **`9263f917c232db266f27468f558861f86a5e5cb0`** |
| HEAD subject | `docs+test+fix(substrate): A10 acceptance + §57 final report (xtrm-6qu.10)` |
| Working-tree state | clean; one untracked file `docs/substrate/sbcloseout4-adr.md` (not committed; treated as post-cutover planning context only) |
| Date | 2026-09-12 |
| Scope | `packages/substrate/**` (src, tests, cli, hooks, integrations, plugin, skills, README, package.json); consumer-side cross-check in `/home/dawid/dev/console-wt/audit-main` @ `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d` |
| Method | Source + tests are authoritative; planning prose in `docs/substrate/**` used only as corroboration, never as the claim source |
| Modifications | None. This file is the only artifact written. |

Tag legend: `VERIFIED` = read directly in source/tests at the cited line. `INFERENCE` = derived from cited facts. `UNKNOWN` = not determinable from the audited tree.

---

## 2. Public surface inventory

### 2.1 Package entry point

`packages/substrate/src/index.ts:1-19` — the entire root export surface:

| Line | Export | Purpose |
|---|---|---|
| `1` | `* from ./domain/issue.ts` | Identity, lifecycle, Issue/Revision/Event shapes |
| `2` | `* from ./domain/contract.ts` | Seven-field WorkContract + canonical hash + structural validation |
| `3` | `* from ./domain/edge.ts` | Typed edge kinds + generic cycle probe |
| `4` | `* from ./domain/claim.ts` | Claim/lease types + liveness/holder policy |
| `5` | `* from ./domain/journal.ts` | Journal kinds + checkpoint validation |
| `6` | `* from ./domain/execution-binding.ts` | Dispatch→revision/hash binding + claim pin |
| `7` | `* from ./domain/provenance.ts` | Receipts, artifacts, trailer formatting/parsing, bundles |
| `8` | `* from ./store/sqlite.ts` | `openSubstrate` |
| `9` | `* from ./store/transactions.ts` | `withTransaction`, `nextInNamespace`, `mutateOnce` |
| `10` | `* from ./service/issue-service.ts` | `IssueService` |
| `11` | `* from ./service/integration-service.ts` | `IntegrationService` (+ intake validators) |
| `12` | `* as workitems from ./workitems/index.ts` | `WorkItemStore` seam, `SubstrateIssueStore`, `BeadsWorkItemStore`, dispatch gate |
| `13` | `* from ./service/journal-service.ts` | `JournalService` |
| `14` | `* from ./service/resume-service.ts` | `ResumeService` |
| `15` | `* from ./service/provenance-service.ts` | `ProvenanceService` |
| `16` | `* from ./projections/types.ts` | Projection primitives + `hashMappedContent`/`backoffMs` |
| `17` | `* as githubProjection from ./projections/github/mapping.ts` | GitHub ops |
| `18` | `* as jiraProjection from ./projections/jira/mapping.ts` | Jira ops |
| `19` | `* as filesystemProjection from ./projections/filesystem/render.ts` | Markdown/JSON tree rendering |

**Not exported from the root** `VERIFIED`: `./domain/readiness.ts` (`deriveReadiness`, `ReadinessReport`, `OperationalState`, `scopeCovers`, `resolveInheritedContext`), `./service/planning-service.ts` (`PlanningService`), `./store/database.ts`, `./store/migrations/runner.ts` (`assertSchemaHealthy`), `./compatibility/beads/import.ts` (`importBeads`). The CLI imports these by deep path (`cli/sb.ts:11,15,16,18`).

**No package entry-point metadata** `VERIFIED`: `packages/substrate/package.json:1-54` declares `bin` (`:6-8`), the Pi extension (`:15-19`) and `files` (`:20-28`), but has **no `main`, no `exports`, no `types`, no `module`**. A consumer cannot write `import { IssueService } from "@xtrm/substrate"`; it must deep-import source files or vendor them.

### 2.2 Domain modules

| Path:line | Symbol | Purpose |
|---|---|---|
| `src/domain/issue.ts:5` | `ISSUE_KINDS` | `epic\|task\|bug\|decision\|research\|followup` |
| `src/domain/issue.ts:8,11` | `LIFECYCLE_STATES`, `TERMINAL_STATES` | `open\|deferred\|done\|cancelled\|archived` |
| `src/domain/issue.ts:13,20,38` | `Project`, `Issue`, `ResolvedIssue` | Issue carries `currentRevision` + `currentContractHash`; `ResolvedIssue` adds derived `humanRef`/`locator` |
| `src/domain/issue.ts:43,55` | `IssueRevision`, `IssueEvent` | Immutable revision rows; append-only event spine |
| `src/domain/issue.ts:63,67,71` | `newIssueId`, `formatHumanRef`, `parseHumanRef` | `iss_<uuidv7>`, `PREFIX-N`, `PREFIX-N` parse |
| `src/domain/contract.ts:18` | `WorkContract` | 7 required + 5 optional fields |
| `src/domain/contract.ts:45` | `hashContract` | sha256 over key-sorted canonical JSON |
| `src/domain/contract.ts:52` | `assertContractShape` | Create/revise input sanity only |
| `src/domain/contract.ts:75,77` | `SCRUTINY_LEVELS`, `isValidScrutiny` | `LOW\|MEDIUM\|HIGH\|CRITICAL` |
| `src/domain/contract.ts:83,92` | `OwnershipContract`, `validateOwnership` | repositories/paths/services/interfaces |
| `src/domain/contract.ts:136,196` | `validateContractStructure`, `isStructurallyValid` | Deterministic findings; never throws |
| `src/domain/contract.ts:203` | `validateContextRefs` | Rejects `journal`/`memory` authority kinds |
| `src/domain/edge.ts:4,22` | `EDGE_KINDS`, `wouldCreateCycle` | 6 kinds; generic directed-reachability probe |
| `src/domain/claim.ts:25,45` | `IssueClaim`, `WorkspaceLease` | Two distinct authorities |
| `src/domain/claim.ts:58,59` | `DEFAULT_CLAIM_TTL_MS`, `DEFAULT_LEASE_TTL_MS` | 15 min each |
| `src/domain/claim.ts:61,65,70` | `isLiveClaim`, `isLiveLease`, `isExpiredLease` | Liveness derived, never stored |
| `src/domain/claim.ts:75,84` | `normalizeWorkspace`, `sameHolder` | Path-normalized exclusivity key; holder+activation identity |
| `src/domain/journal.ts:8` | `JOURNAL_KINDS` | 8 kinds |
| `src/domain/journal.ts:31,58` | `MechanicalCheckpoint`, `ChildCheckpointRef` | Host-known state; child refs never transcripts |
| `src/domain/journal.ts:69,86` | `SemanticCheckpoint`, `JournalEntry` | Bounded summarizer output |
| `src/domain/journal.ts:108,131,152` | `validateSemanticCheckpoint`, `validateMechanicalCheckpoint`, `validateEvidenceRefs` | Validated on read and write |
| `src/domain/execution-binding.ts:10,26,42` | `ExecutionBinding`, `DispatchInput`, `ExpectedClaimPin` | Immutable freeze of revision/hash/context |
| `src/domain/execution-binding.ts:55` | `validateDispatchInput` | Host-input shape only |
| `src/domain/provenance.ts:8-10` | `TRAILER_ISSUE`, `TRAILER_REVISION`, `TRAILER_RECEIPT` | `XTRM-Issue`, `XTRM-Issue-Revision`, `XTRM-Receipt` |
| `src/domain/provenance.ts:22,35,46,54` | `WorkReceipt`, `ArtifactBinding`, `CheckpointSummary`, `ProvenanceBundle` | Receipt/artifact/bundle shapes |
| `src/domain/provenance.ts:91,97,109` | `formatTrailers`, `attachTrailers`, `parseTrailers` | Host-owned trailer block; idempotent attach |
| **`src/domain/readiness.ts`** | | *Not root-exported* |
| `src/domain/readiness.ts:33` | `isAttestationCurrent` | ready ∧ same revision ∧ same hash |
| `src/domain/readiness.ts:68,73` | `registerScrutinyPolicy`, `scrutinyPolicyFor` | Pluggable policy; unknown ref fails closed |
| `src/domain/readiness.ts:81,104` | `OperationalState`, `ReadinessReport` | `terminal\|deferred\|draft\|blocked\|claimed\|ready` |
| `src/domain/readiness.ts:88` | `isBlockerSatisfied` | Only `done`/`archived`; `cancelled` stays unsatisfied |
| `src/domain/readiness.ts:119` | `deriveReadiness` | The single readiness derivation |
| `src/domain/readiness.ts:180` | `scopeCovers` | Narrow-only scope check |
| `src/domain/readiness.ts:189-235` | `ContextRef`, `ResolvedContextEntry`, `ResolvedContext`, `resolveInheritedContext` | Leaf-wins merge with source provenance + sha256 |

### 2.3 Store modules

| Path:line | Symbol | Purpose |
|---|---|---|
| `src/store/database.ts:12,18,26` | `SubstrateStatement`, `SubstrateDatabase`, `DatabaseSync` | Runtime-neutral SQLite handle |
| `src/store/sqlite.ts:21` | `loadDriver` | `bun:sqlite` if `globalThis.Bun`, else `node:sqlite` |
| `src/store/sqlite.ts:31` | `adaptDatabase` | Normalizes `undefined`→NULL (bun binds, node rejects) |
| `src/store/sqlite.ts:50` | `openSubstrate(dbPath)` | Opens, sets pragmas, migrates, fail-closed |
| `src/store/transactions.ts:14,19` | `COUNTER_NAMESPACES`, `IDEMPOTENCY_NAMESPACES` | `human_ref\|child_slot`; `command\|plan\|inbox\|outbox` |
| `src/store/transactions.ts:24` | `withTransaction` | `BEGIN IMMEDIATE`, re-entrant via SAVEPOINT |
| `src/store/transactions.ts:65` | `nextInNamespace` | Monotonic, never-reused counter |
| `src/store/transactions.ts:83` | `mutateOnce` | JSON-recorded idempotency replay |
| `src/store/migrations/runner.ts:20` | `MIGRATIONS` | Append-only ordered list |
| `src/store/migrations/runner.ts:30` | `REQUIRED_TABLES` | 20-table health assertion |
| `src/store/migrations/runner.ts:57,112` | `migrate`, `assertSchemaHealthy` | Checksum-verified upgrade; corrupt schema refuses startup |

### 2.4 Service modules

| Path:line | Symbol | Purpose |
|---|---|---|
| `src/service/issue-service.ts:103` | `class IssueService` | Projects, identity, revisions, edges, readiness, claims, leases, events, export/import |
| `src/service/journal-service.ts:105` | `class JournalService` | Append-only journal, mechanical-first checkpointing, cursor reads |
| `src/service/resume-service.ts:52` | `class ResumeService` | `buildCapsule`/`renderCapsule` bounded continuity |
| `src/service/provenance-service.ts:75` | `class ProvenanceService` | Dispatch bindings, receipts, artifacts, trailers, bundles, trace |
| `src/service/integration-service.ts:143` | `class IntegrationService` | External bindings, projection outbox, integration inbox |
| `src/service/integration-service.ts:95,110,129` | `validateGitHubIntake`, `validateJiraIntake`, `validateRemoteEdit` | Explicit inbound payload validation before mutation |
| **`src/service/planning-service.ts`** | | *Not root-exported* |
| `src/service/planning-service.ts:95` | `class PlanningService` | `check` (read-only) + `apply` (atomic, idempotent) |

### 2.5 WorkItemStore seam

| Path:line | Symbol | Purpose |
|---|---|---|
| `src/workitems/store.ts:59` | `interface WorkItemStore` | Backend-neutral surface used by skills/runtimes |
| `src/workitems/store.ts:14,22,30,38,44,51` | `IssueView`, `ClaimView`, `AttestationInput`, `JournalEntryView`, `ChangeBatch`, `CheckpointInput` | Seam DTOs |
| `src/workitems/substrate-store.ts:23` | `class SubstrateIssueStore` | Canonical backend; thin over IssueService/JournalService, no SQL |
| `src/workitems/substrate-store.ts:28` | `constructor(issues: IssueService, journal: JournalService)` | Injection seam |
| `src/workitems/beads-store.ts:34` | `class BeadsWorkItemStore` | Read-only compatibility over `.beads/issues.jsonl` |
| `src/workitems/beads-store.ts:28` | `compatError` | Every mutation fails closed naming the Substrate equivalent |
| `src/workitems/dispatch-gate.ts:49,90,121` | `checkDispatch`, `dispatchToSpecialist`, `scopeExpansion` | Specialists gate over Substrate authority |

### 2.6 Compatibility

| Path:line | Symbol | Purpose |
|---|---|---|
| `src/compatibility/beads/import.ts:157` | `importBeads(svc, projectId, records, edges, opts?)` | One-way Beads intake |
| `src/compatibility/beads/import.ts:38` | `ImportResult` | Full receipt shape (created/skipped/edges/hierarchy/notes/comments/closeReason) |
| `src/compatibility/beads/import.ts:69,98,126` | `BEADS_TBD_MARKER`, `expectedProblemHead`, `unionEdges` | Shared marker/expectation/edge-union helpers |

---

## 3. Characterisation

### 3.1 Root DB location / discovery / one-database authority — `VERIFIED`, with one caveat

Canonical precedence, implemented independently in four surfaces:

- `cli/sb.ts:508` — `flag(flags,"db") ?? opts?.dbPath ?? process.env["SUBSTRATE_DB"] ?? join(homedir(), ".xtrm", "state.db")`
- `integrations/claude-code/runtime.ts:28,30` — `CANONICAL_DB_PATH = join(homedir(), ".xtrm", "state.db")`; `resolveDbPath(explicit?)` returns `explicit ?? SUBSTRATE_DB ?? CANONICAL_DB_PATH`
- `integrations/pi/extension.ts:52` — same expression
- `hooks/prepare-commit-msg.ts:18`, `hooks/post-commit.ts:15`, `hooks/post-rewrite.ts:15` — same expression

No surface defaults to a repo-local database. `plugin/substrate/.mcp.json:1-2` deliberately carries **no** `env` block; the comment states a `SUBSTRATE_DB` default there "would fork the canonical store". Pinned by `tests/db-authority.test.ts:24-50` (`:25` default path, `:32` explicit-beats-env, `:45`/`:39` plugin manifests ship no repo-local default).

`INFERENCE`: authority is "one **file path**", not "one process". Multiple processes share the file under WAL.

**Caveat (material, cross-repo)** `VERIFIED` in the Console tree: `/home/dawid/dev/console-wt/audit-main/packages/core/src/state/paths.ts:4-5` defines `DEFAULT_STATE_DB_NAME = "state.db"` and `:21 resolveStateDaemonPaths()` defaults to `join(homeDir, ".xtrm", "state.db")` — byte-for-byte the same path as Substrate's `CANONICAL_DB_PATH`. The Console's `StateClient` (`packages/core/src/state/client.ts:23,28`) wraps that path. `createStateClient`/`StateClient` have **no production call sites** (only `packages/core/tests/state.test.ts:2,6`), so there is no live collision today. If the Console state daemon is ever activated as written, two independent schemas (`XTRM_TABLES`, `database.ts:3-21`) would contend for the same file.

### 3.2 SQLite / WAL behaviour and pragmas — `VERIFIED`

`src/store/sqlite.ts:50-65`, the only opener:

| Line | Statement | Effect |
|---|---|---|
| `:52` | `PRAGMA journal_mode = WAL` | Committed transactions survive restart |
| `:56` | `PRAGMA busy_timeout = 5000` | Concurrent claim/lease writers wait for the holder instead of `SQLITE_BUSY` |
| `:57` | `PRAGMA synchronous = FULL` | Durability over throughput |
| `:58` | `PRAGMA foreign_keys = ON` | Referential integrity enforced |
| `:60-63` | `migrate(db)` then `db.close()` on throw | Fail-closed open; a corrupt DB never yields a usable handle |

Write transactions use `BEGIN IMMEDIATE` (`src/store/transactions.ts:47`), nested calls use `SAVEPOINT xtrm_sp_<depth>` (`:29`), depth tracked per handle in a `WeakMap` (`:22`). Driver selection is lazy via `createRequire` so Bun never resolves `node:sqlite` (`src/store/sqlite.ts:21-27`); parameter `undefined`→`null` normalization at `:31-45`.

### 3.3 Schema + migrations — `VERIFIED`

Runner: `src/store/migrations/runner.ts`. Landed migrations are never edited; a checksum mismatch (`:80`) or an unknown DB version (`:74`) throws. `schema_migrations(version,name,checksum,applied_at)` at `:59`. Every migration runs inside its own `BEGIN IMMEDIATE` (`:86-95`). `assertSchemaHealthy` (`:112`) verifies all 20 tables from `:30-51` exist.

| File | Version / name | Adds |
|---|---|---|
| `migrations/001_baseline.ts:4-5` | 1 `baseline-domain-kernel` | `projects`, `issues` (UNIQUE project_id+human_number), `issue_revisions`, `issue_aliases`, `issue_locator_history`, `issue_edges` (+ `ux_active_parent` `:69`, `ux_parent_slot` `:71`), `issue_events` (+ index `:81`), `seq_counters`, `idempotency_keys` |
| `migrations/002_projections_sync.ts:3-4` | 2 `projections-sync` | `external_bindings`, `integration_inbox` (UNIQUE provider+idempotency_key `:34`), `projection_outbox` (+ `ix_outbox_drain` `:52`) |
| `migrations/003_readiness.ts:5-6` | 3 `readiness-attestations` | `readiness_attestations` (+ `ix_attest_issue` `:21`) |
| `migrations/004_claims_leases.ts:10-11` | 4 `claims-workspace-leases` | `issue_claims` (+ partial `ux_open_claim` `:27`), `workspace_leases` (+ partial `ux_open_writer_lease` `:43`) |
| `migrations/005_journal.ts:5-6` | 5 `issue-journal` | `issue_journal` (UNIQUE issue_id+sequence `:23`) + 2 indexes |
| `migrations/006_provenance.ts:7-8` | 6 `execution-provenance` | `execution_bindings`, `work_receipts`, `artifact_bindings` (UNIQUE receipt_id+kind+value `:51`) |
| `migrations/007_checkout_links.ts:8-9` | 7 `checkout-links` | `checkout_links(git_root PK, project_id, linked_at)` |

`VERIFIED`: no `state.db` schema has any table named `substrate_issues`, `substrate_dependencies`, `substrate_issue_edges`, `specialist_jobs`, `github_*` — those belong to the Console's own `xtrm.sqlite`.

### 3.4 Issue identity forms — `VERIFIED`

Three forms (comment at `src/domain/issue.ts:3`):

1. **Machine ID** — `iss_<uuidv7>` (`src/domain/issue.ts:63-65`); primary key; never rendered in human CLI output (`cli/sb.ts:42-43`).
2. **Human ref** — `PREFIX-N` (`src/domain/issue.ts:67-69`), allocated from `seq_counters` namespace `human_ref` (`src/service/issue-service.ts:224`, `src/store/transactions.ts:65`). Immutable: it is derived from `projects.prefix` + `issues.human_number`, both fixed at create; reparenting never touches them (`src/service/issue-service.ts:456-457`).
3. **Locator** — derived, never stored as identity (`src/domain/issue.ts:36-37`). `currentLocator` walks the active `parent_child` chain from the issue to its root and joins the allocated `child_slot`s (`src/service/issue-service.ts:423-446`): `ROOT-N` when root, `ROOT-N.a.b` otherwise. `child_slot` comes from namespace `child_slot` (`:498`), so slots are monotonic and never reused. Reparenting writes the *previous* locator into `issue_locator_history` (`:489-490`) and deactivates the old edge (`:485`); `locatorHistory` reads it back (`:448-452`). Cycle detection is fail-closed inside the locator walk itself (`:438`).

**Resolution** `resolveRef` (`src/service/issue-service.ts:366-387`) accepts, in order: `iss_`-prefixed machine ID (`:368`), `PREFIX-N` against a known project prefix (`:372-379`), registered alias (`:380-381`), historical locator (`:382-383`), then a full scan of current locators (`:384-385`, `findByCurrentLocator` at `:1422-1433`). Human-shaped refs that match no project fall through to alias lookup specifically so imported Beads IDs like `xtrm-401` keep resolving (`:369-371`; test `tests/migration.test.ts:174`). Unresolvable refs throw `unresolvable ref` (`:386`).

Note the current-locator scan is O(issues) with one recursive walk per issue (`:1423-1432`) — a full-table probe on every miss.

### 3.5 Contract hash + revision semantics — `VERIFIED`

- `hashContract` = sha256 of `JSON.stringify(canonicalize(contract))`, where object keys are sorted recursively (`src/domain/contract.ts:33-47`). Array order is significant; key order is not.
- Revision is created only when the hash changes **or** when execution-relevant metadata changes with an unchanged hash (`src/service/issue-service.ts:291-336`). The no-op path returns `created: false` (`:292`, `:311`).
- **Execution-relevant** (new revision, prior attestation invalidated): `contract`, `ownership`, `contextRefs` (via `updateContract`/`revise`), and `scrutiny` (`setScrutiny` `:836-866`).
- **Metadata-only** (no revision, readiness retained): `title` (`setTitle` `:897-906`), `priority` (`setPriority` `:908-917`), `deferUntil` (`setDeferral` `:820-831`), lifecycle (`setLifecycleState` `:1487-1496`). Each emits an `issue.metadata` / `issue.deferred` / `issue.lifecycle` event.
- Every revision row stores `contract_json`, `context_refs_json`, `ownership_json`, `authored_by`, `source_json` (`migrations/001_baseline.ts:32-43`); `IssueRevision` exposes them (`src/domain/issue.ts:43-53`).
- Identical restatement of `ownership`/`contextRefs` stays a no-op by JSON comparison (`:306-312`, `:876`, `:890`).

### 3.6 `expectedRevision` race guards — `VERIFIED`, partial coverage

Present on exactly these call paths:

| Path:line | Guard |
|---|---|
| `src/service/issue-service.ts:287-289` | `updateContract`/`revise`: throws `revision conflict on <id>: expected X, current Y` |
| `src/service/issue-service.ts:1053-1055` | `claimTx`: same message; reached from `claimIssue` (`:1014`) and `claimReady` (`:1028`) |
| `src/service/issue-service.ts:265,1020,1039` | `opts.expectedRevision` plumbing |
| `src/service/planning-service.ts:33` | `PlanIssueSpec.expectedRevision` (per-spec, applied at `:360`) |
| `src/service/provenance-service.ts:115-122` | `dispatch` `opts.expectedRevision` pin, checked inside the same transaction before INSERT |
| `src/service/provenance-service.ts:123-130` | matching `opts.expectedContractHash` pin |
| `src/service/provenance-service.ts:142-156` | `opts.expectedClaim` pin (`{id, generation}`), including explicit expected-null |
| `src/workitems/store.ts:70` | `WorkItemStore.update(..., opts?: { expectedRevision?: number })` |
| `src/workitems/dispatch-gate.ts:104` | `dispatchToSpecialist` forwards `expectedRevision`/`expectedContractHash` from the check |

**Absent** `VERIFIED`: `setLifecycleState`, `setTitle`, `setPriority`, `setScrutiny`, `setDeferral`, `setOwnership`, `setContextRefs` accept no revision guard. `setOwnership`/`setContextRefs` call `updateContract` without passing `expectedRevision` (`:877`, `:891`). `setParent`, `addEdge`, `removeEdge`, `removeEdgeByEndpoints`, `addAlias`, `appendEvent` are unguarded. The CLI exposes `--expected-revision` only on `issue edit` (`cli/sb.ts:281`, allowlist `:448`).

### 3.7 Typed edges / cycle handling — `VERIFIED`

Kinds (`src/domain/edge.ts:4-11`): `parent_child`, `blocks`, `relates_to`, `discovered_from`, `supersedes`, `duplicates`. Only `blocks` affects readiness (comment `:1-2`).

Storage: single `issue_edges` table with `active` flag (soft delete). Structural invariants are enforced in SQL:

- `ux_active_parent ON issue_edges(to_issue) WHERE kind='parent_child' AND active=1` (`migrations/001_baseline.ts:69-70`) — single active parent.
- `ux_parent_slot ON issue_edges(from_issue, child_slot) WHERE kind='parent_child'` (`:71-72`) — one child per slot.

Cycle probes: `wouldCreateCycle(existing, from, to)` (`src/domain/edge.ts:22-43`) returns true when `from === to` or `to` can already reach `from`. Two call sites with **opposite conventions**:

- Parent hierarchy: links are reversed to `{from: child, to: parent}` before probing (`src/service/issue-service.ts:477-480`), then `wouldCreateCycle(links, childId, parentId)` throws `parent cycle rejected`.
- Blocks: links kept as `{from: blocker, to: blocked}` (`:521-524`), `wouldCreateCycle(links, fromId, toId)` throws `blocks cycle rejected` (`:525`).

`parent_child` cannot be created through `addEdge` (rejected at `:508`) — it must go through `setParent` (`:458-495`), which also rejects cross-project parenting (`:476`) and writes locator history. A read-side backstop also throws on parent cycles in `currentLocator` (`:438`) and `getResolvedContext` (`:992`). Planning pre-computes draft-internal and stored-graph cycle reports (`src/service/planning-service.ts:231-255`, `:289-297`). Tests: `tests/identity-graph.test.ts:90-118`.

### 3.8 Readiness / planning rules — `VERIFIED`

`deriveReadiness` (`src/domain/readiness.ts:119-173`) evaluates in this exact order:

1. `lifecycleState ∈ {done,cancelled,archived}` → `terminal` (`:125-127`)
2. `deferUntil !== null && deferUntil > now` → `deferred` (`:128-130`)
3. structural findings non-empty → `draft` (`:131-133`)
4. `!isAttestationCurrent(attestation, revision, contractHash)` → `draft` (`:134-136`)
5. `unsatisfiedBlockers.length > 0` → `blocked` (`:137-139`)
6. `hasActiveClaim` → `claimed` (`:140-142`)
7. else `ready` (`:143-144`)
8. post-check: if `ready` and an attestation exists, re-evaluate the attestation's `policy` ref against `scrutiny`; denial (or an unknown policy ref) demotes to `draft` (`:149-160`)

`dispatchable === (state === "ready")` (`:170`). Blockers are satisfied only by `done`/`archived` (`:88-90`); a `cancelled` prerequisite stays blocking by design (comment `:85-87`).

`IssueService.getReadiness` (`src/service/issue-service.ts:937-959`) is the single wiring point: it loads the issue, its current revision, the latest attestation (`:810`), `unsatisfiedBlockers` (`:919-933`) and live-claim liveness (`:939`), and injects `now`. `assertDispatchable` (`:965-978`) throws unless dispatchable and rejects scope expansion via `scopeCovers`.

Planning (`src/service/planning-service.ts:95`) is separate from readiness: `check` (`:105-328`) is read-only and reports `errors`, `createdKeys`, `updatedIds`, `missingAttestations`, `blockedTargets`, `parentCycles`, `blockCycles`, `aliasCollisions`, `ownershipOverlaps`, `invalidRefs`; `ok` requires errors/cycles/collisions/invalidRefs all empty (`:309-314`) — ownership overlaps are advisory only (`:299-307`). `apply` (`:335-348`) wraps `check` **inside** `mutateOnce(plan, planKey)` inside one transaction, so a re-apply returns the recorded result (`:338`) and a failed check records nothing (`:334`).

### 3.9 Claims / leases — `VERIFIED`

Two distinct authorities (comment `src/domain/claim.ts:19-23`): a **claim** is "who owns the work"; a **workspace writer lease** is "who may mutate this worktree".

Claims (`src/service/issue-service.ts:1044-1117`):

- Exactly one live claim per issue, enforced by `ux_open_claim` (`migrations/004_claims_leases.ts:27`) behind the serialized check-then-insert.
- Live = `released_at IS NULL AND expires_at > now` (`src/domain/claim.ts:61-63`).
- Same-holder retry is idempotent and returns the existing row (`:1059-1061`); a different holder against a live claim throws `claim-held … (anti-steal)` (`:1062-1064`).
- Expired-but-unclosed rows are closed and a new generation opens in the same transaction (`:1066-1073`). Renewing an expired claim is refused (`:1125`).
- Claimability is re-derived inside the transaction (`:1078-1081`), so drafts/blocked/terminal work throws `not-claimable`.
- `generation` = `MAX(generation)+1` scoped to the issue (`:1084-1085`); `UNIQUE(issue_id, generation)` (`migrations/004_claims_leases.ts:25`).
- `renewClaim` (`:1119-1136`), `releaseClaim` (holder-only, idempotent no-op returning `null`, `:1139-1152`), `getActiveClaim` (`:1154`), `listClaims` (`:1159`).
- `claimReady` (`:1028-1042`) attests and claims in one transaction so no edit can slip between.

Leases (`:1173-1301`): exclusivity key is the normalized worktree path (`src/domain/claim.ts:75-80`); single live writer via `ux_open_writer_lease` (`migrations/004_claims_leases.ts:43`); same anti-steal/idempotency/policy as claims, minus claimability (leases are workspace-scoped, so no per-issue events — comment `:1170-1171`). Authority helpers: `holdsWriterLease` (`:1307`), `assertCanWrite` (`:1316-1327`, throws `lease-fenced`), `canReadWorkspace()` which returns `true` unconditionally (`:1330-1332`) — readers coexist with the writer. Tests: `tests/claims-leases.test.ts:29-176` including `C15` real-process WAL race (`:39`) and `§47` crash-restart lease honour (`:170`).

### 3.10 Journal / checkpoints — `VERIFIED`

`JournalService` (`src/service/journal-service.ts:105`). Append-only; sequence is per-issue `MAX(sequence)+1` (`:133-138`) with `UNIQUE(issue_id, sequence)` (`migrations/005_journal.ts:23`).

- Kinds (`src/domain/journal.ts:8-17`): `checkpoint`, `handoff`, `milestone`, `decision`, `finding`, `blocker`, `compaction`, `note`.
- `appendEntry` (`:114-167`) validates kind, evidence refs, semantic shape, and requires `mechanical` for `checkpoint`/`compaction` (`:128-130`); it stamps `issue_revision` from the live issue (`:152`) and appends a `journal.appended` event (`:164`).
- `collectMechanical` (`:219-272`) merges service-derived durable truth (revision, contractHash, live claim holder/expiry, unsatisfied blockers, child summaries with checkpoint refs) with host-supplied execution context (workspace, commits, changed files). Derived identity fields win over host overrides (`:268-270`).
- `checkpoint` (`:287-327`) writes the mechanical entry **first**, then stamps `cursor = sequence` in a second transaction (`:301-306`), then optionally runs the async summarizer and enriches (`:310-312`). A summarizer failure records `journal.checkpoint_degraded` and returns `{entry, degraded: true}` — mechanical state stays durable (`:313-326`).
- `compactionCheckpoint` (`:329-340`) never throws: a mechanical write failure returns `{entry: null, degraded: true, fallbackToDefault: true}` so host compaction is never blocked.
- Reads: `listEntries` (`:173-189`), `since(issueId, cursor)` (`:193-204` — delta read only), `latestCheckpoint` (`:206-214`), `renderCheckpoint` (`:344-371`).
- Read-side validation fails closed on corrupt kind/semantic/mechanical/refs JSON (`:381-409`).

### 3.11 Resume — `VERIFIED`

`ResumeService` (`src/service/resume-service.ts:52`). `buildCapsule(issueId)` (`:63-129`) assembles `ResumeCapsule` (`:24-46`): issue header, current contract, readiness, resolved-context hash + entry count, latest checkpoint, journal delta since that checkpoint's sequence (`:69`), child summaries by reference (`:70-88`), blockers, live claim, asks (mechanical `pendingAsks` ∪ semantic `openQuestions`, deduped `:89-92`), provenance event count + last 10 (`:113-116`), git block from the checkpoint (`:117-120`), external bindings via an injected `ExternalProvider` (`:48-50`, `:121-126`), `renderedAt`. `renderCapsule` (`:133-176`) is the text projection; child bodies are never copied in (`:131-132`). Capsules are rendered on demand and never persisted (`:2-3`).

### 3.12 Provenance — `VERIFIED`

`ProvenanceService` (`src/service/provenance-service.ts:75`). Every revision/hash pair is copied from live rows, never from caller input (comment `:2-6`).

- `dispatch(issueId, input, opts?)` (`:91-189`): normalizes workspace, validates any `baseCommit` is a 40-hex SHA (`:95-97`), re-derives readiness inside the transaction and accepts only `ready`/`claimed` (`:104-107`), applies the revision/hash/claim pins (`:115-156`), requires holder+activation to match a live claim (anti-steal, `:161-169`), inserts the binding with `report.revision`/`report.contractHash`/`resolvedContext.hash` (`:170-183`), appends `provenance.dispatched` (`:184`).
- `allocateReceipt(bindingId, opts?)` (`:207-237`): takes **no** issue/revision/hash parameters — they are read from the binding row (`:219`, `:229`), so model output has nothing to forge.
- `bindCommit(receiptId, sha)` (`:253-267`): SHA-validated, `INSERT OR IGNORE` into `artifact_bindings` for idempotent hook retries, then sets `commit_sha` + `finalized_at`.
- `reconcileRewrite(oldSha, newSha)` (`:271-299`): supersedes old commit rows, inserts the new, repoints the receipt, emits `provenance.receipt_rewritten`.
- `attachArtifact` (`:304-326`) rejects `commit` by design (`:311`). `listArtifacts` live-only by default (`:328-338`).
- Inverse lookups: `findByCommit` (`:343-354`), `findByPr` (`:356-367`) — trailer text alone never resolves (comment `:341`).
- `trace(issueId)` (`:374-402`): bindings, receipts with artifacts, attestation, claims, checkpoint summaries, commit/PR sets, external bindings, `closureRevision`. Missing legs are null/empty, never invented (comment `:370-372`).
- `generateBundle(issueId, opts?)` (`:409-417`) writes `<repoRoot>/.xtrm/provenance/bundles/<bnd_>.json` (`BUNDLE_DIR` at `:39`) containing the anchored contract + checkpoint **summaries only** (`:430-461`, `:464-476`).
- `trailersForCommit(receiptId, message)` (`:421-428`) formats/attaches the host-owned trailer block.

Hook adapters driving them: `hooks/prepare-commit-msg.ts:23-31` (requires `XTRM_RECEIPT_ID`, exits 0 otherwise), `hooks/post-commit.ts:26-38` (`XTRM_COMMIT_SHA` override, else `git rev-parse HEAD`), `hooks/post-rewrite.ts:18-29` (stdin `<old> <new>` pairs).

### 3.13 Projections and projection types — `VERIFIED`

Primitives (`src/projections/types.ts`): `PROVIDERS = ["github","jira"]` (`:6-7`), `BINDING_MODES = ["projection","intake","mirror_read"]` (`:9-10`), `SYNC_STATES = ["in_sync","pending","drift","uncertain"]` (`:12-13`), `ExternalBinding` (`:15-29`), `OutboxEntry` (`:31-45`), `InboxEntry` (`:47-57`), `ProviderCapabilities` (`:61-66`), `hashMappedContent` (canonicalized sha256, `:82-84`), `backoffMs` (1 s exponential capped at 60 s, deterministic in attempt count, `:88-90`).

- **GitHub** (`src/projections/github/mapping.ts`): `mapIssueToGitHub` (`:29-51`) renders a body with a "local authority wins" banner and `kind`→type / `priority`→field only when capabilities permit; `diffGitHubIssue` (`:55-63`) returns zero ops when the mapped hash is unchanged (F38); `parentLinkOp` (`:67-76`) and `blocksLinkOp` (`:79-88`) emit native sub-issue/dependency ops or **nothing** — never lossy label emulation.
- **Jira** (`src/projections/jira/mapping.ts`): `selectForJira` (`:26-39`) policy `roots-only`/`tagged`/`all`; `mapIssueToJira` (`:50-58`); `diffJiraIssue` (`:60-69`).
- **Filesystem** (`src/projections/filesystem/render.ts`): `renderTreeMarkdown` (`:8-19`) walks roots recursively emitting `locator · humanRef · title [state]`; `writeFilesystemProjection(svc, projectId, dir)` (`:23-30`) writes `tree.md` plus `issues.json` from `svc.exportProject`.
- **Sync engine** (`src/service/integration-service.ts:143`): `bindExternal` (`:154-160`, auto idempotency key `:158`), `getBinding`/`listBindings`/`findBindingByRemote` (`:182-202`), `enqueueProjection` (`:206-237`, dedupes on `(provider,scope,operation,contentHash)` `:215-217`, flips the binding to `pending` `:230`), `listOutbox` (`:239`), `drainOutbox` (`:248-296` — sends outside transactions; success updates `mapped_content_hash`+`last_pushed_revision`+`in_sync`; `uncertain` is recorded and never blindly replayed `:277-282`; retryable failures back off until `maxAttempts` then `failed`), `receiveInbound` (`:302-352` — reserve/process/finalize; duplicates bump `seen_count` and replay the recorded status), `listInbox` (`:354`). Intake creates TBD-marked unready drafts (`:364-395`); remote edits record `drift` and never mutate local authority (`:400-426`).

### 3.14 CLI commands — `VERIFIED`

Entry: `runCli(argv, opts?)` at `cli/sb.ts:505`; db resolution `:508`; envelope constant `SCHEMA_VERSION = "substrate-cli/v1"` at `:27`; help/version are side-effect-free (never open SQLite, `:517-518`); per-command flag allowlist `:445-492`; unknown flags fail closed (`:499-502`).

| Group | Verbs | Dispatch line |
|---|---|---|
| `issue` | create, show, edit, note, validate, attest, list, ready, tree, children, relate, unrelate, claim, release, state, close, reopen, defer, cancel, archive, resume | `runIssue` `:586`; cases `:596,614,633,688,715,730,757,761,770,778,783,791,799,810,817,831,837,842,849,854,859` |
| `project` | create, link, unlink | `runProject` |
| `plan` | check, apply (`--file`) | `runPlan` |
| `journal` | append, checkpoint, show, since, render | `runJournal`; cases `:951,969,1009,1026,1043` |
| `provenance` | dispatch, trace, commit, receipt, pr, bundle | cases `:1092,1107,1120,1130,1137,1146` |
| `import` | `import beads --file --project [--edges-file] [--create-project] [--dry-run]` | usage `:372-374` |
| `export` | `export project --project [--file]` | usage `:376-379` |
| top-level | `doctor [--db] [--json]` (`:408`), `help [group [verb]]`, `--version` | `renderHelp` `:383`, `renderVersion` `:397` |

Human output is one line per item: `locator · humanRef · title [state revN]` (`cli/sb.ts:85-88`). `--json` emits the envelope (`cli/schema.json`, version 1.0.0, additive-only compat), documented in `README.md:38-42`. `doctor` reports `dbPath`, `schemaHealthy`, `schemaError`, `projects`, `link`, `linkError`, `gitRoot` and exits 0/1 (`:408-441`; `README.md:44-47`).

### 3.15 Pi integration — `VERIFIED`

- Registration: `packages/substrate/package.json:15-19` declares the Pi extension `./integrations/pi/extension.ts`.
- `integrations/pi/extension.ts:60` default-exports the extension; `:177` registers all tools; eight model tools at `:75` `substrate_issue_get`, `:84` `substrate_issue_search`, `:97` `substrate_issue_claim`, `:115` `substrate_issue_update`, `:124` `substrate_journal_append`, `:140` `substrate_journal_checkpoint`, `:158` `substrate_issue_resume`, `:168` `substrate_provenance_trace`.
- Events: `tool_call` edit gate `:183`, `session_start` resume surfacing `:203`, `session_before_compact` `:210`.
- Host-agnostic logic lives in `integrations/pi/handlers.ts`: `openServices` (`:25`, calls `openSubstrate` directly — never `exec sb`), `SessionBindings` (`:44`), the tool implementations (`:99`, `:114`, `:126`, `:140`, `:151`, `:167`, `:180`, `:188`), `runBeforeCompact` (`:226`), `evaluateEditGate` (`:275`), `decidePiEditCall` (`:298`), `evaluateStopContinuity` (`:348`), `resumeForSession` (`:364`).
- Environment: `SUBSTRATE_DB` (`extension.ts:52`), `SUBSTRATE_ISSUE_REF` wins with `SUBSTRATE_ISSUE` as backcompat alias, else `<cwd>/.substrate-issue` (`handlers.ts:67-76`; `claude-code/runtime.ts:44-59`); `SUBSTRATE_HOLDER`/`SUBSTRATE_ACTIVATION_ID` (`handlers.ts:77-83`).
- Tests: `tests/pi-integration.test.ts`, `tests/pi-tool-call.test.ts`, `tests/pi-load.test.ts`.

### 3.16 Claude integration — `VERIFIED`

- `integrations/claude-code/hooks.json`: `PreToolUse` matcher `Edit|Write|MultiEdit|NotebookEdit` → `edit-gate.ts`; `PreToolUse` matcher `Bash` → `commit-check.ts`; `Stop` → `stop-gate.ts`; `PreCompact` → `precompact.ts`; `PostCompact` → `postcompact.ts`; `SessionStart` matcher `compact` → `session-start.ts`. All entries are `type: command` adapters over the typed service (the file's own `$comment` records that PreCompact does not support prompt/agent hooks).
- Shared runtime: `integrations/claude-code/runtime.ts:28-31` (DB path), `:33-40` `openHandles`, `:51-59` `discoverIssueRef`, `:61` `resolveIssueId`.
- Packaged plugin: `plugin/substrate/.claude-plugin/plugin.json`, `plugin/substrate/hooks/hooks.json`, `plugin/substrate/.mcp.json` (no env block), `plugin/substrate/monitors/monitors.json`, and `scripts/*.mjs` (`resolve-substrate.mjs`, `session-precondition.mjs`, `tail-events.mjs`, `wake-on-event.mjs`, hook adapters).
- Skills: `skills/using-substrate/SKILL.md` (Pi content owned in-package) and `plugin/substrate/skills/using-substrate/SKILL.md`.

### 3.17 MCP surface — `VERIFIED` (present and current within a declared scope)

- Server: `integrations/claude-code/mcp-server.ts`. `SUBSTRATE_SERVER_NAME = "substrate"` (`:30`), version `0.1.0` (`:31`), `SUBSTRATE_PROTOCOL_REVISION = "2026-07-28"` (`:32`).
- `buildServer()` (`:79`) registers **seven** tools in deterministic order (static list, `listChanged: false`, `:83`): `issue_get` (`:88`), `issue_list` (`:109`), `issue_ready` (`:129`), `journal_append` (`:154`), `journal_show` (`:182`), `provenance_trace` (`:208`), `resume_capsule` (`:225`). Each opens handles, calls the typed service, and closes in `finally`.
- Every tool accepts an optional `dbPath`, resolved through `openHandles` → `resolveDbPath`.
- `serveMain()` (`:41`) rejects legacy openings; direct execution is gated on an exact `import.meta.url === pathToFileURL(process.argv[1]).href` match (`:238-253`).
- Packaged entry `plugin/substrate/scripts/substrate-mcp.ts:15-19` resolves `mcp-server.ts` through `resolve-substrate.mjs` and calls `serveMain()`; the ESM-graph single-SDK constraint is documented at `:5-13`.
- **Not exposed** `VERIFIED`: no event/wake tools (comment `:86` — "E6 wake/event tools are out of scope"); no claim/release/attest/dispatch tools; no plan tools; no projection/sync tools; no write-side issue create/update tool.
- Tests: `tests/mcp-protocol.test.ts`.

### 3.18 Beads import/migration — `VERIFIED`

`importBeads(svc, projectId, records, edges, opts?)` at `src/compatibility/beads/import.ts:157`. One-shot intake, never a runtime backend; **no writes ever go back to Beads** (comment `:1-8`).

- Project resolution: uses the project if present, else requires `opts.createProject` (`:170-175`).
- Per-record: an existing alias means already-imported → pushed to `skippedPresent` and **not** mutated (`:200-207`, G44). Otherwise it maps `description` sections (`PROBLEM/SUCCESS/SCOPE/NON_GOALS/CONSTRAINTS/VALIDATION/OUTPUT`, `:77-92`) into a `WorkContract` with `TBD — imported from Beads; pending XTRM planning` filling missing success/validation/output (`:65-69`, `:213-222`); `issue_type`→kind (`:107-111`), `priority` passed through, `scrutiny: "LOW"` forced, and the Beads ID registered as alias `{alias: beadsId, kind: "beads"}` (`:234`). Creation runs under `mutateOnce` key `beads-import:<id>` (`:236`).
- Every created issue gets a `beads.imported` event carrying `beadsId`, `beadsStatus`, `beadsOwner`, `beadsCloseReason`, `authoredBy` (`:243-249`).
- **Fail-closed guard**: an imported issue that would land dispatchable throws (`:256`, G46). Tests assert nothing imported is dispatchable (`tests/migration.test.ts:99-129`).
- History intake: `notes` (string or array form) and `comments[]` become journal kind `note` with `ref.kind = "beads-history"` refs (`:319-343`); contract text is never polluted (`:258-261`). Dedup by existing ref key so partial-failure resume never doubles entries (`:313-318`). A non-string non-array `notes` value is counted in `notesSkipped`, never silently dropped (`:286-288`). Absent a `JournalService`, notes/comments are counted as skipped (`:306-312`).
- Lifecycle: closed Beads rest as `done`, deferred as `deferred`; already-skipped rows are only touched when their live state actually differs (`:346-362`).
- Edges: second pass after both endpoints exist. Semantics verified live and encoded at `:364-367` — `parent-child {A depends-on B}` ⇒ A child of B; `blocks {A depends-on B}` ⇒ B blocks A. Vocabulary map at `:381-388`: `parent-child→parent_child`, `blocks→blocks`, `discovered-from→discovered_from`, `supersedes→supersedes`, `relates-to→relates_to`, `validates→relates_to`, unknown→`relates_to`.
- Idempotency: per-edge keys `beads-parent:<id>` / `beads-edge:<from>:<to>:<kind>` (`:394`, `:397`); inline `dependencies[]` are authoritative, `--edges-file` is a supplement deduped by `(from,to,type)` with inline winning (`:123-155`).
- `ImportResult` (`:38-63`) is a full receipt including per-source edge counts, `depFailures`, and close-reason accounting. `--dry-run` and apply share the envelope (`tests/migration.test.ts:197-210`).

### 3.19 `SubstrateIssueStore`, `BeadsWorkItemStore`, dispatch gate

| Artifact | Lives at | Implements/consumes | Who calls it (in-tree) |
|---|---|---|---|
| `WorkItemStore` | `src/workitems/store.ts:59-76` (never root-exported directly; reached via `workitems.WorkItemStore`) | 16-method seam: `get search ready validate resolveContext claim claimReady renew release update addEdge addJournal checkpoint close changesSince` | Implemented by the two stores |
| `SubstrateIssueStore` | `src/workitems/substrate-store.ts:23` | Thin over `IssueService` + `JournalService`; **no SQL, no second readiness derivation** (`:1-4`) | `tests/workitems.test.ts:23` (constructor), `:10` |
| `BeadsWorkItemStore` | `src/workitems/beads-store.ts:34` | Read-only over passive JSONL (`:39` default `.beads/issues.jsonl`); `ready()` returns `[]` (`:118-120`); every mutation throws `compatError` naming the Substrate equivalent (`:28-32`); its `IssueView` is always `dispatchable: false` with an explanatory reason (`:99-100`) | `tests/workitems.test.ts:202,212` |
| Dispatch gate | `src/workitems/dispatch-gate.ts:49,90,121` | `checkDispatch` (read-only, pre-`AgentSession`), `dispatchToSpecialist` (gate then `ProvenanceService.dispatch`), `scopeExpansion` (probe) | **Tests only** within this repo: `tests/workitems.test.ts:12,95,110,126,129,131,137,150,153` and `tests/dispatch-auth.test.ts:15` |

`VERIFIED`: outside `packages/substrate/`, the xtrm monorepo contains **no** consumer of `@xtrm/substrate`, `SubstrateIssueStore`, `BeadsWorkItemStore`, `checkDispatch`, or `dispatchToSpecialist`. A repo-wide grep over `packages apps .xtrm docs` (excluding `node_modules` and nested worktrees) returns only prose in `docs/substrate/**`. The xtrm repo has no root `package.json` and `apps/` is empty (`apps/.gitkeep` only); the sibling packages (`xtrm-app`, `xts`, `mcpq`, `service-knowledge`, `arena-top`, `board-audit`, `xtprompt`, `xtrm-tui`) do not import it. `INFERENCE`: the Specialists consumer referenced by the PRD lives in a different repository (`xtrm-dev/specialists`) and is out of scope for this audit.

### 3.20 Current `state.db` authority — `VERIFIED`

Landed and live as a **library-and-CLI** authority: `openSubstrate` (`src/store/sqlite.ts:50`), the four-surface path precedence (3.1), and the shipped WAL/migration/fail-closed semantics (3.2, 3.3). There is no daemon, no socket, no HTTP surface. The ADR (`docs/substrate/sbcloseout4-adr.md:1-8`) states `~/.xtrm/state.db` (or `SUBSTRATE_DB`) "remains the canonical local authority" and that Substrate is "now-canonical", not a migration in progress.

**Naming collision, material for Console work** `VERIFIED` in `/home/dawid/dev/console-wt/audit-main`: the Console route prefix `/api/substrate/*` (`apps/console/src/server/routes/index.ts:123-124`) serves `apps/console/src/server/routes/substrate.ts` (`createSubstrateRouter`, 194 lines) and `apps/console/src/server/routes/beads-write.ts` (`createBeadsWriteRouter`, `:73`). Those routes are Beads/Dolt **source health and repair** surfaces (project listing, `repair-actions`, Dolt pid/port diagnostics over `packages/core/src/state/substrate-project-service.ts:35,40`), plus a `bd`-spawning write path (`beads-write.ts:460 spawnBdCommand`). They have **no relation** to `@xtrm/substrate`. A Console "Substrate Issues" projection must therefore either reuse this prefix with a different shape or take a new prefix.

---

## 4. Integration contract for Console v2

### 4.1 The exact typed seam a Console adapter must call — `VERIFIED`

Composition root (module paths as written; there is no package-level entry point, see 2.1):

```ts
// packages/substrate/src/store/sqlite.ts:50
export function openSubstrate(dbPath: string): SubstrateDatabase

// packages/substrate/src/store/database.ts:18-22
export interface SubstrateDatabase {
  exec(sql: string): void;
  prepare(sql: string): SubstrateStatement;
  close(): void;
}

// packages/substrate/src/service/issue-service.ts:103-107
export class IssueService { constructor(db: DatabaseSync) }

// packages/substrate/src/service/journal-service.ts:109-112
export class JournalService { constructor(db: DatabaseSync, issues: IssueService) }

// packages/substrate/src/service/resume-service.ts:57-61
export class ResumeService {
  constructor(_db: DatabaseSync, issues: IssueService, journal: JournalService,
              opts?: { external?: ExternalProvider })
}

// packages/substrate/src/service/provenance-service.ts:80-84
export class ProvenanceService { constructor(db: DatabaseSync, issues: IssueService, journal?: JournalService | null) }

// packages/substrate/src/service/integration-service.ts:147-150
export class IntegrationService { constructor(db: DatabaseSync, issues: IssueService) }

// packages/substrate/src/workitems/substrate-store.ts:23-31
export class SubstrateIssueStore implements WorkItemStore {
  readonly backend = "substrate" as const;
  constructor(issues: IssueService, journal: JournalService)
}
```

Wiring pattern already in-tree (`integrations/claude-code/runtime.ts:33-40`; `integrations/pi/handlers.ts:25-31`):

```ts
const db = openSubstrate(resolveDbPath(explicit));
const svc = new IssueService(db);
const journal = new JournalService(db, svc);
const resume = new ResumeService(db, svc, journal, { external: new IntegrationService(db, svc) });
const store = new SubstrateIssueStore(svc, journal);           // optional narrow seam
const provenance = new ProvenanceService(db, svc, journal);    // only if receipts/traces are shown
```

Read methods a read-only Console projection needs, exactly as written:

```ts
// src/service/issue-service.ts
resolveProject(input: { explicit?: string; env?: string; gitRoot?: string | null })
  : { projectId: string; source: "flag" | "env" | "link" | "single" }        // :184
listIssues(projectId: string): ResolvedIssue[]                                // :393
resolveRef(ref: string): ResolvedIssue                                        // :366
getIssue(id: string): ResolvedIssue                                           // :389
getRevision(issueId: string, revision: number): IssueRevision                 // :399
listRevisions(issueId: string): IssueRevision[]                               // :405
listEvents(issueId: string): IssueEvent[]                                     // :411
currentLocator(issueId: string): string                                       // :423
locatorHistory(issueId: string): string[]                                     // :448
getParent(childId: string): ResolvedIssue | null                              // :573
listChildren(parentId: string): ResolvedIssue[]                               // :582
listActiveEdges(): StoredEdge[]                                               // :590
listAliases(issueId: string)                                                  // :611
getReadiness(issueId: string, opts?: { now?: number }): ReadinessReport       // :937
unsatisfiedBlockers(issueId: string): string[]                                // :919
getResolvedContext(issueId: string): ResolvedContext                          // :984
latestAttestation(issueId: string): ReadinessAttestation | null               // :810
getActiveClaim(issueId: string, opts?: { now?: number }): IssueClaim | null   // :1154
listClaims(issueId: string): IssueClaim[]                                     // :1159
getProject(id: string): Project                                               // :133
listLinks()                                                                   // :171

// src/service/journal-service.ts
listEntries(issueId: string, opts?: { kind?: JournalKind; limit?: number }): JournalEntry[]  // :173
since(issueId: string, cursor: number): JournalDelta                                         // :193
latestCheckpoint(issueId: string): JournalEntry | null                                       // :206

// src/service/provenance-service.ts
trace(issueId: string): ProvenanceTrace                                       // :374

// src/service/resume-service.ts
buildCapsule(issueId: string): ResumeCapsule                                  // :63
```

Or the narrow seam, if the Console only needs a list/detail view:

```ts
// src/workitems/store.ts:14-20, 59-76
interface IssueView { issue: ResolvedIssue; contract: unknown;
                      readinessState: string; dispatchable: boolean; reasons: string[] }
interface WorkItemStore {
  get(ref: string): IssueView;
  search(project: string, query?: string, kind?: string): IssueView[];
  ready(project: string): IssueView[];
  validate(ref: string): IssueView;
  changesSince(ref: string, afterEventId: number): ChangeBatch;
  /* …mutating methods not needed by a read projection… */
}
```

### 4.2 The explicit anti-pattern — direct SQLite access

A Console adapter must **not** open `state.db` with `bun:sqlite`/`node:sqlite` and `SELECT` from `issues`, `issue_revisions`, `issue_journal`, `issue_claims`, or `issue_edges`. `VERIFIED` reasons, each tied to where the semantics actually live:

1. **Readiness is derived, not stored.** `dispatchable`/`state` depend on struct validity, attestation currency (revision ∧ hash), blocker lineage, live-claim liveness, deferral vs `now`, and the registered scrutiny policy — `src/domain/readiness.ts:119-173`. No SQL expression reproduces it, and `now` is injectable for test control (`src/service/issue-service.ts:938`).
2. **Contract is JSON inside a row.** `IssueRevision.contract` is `JSON.parse(contract_json)` (`src/service/issue-service.ts:1458`); `contractHash` must come from `hashContract`'s canonicalization (`src/domain/contract.ts:33-47`), not from a stored column alone.
3. **Locator is derived by graph walk + counter allocation**, not stored (`src/service/issue-service.ts:423-446`); `child_slot`s are never reused and history lives in a separate table.
4. **Journal rows fail closed on corrupt payloads** only through `toEntry` (`src/service/journal-service.ts:381-409`); raw reads would surface malformed semantic summaries.
5. **Pragmas and migration safety are owned by the opener.** `openSubstrate` sets WAL, `busy_timeout=5000`, `synchronous=FULL`, `foreign_keys=ON`, runs checksum-verified migrations, and closes on failure (`src/store/sqlite.ts:50-65`). A hand-rolled connection silently skips all of it.
6. **Write serialization depends on `BEGIN IMMEDIATE` inside `withTransaction`** (`src/store/transactions.ts:47`), which is what makes the partial unique indexes the backstop rather than the mechanism.
7. **The project docs state the rule**: `packages/substrate/README.md:3-4` — "the `sb` CLI, Pi extension, and Claude plugin consume the typed service, never SQL"; `cli/sb.ts:2-4` — "no SQL here, no business logic here".

Shelling out to `sb --json` (`substrate-cli/v1`, `cli/schema.json`) is a legitimate interim transport, but it is **not** the pattern the in-tree integrations use: `integrations/pi/handlers.ts:25` and `integrations/claude-code/runtime.ts:33` both call `openSubstrate` in-process, and `docs/substrate/phase12-gate-report.md:94` records that no adapter shells out to `sb`.

### 4.3 Is the typed service ready for a read-projection consumer?

**Partial `VERIFIED`, with concrete shortfalls.** Ready today: stable, SQL-free read methods for project/issue/revision/edge/journal/readiness/claim/attestation/provenance (4.1); immutable identity + derived locator; typed JSON-safe DTOs; a documented CLI envelope for a transport-based fallback; and dual-runtime support so a Console Bun host can open the same file (`src/store/sqlite.ts:21-27`).

Not ready, concretely:

- **No importable package boundary** — `package.json` has no `main`/`exports`/`types` (2.1). Every consumer must deep-import `.ts` sources or vendor them; there is no build output (`README.md:89-96`: tests run directly on Node ≥24 with erasable-syntax TS).
- **Readiness types are not root-exported** — `src/index.ts` omits `./domain/readiness.ts`, so `ReadinessReport`, `OperationalState`, and `scopeCovers` are unreachable from the package root.
- **No bulk or cross-issue query API** — `listIssues(projectId)` is the only listing (`src/service/issue-service.ts:393`); there is no filter by `state`, `kind`, `priority`, `scrutiny`, assignee, or `deferUntil`, and no cross-project listing.
- **N+1 readiness** — `WorkItemStore.ready` maps every issue through `getReadiness`, which runs several queries per issue (`src/workitems/substrate-store.ts:59-64`; `src/service/issue-service.ts:937-959`). A Console feed over thousands of issues will be query-bound.
- **No pagination or cursor on issue listing** — `Cursor` exists only for journal sequences (`src/service/journal-service.ts:193`) and the per-issue event `ChangeBatch` (`src/workitems/store.ts:44-49`).
- **No change feed / subscription surface** — nothing emits or streams changes; `projection_outbox`/`integration_inbox` are provider-bound, not UI event streams (`src/service/integration-service.ts:206-352`). A Console live view must poll `listEvents` per issue.
- **No process/IPC boundary** — the seam is a library over a file. There is no server, socket, or HTTP binding in-package (3.20), so a Console host in a different process than a writer must either embed it (sharing the file under WAL) or shell out to `sb`.
- **No contract diff** — `listRevisions` returns whole revisions (`:405-409`); nothing computes a field-level delta between revision N and N+1.

**`INFERENCE`**: the service is sufficient for a first read-only Console projection that embeds the library, polls per project, and renders `IssueView`/`ResumeCapsule`/`ProvenanceTrace`. It is not sufficient, unchanged, for a multi-thousand-issue live UI.

---

## 5. Beads → Substrate migration classification (current Console Beads code)

Consumer-side ground truth: `/home/dawid/dev/console-wt/audit-main` @ `4b0d9f57cc90443cf923f22ceac4a4a4f2a5720d`. The Console's own database is `<XTRM_DATA_DIR|GITBOARD_DATA_DIR|~/.agent-forge>/xtrm.sqlite` (`apps/console/src/server/data-dir.ts:34-37`, opened at `apps/console/src/server/index.ts:16`).

| Class | Console path:line | Why |
|---|---|---|
| `REPLACE` | `packages/core/src/state/beads-reader.ts:32` (`class BeadsReader`, SQL over a Beads DB) | Duplicates issue/revision/edge reads that `IssueService` owns; the Substrate equivalent is the typed seam (4.1). |
| `READ_ONLY_COMPATIBILITY` | `packages/core/src/state/beads-jsonl-reader.ts:20` (`readBeadsIssuesFromJsonl`, live `issues.jsonl` with backup-dir fallback) | Exactly the passive-export role `BeadsWorkItemStore` already plays (`src/workitems/beads-store.ts:34-41`). Keep while Beads sources exist. |
| `ADAPT` | `packages/core/src/materializer/beads-adapter.ts:51` (`class BeadsAdapter`), writes `:104` `substrate_issues`, `:116` `substrate_dependencies`, `:118` `substrate_issue_edges` | The materializer pipeline is reusable; only the source port and the target projection change (Beads JSONL/Dolt → Substrate typed reads). |
| `ADAPT` | `packages/core/src/runtime/beads-watcher.ts:103` (`BeadsWatcherRuntime`, poll/debounce constants `:18-22`) | Same watch/publish loop is wanted; the poll source must become a Substrate change feed — **which does not exist yet** (4.3). |
| `ADAPT` | `packages/core/src/state/read-models.ts:25` (`substrate.issue-graph` contract, routes `:29-35`, entity `Issue` `:37-44`) | The contract id and Console route shape should persist; the entity source moves from `legacy-bridge` tables to Substrate-derived projections. |
| `ADAPT` | `packages/core/src/state/bridge-retirement.ts:39-42` (`beads-substrate-projection` temporary bridge) | Retire the bridge once the read-model contract is served natively; the manifest is the right mechanism. |
| `ADAPT` | `packages/core/src/types/beads.ts:3-7` (`Status`/`Priority`/`IssueType` unions) | Needs an explicit mapping to Substrate `LifecycleState`/`IssueKind`/`priority`; note Substrate has **no** `in_progress`, `in_review`, `owner`, or `assignee` field (3.4, 3.9). |
| `ADAPT` | `packages/core/src/state/database.ts:3-21` (`XTRM_TABLES` incl. `substrate_issues`/`substrate_dependencies`/`substrate_issue_edges`), `:322` `createXtrmDatabase` | Console-owned DB; the Beads bridge tables drop out of the table list after cutover, the rest stay. |
| `ADAPT` | `apps/console/src/server/routes/substrate.ts:194` (`createSubstrateRouter`) — `/api/substrate/projects`, `…/issues`, `…/runtime-graph`, `…/stats` | If Console v2 reuses this prefix for Substrate Issues, the issue/vitals routes are rewired to the typed seam; the Dolt-health routes are a separate concern (next row). |
| `READ_ONLY_COMPATIBILITY` | `apps/console/src/server/routes/substrate.ts` repair-actions + `packages/core/src/state/substrate-project-service.ts:35,40` (`readSubstrateProjectConnection`, `readBeadsSourceFacts`) | Dolt pid/port/JSONL health and repair remain useful while Beads sources exist. No Substrate equivalent. |
| `DELETE_AFTER_CUTOVER` | `apps/console/src/server/routes/beads-write.ts:73` (`createBeadsWriteRouter`), `:460` (`spawnBdCommand`) | A `bd`-spawning write path is a second write authority; Substrate forbids dual-write (`src/workitems/store.ts:1-6`, `src/compatibility/beads/import.ts:8`). |
| `DELETE_AFTER_CUTOVER` | `packages/core/src/state/dolt-client.ts` (269 lines) | Dolt transport is a Beads-only concern. |
| `DELETE_AFTER_CUTOVER` | `packages/core/src/runtime/beads-parity.ts` (184 lines) | Beads-vs-Console parity harness; obsolete once Beads is not the source. |
| `RETAIN_TEMPORARILY` | `packages/core/src/runtime/writer-lease.ts:14` (`acquireRuntimeWriterLease`) | Console's own single-writer guard for `xtrm.sqlite`. It duplicates Substrate's `workspace_leases` concept but guards a *different* database, so it is not replaced by `acquireWriterLease` (`src/service/issue-service.ts:1173`). |
| `RETAIN_TEMPORARILY` | `packages/core/src/state/feed-read-model.ts`, `packages/core/src/state/read-models.ts`, `packages/core/src/state/read-models/*` | Console read models stay; only the Beads-sourced fields change. |
| `ADAPT` | `apps/console/src/dashboard/lib/beads.ts` (21 lines), `apps/console/src/types/beads.ts` (156 lines), `apps/console/src/dashboard/hooks/useBeadSideDrawer.ts`, `apps/console/src/dashboard/components/beads/*`, `apps/console/src/dashboard/pages/console/BeadSideDrawer.tsx`, `.../graph/nodes/BeadNode.tsx` | UI keeps its shape; the data source and identity vocabulary swap. `Bead*` naming is a rename candidate, not a correctness issue. |

Cross-reference: if a companion agent owns the Console Beads path inventory, the paths above are the ones this audit relies on. Verified material facts used: Console opens `xtrm.sqlite` (`apps/console/src/server/index.ts:16`), `beads-write` shells out to `bd` (`beads-write.ts:460`), and `/api/substrate/*` is Beads-source health, not `@xtrm/substrate` (3.20).

---

## 6. Gaps / risks for a Console `IssueContract` UI projection

Concrete, with refs. All `VERIFIED` unless tagged otherwise.

1. **No package export contract.** `packages/substrate/package.json:1-54` has no `main`/`exports`/`types`/`module`. A Console adapter cannot depend on `@xtrm/substrate` as a package; it would deep-import `.ts` sources across repo boundaries (the Console already does exactly this for its own core: `apps/console/src/server/index.ts:1`).
2. **Root index omits the readiness surface.** `src/index.ts:1-19` does not export `./domain/readiness.ts`, so `ReadinessReport`, `OperationalState`, `isAttestationCurrent`, `scopeCovers` are unreachable from the package root — the exact types an `IssueContract` view needs to render state and reasons.
3. **`PlanningService` is not exported either** (only reachable at `src/service/planning-service.ts:95`), so any Console-side plan preview/apply must deep-import.
4. **No bulk query surface.** Only `listIssues(projectId)` (`src/service/issue-service.ts:393`). No query by lifecycle state, kind, priority, scrutiny, claim state, deferral window, or across projects. An operations board must fetch everything and filter in the adapter.
5. **N+1 readiness on the hot path.** `SubstrateIssueStore.ready` (`src/workitems/substrate-store.ts:59-64`) calls `getReadiness` per issue; `getReadiness` itself issues 4+ queries (`src/service/issue-service.ts:937-959` → `:810`, `:919`, `:939`). No batched/projection query exists.
6. **No pagination.** No limit/offset/cursor on `listIssues` (`:393`), `listEvents` (`:411`), `listRevisions` (`:405`), or `listActiveEdges` (`:590`). Only journal has a cursor (`src/service/journal-service.ts:193`).
7. **No change feed.** No subscription, SSE, or event-stream surface. A live Console view must poll per issue or poll the whole project. The outbox/inbox tables are provider-bound (`src/service/integration-service.ts:206-352`), not a UI stream.
8. **No process boundary.** The seam is a library over a file; there is no HTTP/socket surface in-package (3.20) and the MCP surface is read tools only (3.17). A Console host must embed the library (sharing the file) or exec `sb`.
9. **No contract diff.** `listRevisions` returns whole revisions (`:405-409`); a "what changed in rev N+1" panel has to compute the diff itself, and must not assume key order (use `hashContract`'s canonicalization rule, `src/domain/contract.ts:33-47`).
10. **No labels / owner / assignee.** `Issue` carries `id, projectId, humanNumber, kind, title, lifecycleState, priority, scrutiny, currentRevision, currentContractHash, deferUntil, createdAt, updatedAt` (`src/domain/issue.ts:20-34`). Console's Beads `BeadIssue` has `owner`, `assignee`, `labels`, `closed_at`, `close_reason`, `related_ids` (`apps/console-wt/audit-main/packages/core/src/types/beads.ts:38-50`). Ownership is only a live claim holder (`src/domain/issue.ts:25` vs `src/service/issue-service.ts:1154`), and there is no label/tag/taxonomy primitive beyond `kind` + `scrutiny`.
11. **No close reason / outcome field.** `setLifecycleState` records only `{from, to}` (`src/service/issue-service.ts:1493`). Beads `close_reason` has no Substrate column; the import carries it on a `beads.imported` event payload only (`src/compatibility/beads/import.ts:243-249`). An issue-detail UI cannot render a canonical closure reason today.
12. **No journal body search or paging.** `listEntries` supports only `kind` + `limit` (`src/service/journal-service.ts:173-189`), newest-last; no full-text query, no `beforeSequence`.
13. **No structured `status` spanning Beads states.** Substrate has no `in_progress` or `in_review`; "claimed" is derived from a live claim row (`src/domain/readiness.ts:140-142`), and "blocked" from unsatisfied `blocks` edges (`:137-139`, `:88-90`). Status columns in the Console must be re-derived, not mapped 1:1.
14. **`expectedRevision` guards are partial** (3.6). If the Console ever becomes a writer, `setLifecycleState`/`setTitle`/`setPriority`/`setScrutiny`/`setDeferral`/`setOwnership`/`setContextRefs` have no optimistic-concurrency parameter; only `updateContract` and the claim path do.
15. **`resolveRef` misses are O(issues).** `findByCurrentLocator` scans every issue and recomputes each locator (`src/service/issue-service.ts:1422-1433`). A Console search box hitting ambiguous refs will be slow and, for a large graph, repeatedly walk the parent chain.
16. **Latent `~/.xtrm/state.db` collision.** Console's `resolveStateDaemonPaths` (`console-wt/audit-main/packages/core/src/state/paths.ts:21`) and `StateClient` (`.../state/client.ts:23`) target the same path as Substrate's `CANONICAL_DB_PATH` (`packages/substrate/integrations/claude-code/runtime.ts:28`). Currently unused in production (only `packages/core/tests/state.test.ts:2,6`), but activating it would place two incompatible schemas in one file.
17. **`/api/substrate/*` is already taken by a different subsystem** (3.20). Reusing the prefix for `@xtrm/substrate` Issues will confuse route-level ownership unless the two surfaces are explicitly separated.
18. **Runtime coupling in `package.json`.** `@xtrm/substrate` depends on `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@modelcontextprotocol/server`, `typebox`, `zod`, `uuid` (`package.json:38-45`). Adding it as a Console dependency pulls Pi/MCP packages unless the entry point is narrowed to `src/**` only.
19. **`BeadsWorkItemStore` reads are never dispatchable by construction** (`src/workitems/beads-store.ts:99-100`). If a Console view is pointed at the compat backend during cutover, every row renders as non-dispatchable with a synthetic reason — correct, but the UI must explain it rather than show an error state.
20. **`ready()` on the compat backend returns `[]`** (`src/workitems/beads-store.ts:118-120`). Any "ready queue" panel must be served by `SubstrateIssueStore` or the Beads source, never by the compat store.

---

## 7. Open questions (`UNKNOWN`)

1. **Which database will the Console v2 adapter read?** Substrate's canonical `~/.xtrm/state.db` (one global store, many projects — `docs/substrate/sbcloseout4-adr.md:88-92`), or a per-deployment DB? Nothing in `packages/substrate/**` constrains the choice; `SUBSTRATE_DB` is the only override.
2. **How will Substrate projects map to Console `repo_slug`?** Substrate keys issues by `project_id` (`prj_<prefix>`, `src/service/issue-service.ts:116`) with an explicit `checkout_links` table (`migrations/007_checkout_links.ts:12-16`) and a 4-source precedence (`resolveProject` `:184-203`). Console keys by `repo_slug` (`console-wt/audit-main/packages/core/src/state/database.ts`, `substrate_issues(repo_slug, issue_id)`). No mapping code exists.
3. **Does the post-cutover ADR change the project-resolution contract?** `docs/substrate/sbcloseout4-adr.md` §4 ("Remove global-cardinality project inference", `:190`) and §6 (`sb init`, `:287`) propose replacing today's "single-project default" (`src/service/issue-service.ts:198-199`). The ADR is **untracked** in the audited SHA, so nothing in it is landed. A Console adapter written against the current `resolveProject` may need rework.
4. **Will Substrate gain a change feed, or will Console poll?** No feed, watcher, or stream exists today (4.3, gap 7). The Console's `BeadsWatcherRuntime` (`console-wt/audit-main/packages/core/src/runtime/beads-watcher.ts:103`) is the incumbent and has no Substrate counterpart.
5. **Will a closure-outcome / close-reason contract land?** The ADR dedicates §41-47 to closure (`:1260-1431`) including close reasons and outcomes, but the audited source has only `{from, to}` lifecycle events (gap 11).
6. **Will Substrate expose a read-only HTTP/MCP surface for a separate-process Console?** Today MCP has 7 read tools with no claim/plan/projection tools (3.17); there is no HTTP surface at all.
7. **Is `~/.xtrm/state.db` shared between Substrate and the planned Console state daemon, or are they deliberately distinct?** `packages/core/src/state/paths.ts:4-5` and `packages/substrate/integrations/claude-code/runtime.ts:28` agree on the literal path; no document in either tree states whether that is intentional (gap 16).
8. **Who consumes `checkDispatch`/`dispatchToSpecialist` in production?** In this repo, tests only (3.19). The Specialists repository is not present in either audited tree.

---

## 8. Resolution notes (XTRM-393, 2026-09-19)

The findings above describe the audited tree at the SHA in §1 and are left as written. Two of them changed on branch `feat/substrate-query-issues`:

- **Gap 4/5 (no bulk query surface, N+1 readiness) — RESOLVED for listing and readiness.** `IssueService.queryIssues(query)` returns one bounded board page with readiness derived in the same pass, and `queryAllIssues(query)` walks every page for callers that must stay exhaustive (`packages/substrate/src/service/issue-service.ts`). Board rows carry `readinessState`/`dispatchable` plus `parentRef`, `parentLocator`, `childCount`, `childrenTerminal` and `blockedBy`, so listing no longer needs `export project` (20.1 s / 22.3 MB on a 4,204-issue project) and no longer needs a separate `issue ready` read. `sb issue list`/`ready`, MCP `issue_list`/`issue_ready` and the Pi issue search read through it; the published 0.2.1 CLI output was verified byte-identical for both verbs on copies of the live store.
- **Gap 6 (no pagination) — RESOLVED for the issue list.** Keyset cursor over the complete ordering tuple (sort key plus tiebreaker) with a filter fingerprint, `--limit` bounded to 500, SQL-level filters for project/lifecycle/kind/parent/search, and a derived-predicate scan that is chunked with an explicit cap. `listEvents`, `listRevisions` and `listActiveEdges` remain unpaginated.
- **Gap 7 / open question 4 (change feed) — STILL OPEN, deliberately deferred.** No consumer exists yet, nothing in the acceptance criteria depends on it, and a feed needs its own semantics (what counts as a change, retention, who polls). Revisit trigger: the drawer's live-refresh work, or any consumer that needs incremental invalidation instead of a re-read. Paging already removes the need to refetch a whole project.
- **`WorkItemStore.ready`/`search` still derive readiness per issue** (`src/workitems/substrate-store.ts:50-64`): those rows return `reasons`, which a board row deliberately omits, so they are out of scope for the projection rather than forgotten.
