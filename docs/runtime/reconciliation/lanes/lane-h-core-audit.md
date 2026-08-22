# Lane H — Core / CLI / planning / Pi extensions / tools audit

Read-only reconciliation audit for the XTRM runtime canonicalization programme (bead `xtrm-cn8`, claimed by this session for lane H output writes).
Repo: `/home/dawid/dev/core` @ `ba3515330b17800e80410f147f9a0d48e467a9c0` (working tree dirty: `.xtrm/registry.json` only).
Companion outputs: `lane-h-planner-modernization.json`, `lane-h-source-register.json`.

---

## 1. Files read completely

All 22 core docs in scope were read end-to-end at the HEAD blob SHAs listed in the source register. The two planning mechanics skills were read fully from `/home/dawid/.pi/agent/skills/` (670 and 542 lines). Canonical-copy status of those skills is §5 below.

## 2. What remains Core-owned (verified against current docs)

| Domain | Authority anchors |
|---|---|
| Install / update / doctor | `architecture/repair-transaction.md`: `xt update` is "the ONE operator-facing verb that reconciles a project's xtrm-managed state"; every phase returns one `ReconciliationOutcome` shape; cleanup is a phase inside `xt update`, never its own verb. `cli-architecture.md` §doctor/update; `command-deprecations.json` schedules removal of `xt bootstrap/clean/pi install/pi doctor/pi reload/claude reload/reinstall/claude doctor` compat surfaces in v0.13.0. `xt doctor` is report-only, never installs. |
| Runtime discovery & compatibility | `runtime-compatibility.json` (`xtrm.runtime-compatibility.v1`): Core requires specialists `>=3.21.0 <4`, xtmux `>=0.1.0 <0.3`, node `>=24`. Enforced at interactive worktree launch **before** worktree creation (`xtrm-7h5xh`); absent sibling is never an incompatibility; `XTRM_SKIP_RUNTIME_COMPAT=1` overrides; deliberately NOT enforced at CLI startup so repair commands keep working on a drifted install. |
| Operator launch UX | `xt-pi-role.md`: `xt pi/claude --role/--bead/--prompt/--subordinate`; worktree+branch isolation enforced by construction in `launchWorktreeSession` (no `--no-worktree`, nested-worktree refusal); turn-1 composition (skill prefix + body + byte guard); position-0 `/` invariant; pane options `@agent_*` with derived `XTMUX_AGENT_*` env ("the two cannot drift"); launch validation before any disk mutation. |
| xt façade | `cli-architecture.md`: `memory` and `merge` are "intentionally thin wrappers around specialists" — CLI owns dependency checks, flags, operator UX only. |
| Package installation | `cli/src/core/pi-runtime.ts` owns the canonical xt-managed Pi package inventory; `assureXtManagedPiPackages()` drives update/apply; provider-injected network-free freshness. |
| Pi extension distribution | `pi-extensions.md`: package-install model, source `packages/pi-extensions/extensions/<name>/`, distribution unit `npm:@jaggerxtrm/pi-extensions`, discovery via `keywords:["pi-package"]` + `pi.extensions`; legacy `config/pi/extensions/**` trees retired. `superseded-designs.md` rejects implicit `-e npm:…` allowlisting in favour of the explicit manifest. |
| Command outcomes | `design/command-outcome-v1.md`: `xtrm.command-outcome.v1` owned by `@xtrm/contracts`; argv authoritative, display derived; no slot for raw prompts/credentials/transcripts/terminal capture; readiness never fabricated (`unverified`), `thread_id=null` until harness exposes it. |
| Runtime capability discovery (future runtimes) | `design/codex-runtime-boundary.md` K1 ledger: Core stays single owner of worktree/branch, thread persistence, sandbox/approval profile exposure, skills distribution for a future `xt codex`; xtmux keeps messages/wakes; Specialists keeps roles/results. Safety rule: "Core must never generate or forward `--dangerously-bypass-hook-trust`". |
| Project/worktree utilities | `xtrm-directory.md` (.xtrm/~/.xtrm layout, global skills SSOT); skills tier machinery (`xt skills list/enable/disable/create-pack`, active views, `state.json`); `xt-topology.md` (read-only projection join across six sources, structural read-only guarantee via `READ_ONLY_COMMANDS`, no duplicate mutable graph, completion never inferred from terminal output, pane capture never transits the command); session reports (`xt report`). |

## 3. What must NOT become Core-owned — claim check

Target non-Core authorities: ChainDefinition compiler, ChainRun scheduler, participant execution protocol, Channels authority, Specialist definition resolution.

Grep result over `docs/`: **no core doc currently claims any of these**. Evidence:

