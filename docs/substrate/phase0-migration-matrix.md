# Phase 0 — Migration matrix (frozen)

**Bead:** `xtrm-7wc.1` · **PRD freeze:** `ca3ae04` (merge #121) · **Date:** 2026-09-09
**Sources:** `phase0-beads-surfaces.md`, `phase0-specialists-assumptions.md`,
`phase0-runtime-assumptions-placement-inputs.md`, PRD §§41–43.

Format: `Beads concept → Substrate concept → disposition`.
Dispositions: `native` (Substrate replacement) · `neutral` (backend-neutral
WorkItemStore adaptation) · `compat` (Beads compatibility only) ·
`retired` · `memory` (memory-lane migration).

## Authority and dispatch

| Beads concept | Substrate concept | Disposition |
|---|---|---|
| Bead as authoritative tracked work (7-section contract + SCRUTINY) | Issue revision + contract hash + readiness attestation (§§9–12) | native |
| `specialist_delegate({specialist, bead})` dispatch key | `specialist_delegate({specialist, issueId + issueRevision + contractHash})`, shared readiness service (§39) | native |
| Bead dispatch gate (`dispatch-gate.ts`, §12 Specialists PRD) | Substrate readiness service — structural validation + semantic attestation, one gate for CLI/integrations/runtime (§12) | native |
| Forensic refusal citing bead + reason | `dispatch.rejected` issue event + requesting participant/issue/gate/reason (§19) | native |
| `provenance.sourceBeadRevision?` optional pin | Execution binding `issue_id + issue_revision + contract_hash + resolved_context_hash` (§26) | native |
| StepContract derived from ready root Bead | StepContract derived from ready root Issue revision; still no second work graph (§39) | neutral |
| `--bead <id>` CLI/role flag (`xt-pi-brief` §5–6) | `sb issue` ref accepting machine ID / `XTRM-NNN` / locator / historical locator / alias (§36) | native |
| `contract:draft` intake convention (runtime ADR-001, Q6) | Draft Issue (structurally/semantically unready, fail-closed, §12–13) | native |
| Chain→Beads materialization after freeze (R1/R6/Q5) | Chain→Substrate materialization after freeze via atomic `plan apply` (§16); Beads materializer retired | native |

## Claims, leases, state

| Beads concept | Substrate concept | Disposition |
|---|---|---|
| `bd update --claim` atomic claim + lease/expiry/anti-steal | Issue claim: atomic CAS, idempotent re-claim, renewable lease, expiry, lost-race (§17) | native |
| Workspace ownership (implicit today) | Workspace writer lease, max one writer per worktree, coordinator fenced (§18) | native |
| `status=in_progress/blocked` stored flags | Derived operational state: terminal → deferred → draft → blocked → claimed → ready (§13) | native |
| `blocks` edges, cross-DB refs opaque (R6/Q6) | `blocks` acyclic relation (readiness-affecting) + non-blocking `relates_to/discovered_from/supersedes/duplicates` (§14) | native |

## Journal, provenance, compaction

| Beads concept | Substrate concept | Disposition |
|---|---|---|
| Markdown handoffs / checkpoint docs / ad-hoc task lists | Issue-scoped Work Journal: checkpoint/handoff/milestone/decision/finding/blocker/compaction (§20) | native |
| `beads-compact-save/restore.mjs`, `bd codex-hook PreCompact/PostCompact` | `session_before_compact` mechanical checkpoint → optional semantic checkpoint → Resume Capsule (§§20–24) | native |
| `bd prime --hook-json` SessionStart injection | `sb issue resume` capsule injection incl. Claude `SessionStart(source=compact)` additionalContext (§§21, 24) | native |
| Commit/PR prose as lineage | Execution bindings + WorkReceipts + `XTRM-Issue/Revision/Receipt` trailers + post-commit/post-rewrite hooks + provenance bundles (§§26–29) | native |

## Projections and sync

| Beads concept | Substrate concept | Disposition |
|---|---|---|
| GitHub/Jira as ad-hoc references | Native GitHub projection (sub-issues, dependencies, types, fields) + selective Jira projection + stable external bindings (§§31–33) | native |
| `bd dolt push/pull`, `refs/dolt/data` sync; pre-push/post-merge `.bd-sync` hooks | Outbox/inbox with idempotency keys, mapped content hash, drift/proposal on conflict (§34); Dolt sync retired with Beads | retired |
| `bd export --all` snapshot (board-audit) | JSON/JSONL/Markdown/Mermaid/HTML projections + portable export bundles (§7.2); G47 revision+graph equivalence | native |

## Compatibility and cutover

| Beads concept | Substrate concept | Disposition |
|---|---|---|
| Historical Bead IDs in commits/PRs/reports | Durable aliases: Bead IDs resolve indefinitely (§§8.5, 42.3) | compat |
| Current Beads board content | `sb import beads`: idempotent, alias-preserving, thin work imports as unready (§42.1) | compat |
| WorkItemStore seam (Phase A transition) | `WorkItemStore` with `SubstrateIssueStore` canonical + `BeadsWorkItemStore` temporary (§35) | neutral |
| `bd` in agent instructions (`/planning`, `/using-xtrm`, triage, AGENTS.md/CLAUDE.md, Codex setup, gates) | `using-substrate` skill + backend-neutral adaptation, then Substrate canonical; per-surface disposition per §41 inventory | neutral → native |
| `bd memories/*`, `bd remember`, memory-ack gate | Phase 1–2: `bd` memory stays readable; Journal findings → memory candidates → future XTRM memory (§§25, 43); memory-ack gate re-homed, not dropped | memory |
| Beads stop/edit/commit/claim-sync/compact gates | Substrate-native gates on the readiness/claim/revision service (§§17, 46) | native |

## Coverage statement

Every Beads authority assumption in the three frozen census files maps to exactly
one row above. No assumption is left without a disposition. `contract:draft`
intake, freeze-before-materialization, and no-prompt-smuggling survive the
migration as native Substrate semantics, not compatibility shims.
