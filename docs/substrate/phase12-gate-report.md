# Phase 12 — Production Promotion Gate Report (frozen)

**Bead:** `xtrm-7wc.13` · **Base:** `0e180fc` (P11, #134), branch `xt/6okx` · **Date:** 2026-09-09
**Decision: GO** — full 49-case matrix green, all drills green, no numbered-cell reds, no waiver required.
One non-blocking follow-up filed for pre-existing `tsc` hygiene (not a numbered case, blocks nothing).

## 1. Full 49-case matrix re-run (integrated system)

`npm --prefix packages/substrate test` → **127 tests / 49 suites, 127 pass, 0 fail.**
`git status` clean; HEAD `0e180fc`. New-file scope: this report adds no code, modifies no symbols.

| Case | Result | Evidence (test / file) |
|---|---|---|
| A1 title+description only not dispatchable | PASS | `readiness-planning.test.ts` “A1” |
| A2 missing contract field prevents readiness | PASS | same, “A2” |
| A3 structural validity w/o attestation prevents dispatch | PASS | same, “A3” |
| A4 edit invalidates attestation | PASS | same, “A4/adversarial” |
| A5 hidden prompt cannot expand SCOPE | PASS | same, “A5/adversarial” (+ `workitems.test.ts` gate) |
| A6 final blocker satisfied → ready | PASS | same, “A6” |
| A7 reparent preserves IDs, changes locator | PASS | `identity-graph.test.ts` “A7” |
| A8 old locator resolvable as historical | PASS | same, “A8” |
| A9 sibling insert never renumbers | PASS | same, “A9” |
| A10 parent/child + blocks cycles rejected | PASS | same, “cycles (A10)” + `readiness-planning` “B12” |
| B11 one invalid issue commits zero | PASS | `readiness-planning.test.ts` “B11/adversarial” |
| B12 graph cycle commits zero | PASS | same, “B12” |
| B13 ownership overlap reported pre-apply | PASS | same, “B13” |
| B14 idempotent PlanDraft reapply | PASS | same, “B14” |
| C15 concurrent claims, one winner (real procs, WAL) | PASS | `claims-leases.test.ts` “C15” |
| C16 same-holder retry idempotent; draft unclaimable | PASS | same, “C16” |
| C17 live claim anti-steal | PASS | same, “C17” |
| C18 expired claim reclaimable per policy | PASS | same, “C18” |
| C19 one workspace writer | PASS | same, “C19” |
| C20 readers coexist with writer | PASS | same, “C20” |
| C21 coordinator fenced during child writer lease | PASS | same, “C20/C21” |
| D22 mechanical checkpoint before summarization | PASS | `journal.test.ts` “D22” |
| D23 summarizer failure leaves mechanical state | PASS | same, “D23” |
| D24 `since` returns only post-cursor entries | PASS | same, “D24” |
| D25 capsule reconstructs contract+checkpoint+deltas | PASS | same, “D25” |
| D26 Pi compaction failure falls back, checkpoint intact | PASS | `pi-integration.test.ts` “D26” |
| D27 Claude PreCompact writes checkpoint (command hooks only) | PASS | `claude-lifecycle.test.ts` “D27” |
| D28 SessionStart(compact) receives capsule | PASS | same, “D28” |
| D29 root resume references children, no transcripts | PASS | `journal.test.ts` “D29” |
| E30 dispatch binds exact revision/hash | PASS | `provenance.test.ts` “E30” |
| E31 trailers idempotent + SHA binding | PASS | same, “E31-E33” |
| E32 post-commit binds exact SHA | PASS | same |
| E33 amend/rebase reconciled | PASS | same |
| E34 commit → authorizing revision | PASS | same, “E34-E35” |
| E35 trace → commits + PR | PASS | same |
| E36 bundle survives SQLite loss with exact contract | PASS | same, “E36” |
| E37 no executor-forged receipts | PASS | same, “E37” |
| F38 unchanged projection, zero PATCH | PASS | `projections.test.ts` “F38” |
| F39 parent → native sub-issue | PASS | same, “F39/F40” |
| F40 blocks → native dependency | PASS | same |
| F41 intake lands unready draft | PASS | same, “F41” |
| F42 duplicate webhook mutates once | PASS | same, “F42” |
| F43 protected remote edit never silently overwrites | PASS | same, “F43” |
| G44 import idempotent | PASS | `migration.test.ts` “G44” (+ pilot: 191/191 skipped on re-run) |
| G45 Beads ID resolves as alias | PASS | same, “G45/G46” + human-shaped regression |
| G46 thin Bead imports unready | PASS | same (“nothing imported is dispatchable”) |
| G47 export/import preserves revisions + graph | PASS | `export.test.ts` + `migration.test.ts` “G47 regression” |
| G48 no Beads-authority statement post-cutover | PASS | `cutover.test.ts` sweep (8 files + 8 markers) |
| G49 no Dolt/`bd` required post-cutover | PASS | `migration.test.ts` “G49” (real bin, `bd` absent from PATH) |

## 2. Recovery drill (§47, live against the integrated system)

Script exercised the typed service on a scratch WAL DB (run 2026-09-09, `GATE-DRILL ALL PASS`, 10/10):

- **R1 WAL restart:** committed issue + `external.uncertain` event survive close/reopen. PASS
- **R2 expired-claim reclaim:** 50 ms TTL claim reclaimed by second holder after expiry; live claim refuses third holder (`claim-held … anti-steal`); live-holder renew succeeds. PASS
- **R3 lease uncertainty explicit:** second writer refused (`lease-held`); readers coexist (`canReadWorkspace` true); coordinator fenced (`lease-fenced`, C21); live claim + lease survive restart and stay enforced. PASS
- **R4 outbox/inbox retry:** retryable 500 backs off (`pending`, `nextRetryAt` advanced), then sends (`sent`); duplicate inbox `issue-intake` delivery returns `duplicate:true`, mutates once. PASS
- **R5 append-only journal:** sequences monotonic; `since(cursor)` returns only later entries. PASS
- **R6 receipt/external uncertainty:** `external.uncertain` persisted as event; `uncertain` sender outcome marks binding `sync_state=uncertain` with audit event — recorded, never guessed. PASS

Suite cross-refs: `durability.test.ts` (restart, fail-closed schema/migration/tamper, idempotency namespaces), `claims-leases.test.ts` §47 restart case, `projections.test.ts` outbox-retry + uncertainty cases.

## 3. Long-session continuity drill (live)

Three compaction round-trips on one claimed issue — Pi-style checkpoint, Claude-style (PreCompact-equivalent) checkpoint, Pi again — each mechanical-first, then `buildCapsule` verified to carry current contract + latest checkpoint + deltas, then `setLifecycleState(done)`. **L1 PASS.** Suite cross-refs: `pi-integration.test.ts` lifecycle case, `claude-lifecycle.test.ts` compact round-trip case, `journal.test.ts` killed-mid-summarization recovery case.

## 4. Provenance audit (§52 entry points, live)

One lineage built live (dispatch → receipt → SHA bind → PR artifact → checkpoint), then reconstructed from each start: `trace(issue)` returns the SHA + `xtrm-dev/xtrm#241`; `findByCommit(SHA)` returns the receipt; event spine shows checkpoint legs; human ref and locator both resolve to the same issue. **P1 PASS.** Remaining §52 legs ride the frozen evidence: historical Beads ID → G45 alias tests + pilot spot checks (`xtrm-7wc`, `.1`, `.11`); Jira/GitHub binding → F39–F43 + `phase10-conformance.md` binding-stability cases. No leg invented: missing legs render null/empty per `trace()` contract.

## 5. Cutover reversible-safe

- Import path intact: G44/G45/G46/G47/G49 green; pilot record (`phase12-pilot.md`): 191 created, 230 edges, 0 edge errors, 191/191 unready, 0 dispatchable, resume 191 skipped, export→re-import graph-equivalent.
- Read-only compat intact: `BeadsWorkItemStore` reads pass, writes fail closed with the Substrate equivalent named (`workitems.test.ts` beads-compat case); no dual-write (§42).
- Abort/resume procedure stands as recorded in the pilot (re-run import; discard scratch DB; live board untouched). No new migration needed for this gate.

## 6. Gate observables + shared-service conformance + lifecycle purity

- **Observables (live):** `sb issue tree` and `sb issue ready` executed against a live DB via `runCli` — both exit 0 with well-formed `substrate-cli/v1` envelopes; ready set is an array derived from the service. **O1 PASS.**
- **One readiness service:** `IssueService.getReadiness` is the single derivation. Callers: `cli/sb.ts` (show/validate/ready), `integrations/pi/handlers.ts:68`, `src/service/provenance-service.ts:103` (dispatch gate), `src/service/resume-service.ts:66`, `src/workitems/dispatch-gate.ts:51` (`checkDispatch`), `src/workitems/substrate-store.ts:35`. Claude MCP (`integrations/claude-code/mcp-server.ts`) opens `IssueService` in-process and never execs `sb` (asserted by test “no adapter shells out to sb”). No forked gate logic found.
- **Lifecycle evidence not mock-only:** zero `mock|stub|fake` hits in `pi-integration`, `claude-lifecycle`, `journal`, `readiness-planning`, `claims-leases`, `provenance` tests. The only fakes are `FakeSender` (external provider seam) and recorded webhook fixtures in `projections.test.ts` — provider-boundary doubles, not lifecycle substitution; G49 additionally spawns the real `sb` bin. **No mock-substitution waiver required.**

## 7. Known non-blocking finding (not a numbered case)

`npm --prefix packages/substrate run typecheck` reports **35 errors, all in `integrations/pi/extension.ts`** (implicit-`any` host-handler params; file untouched since P6 `91a285c`). Runtime behavior is verified (D26 + lifecycle + full suite green), so this is hygiene debt, not a matrix red. Follow-up bead filed against the P6 owner; it does not block re-vote or promotion.

## 8. Traceability

Contract: `docs/substrate/substrate-issues-v0-prd.md` §§47/48/49/52. Prior phases `.1`–`.12` closed; this gate re-ran their matrices rather than trusting phase-time results. No fixes were made inside this bead per NON_GOALS; no numbered-case reds exist, so no blocking fix children were filed.