- `interactive-role-envelope.md` — explicit forbidden-field list (`retries`, `stall_timeout`, `overall_job_timeout`, `permission_tier`, `external_command_capabilities`, `background_execution_policy`, `supervisor_restart_policy`): "If Core were to consume them, Core would become a second, competing job supervisor. That is explicitly forbidden."
- `coordinator-branch-ancestry.md` — "Core cannot create specialist branches"; Core publishes `@agent_branch`, Specialists consumes it; per-job lineage lives on Specialists' `SupervisorStatus`.
- `superseded-designs.md` — "Core-owned independent skill-prefix construction" replaced by `sp render-skill-prefix` ("Core consumes verbatim"); "Full Core duplication of Specialist job-supervision metadata" rejected.
- Determinism report §5 authority table: workflow graph/resolver → canonical chain template ("Do not implement separate partial resolvers in Core, xtmux, Specialists, prompts, and Archon adapters"); messages/obligations/monitors/wakes → xtmux; job lifecycle/result → Specialists.
- `command-outcome-v1.md` mentions `ResolvedChain` only as a **negative boundary**: the K2 contract "does not depend on `ResolvedChain`, `specialists.execution.v1`, the chain reducer".

Conclusion: the boundary is currently stated correctly everywhere it is touched; nothing needs to be retracted from core docs.

## 4. Planning direction as written vs target

Current (written, live): intent → clarify → GitNexus explore → structure phases → **mutate the Beads graph directly** (single-invocation `bd create --parent/--deps` board) → test-planning companions → claim first issue. Draft capture mode lowers completeness but not honesty (`contract:draft` beads are undispatchable).

Target (reconciliation programme): intent → authored **ChainDefinition** → review/freeze → **ResolvedChain** → Beads materialization.

Gap analysis:

- No core doc describes the target flow yet. Nearest written precursors: determinism report §10/B1 (canonical chain template → resolved DAG → exact dispatch, one resolver), `issuetracking.md` (issues as executable contracts, validator-gated dispatch, `contract_status ∈ {invalid,partial,ready,waived}` ≈ freeze gate; explicitly "Status: deferred design"), and substrate canon (per lane F): resolved shape persisted as `resolved_chain_json` = completeness contract, close is derivation.
- `command-outcome-v1.md` proves Core can emit versioned outcomes without depending on ResolvedChain today — the seam is additive, not breaking.
- The planning skill's 7-section bead contract is the natural payload of a future ChainDefinition node contract; `validates`/`blocks` edge semantics map onto DAG dependencies; `bd dep cycles` verification maps onto resolver acyclicity checks.

Full extraction with quotes: see `lane-h-planner-modernization.json`.

## 5. Planning-mechanics skill duplication (finding)

Three copies exist; they are **not identical**:

1. `/home/dawid/dev/core/skills/planning/SKILL.md` @HEAD blob `36430e4b` — 451 lines, **older** revision ("GitNexus + Serena", no draft-capture mode, no specialist-chain test trigger).
2. `~/.xtrm/skills/default/planning/SKILL.md` (and `test-planning`) — shipped global SSOT, 670 / 542 lines, **newer** revision (draft-capture mode, telemetry contracts, Trigger-2 specialist-chain authoring).
3. `~/.pi/agent/skills/planning|test-planning/SKILL.md` — runtime copies, **byte-equal to the global SSOT copies** (diff verified).

This contradicts the vendor flow described in `skills-ownership.md` (repo → package payload → global SSOT): the installed SSOT has drifted *ahead* of the repo source. Either the repo copy predates an unpushed commit or the SSOT was hand-edited — both violate the vendor gate. Same-direction drift exists for `test-planning` (repo 465 lines vs SSOT 542).

## 6. Contradictions and staleness

| # | Finding |
|---|---|
| C1 | Skills triplication drift (§5) — repo copy stale vs shipped SSOT. Highest-priority reconciliation item in this lane. |
| C2 | `plans/xtpi-worktree-first-flow.md` (Status: Active) specifies memory-gate ack as marker file `touch .beads/.memory-gate-done`, while current practice documented elsewhere (beads extension close-tracking verifying `memory-acked:<id>` KV; repo agent instructions) uses the KV mechanism. Its auto-commit-on-close contract (`git add -A && git commit "<close_reason> (<id>)"`) also conflicts with the conservative commit policy in current agent instructions. Section 4 (beads-in-worktrees, Dolt server port bootstrap) remains valuable but needs re-verification against current `bd`. |
| C3 | `plans/delegation-architecture.md` (2026-03) — AskUserQuestion/Gemini/Cursor/Droid era; "NEVER executes without explicit user confirmation" doctrine superseded by autonomous specialist-chain orchestration. Not registered in `superseded-designs.md`. |
| C4 | `plans/orchestration-implementation.md` (2026-03) — `.jaggers/` sessions.json, UUID-pinned Gemini/Qwen sessions; predates Specialists/xtmux entirely. Not registered in `superseded-designs.md`. |
| C5 | `memory-system-r6g.md` appendix hook inventory is stale relative to current memory-gate behavior (KV ack vs marker file); research doc self-declares "not a plan of record", so low risk. |
| C6 | Minor duplication (consistent, not conflicting): pi-extension sync behavior tables appear in both `cli-architecture.md` and `pi-extensions.md`; `xtrm-directory.md` restates the extension architecture. Cross-references agree; canonical home = `pi-extensions.md`. |

## 7. Unique requirements that must survive canonicalization

1. Single-shape `ReconciliationOutcome` phase model; `xt update` as the only repair verb; ownership-based deletion ("Do NOT scan a user directory and infer ownership from absence").
2. Interactive-role-envelope narrow boundary + forbidden supervision-field list + tri-state additive versioning rule.
3. Worktree/branch isolation enforced by construction; nested-worktree refusal; no `--no-worktree`.
4. Position-0 `/` invariant, byte guards (50 KB literal prompt / 131071 argv), tmux-buffer transport rules (transport, not secret storage).
5. Message-state vocabulary (unread/acknowledged/pending reply/fulfilled/cancelled) and wake triple semantics; displaying must never consume; read-only bridge principle with the named remote-control preconditions.
6. Topology guarantees: structural read-only, pure projection, no completion inference, no pane-capture transit, independent source degradation ledger.
7. Command outcome: bounded fields, control-char rejection, argv-authoritative actions, no capture/prompt slots, never fabricate readiness/thread id.
8. Merge authority ladder with enforcement table (code vs prompt enforcement distinction); `xt merge` guardrail-not-boundary honesty.
9. Skills survival-by-location contract; user pack homes (`~/.xtrm/skills/<pack>/`, `.xtrm/skills/<pack>/`); RESERVED_PACK_NAMES; loud-fail on user-owned collision.
10. Codex parity safety: profiles recorded from emitted argv, never inferred from hooks; hook trust never bypassed.
11. Planning mechanics quoted in `lane-h-planner-modernization.json` (7-section contract, hierarchy-first creation order, inline typed deps, layer-based test batching, critical-path framing, explicit SCOPE/NON_GOALS collision boundaries, Architecture & Impact Summary handoff).

## 8. Suggested dispositions

| Source | Disposition | Target path suggestion |
|---|---|---|
| architecture/*.md (5 files) | canon-keep | remain Core architecture canon (docs/architecture/) |
| cli-architecture.md | canon-keep (reference) | unchanged |
| xt-pi-role.md, xt-topology.md | canon-keep (authority for launch UX / topology) | unchanged |
| pi-extensions.md | canon-keep; canonical home for extension/package sync behavior | unchanged |
| xtrm-directory.md | canon-keep | unchanged |
| skills-ownership.md (+ .json) | canon-keep; add C1 drift remediation | unchanged |
| xtrm-ui.md | canon-keep (presentation-only reference) | unchanged |
| command-outcome-v1.md, codex-runtime-boundary.md | canon-keep as design contracts (K1/K2) | design/ |
| issuetracking.md | keep as deferred design; feed contract sections into ChainDefinition target spec | design/ |
| memory-system-r6g.md | archive-as-research (already marked not-plan-of-record); refresh stale appendix if revived | design/archive candidate |
| determinism report | keep as authoritative consolidated audit record; internal rule already states final conclusion supersedes historical sections | design/ |
| plans/delegation-architecture.md | archive-superseded + register entry in superseded-designs.md | plans/deprecated/ |
| plans/orchestration-implementation.md | archive-superseded + register entry in superseded-designs.md | plans/deprecated/ |
| plans/xtpi-worktree-first-flow.md | partial-stale: reconcile memory-ack mechanism (C2) and commit policy, then keep §3–§4 (canonical loop, beads-in-worktrees) as canon | plans/, after reconciliation pass |
| runtime-compatibility.json, command-deprecations.json | canon-keep machine-readable contracts | unchanged |
| planning/test-planning SKILL.md (core repo copies) | re-sync: restore repo↔SSOT vendor invariant; designate repo copy upstream, regenerate SSOT via publish flow (C1) | skills/ |

## 9. Open questions

1. C1 root cause: was the global SSOT updated outside the vendor pipeline, or do unmerged commits exist upstream? Determines fix direction (repo pull-forward vs SSOT regeneration).
2. Which component owns ChainDefinition *authoring UX* (evolution of the planning skill) — Core, Specialists, or the substrate? No doc claims it; the determinism report's "one canonical resolver" implies Specialists-side resolution but is silent on authoring.
3. Does Beads materialization replace direct planner `bd create` boards wholesale, or does draft-capture mode (`contract:draft`) survive as the intake format feeding ChainDefinition authoring?
4. Is `.beads/.memory-gate-done` still a live mechanism anywhere, or fully replaced by `memory-acked:<id>` KV (affects disposition of xtpi-worktree-first-flow §4)?
5. Should `issuetracking.md`'s validator-verdict model be promoted into the ChainDefinition freeze gate design, or does substrate `resolved_chain_json` already cover it?

## 10. Evidence paths

- This audit: `docs/runtime/reconciliation/lanes/lane-h-core-audit.md`
- Planner modernization extract: `docs/runtime/reconciliation/lanes/lane-h-planner-modernization.json`
- Source register (24 rows, blob SHAs): `docs/runtime/reconciliation/lanes/lane-h-source-register.json`
- All quoted text verbatim from the registered blobs at core HEAD `ba3515330b17`.

No canonical files modified.
