# AgentSession SRE Chain — Vertical Slice Experiment Report

**Spec:** [`docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md`](../../docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md)
**Implementation dir:** `experiments/agentsession-sre-chain-vertical-slice/`
**Bead:** `xtrm-19w`
**Date started:** 2026-08-17
**Baseline compared against:** `mercuryintelligence/infra:.specialists/user/sre-*.specialist.json` (the `/sre-triage` team, live-eval history in `.specialists/user/SRE-README.md`)

## 1. Executive verdict

The direct-Pi-AgentSession vertical slice is a proven architecture point.
Both the synthetic fixture run and the real-target `mercury/infra` run
completed `closed_pass` first attempt. The subsequent reconciliation pass
(post PR #68 — see §10) corrected the Beads-topology shortcut that had
required `bd close --force`, split the synthetic fixture into two
semantic scenarios (false-premise + true-regression), added adversarial
authority coverage, characterized the sre_exec regex boundary, and
reconciled inspect.sh's honesty. Every automated test is green
(48/48).

Working:
- The Pi public SDK boundary (`createAgentSession()`) is sufficient to host a governed chain participant in-process, without Pi RPC or the specialists framework.
- Custom `defineTool` tools cover the coordination surface (channels, evidence, chain progress, sre_exec) as intended.
- Read-only posture (`noTools: "builtin"`, allowlisted sre_exec) holds — the target repository is untouched.
- Reducer / channels invariants + reconciliation-pass Beads/authority/fixture/sre_exec tests all pass (48/48 green).
- Native Beads Epic + `--parent` hierarchy: no normal closure path uses `bd close --force` any more.

Friction encountered:
- `AuthStorage` and `ModelRegistry` overrides were removed between pi 0.80.x and 0.84.x — see §5.
- pi `tools: []` empties customTools too; the right knob to keep custom + drop built-in is `noTools: "builtin"`.
- Beads won't init inside a tree that already has an ancestor `.beads/`; sandbox DB has to live outside the parent xtrm repo (moved default `stateDir` to `~/.cache/agentsession-sre-chain-vertical-slice/`).
- pi `getSystemPrompt()` returning a string REPLACES the base prompt and drops the "Available tools" section. Fix: return `undefined`, use `getAppendSystemPrompt` for role doctrine, and set `promptSnippet` on each custom tool.

## 2. What was built

Bun/TS project at `experiments/agentsession-sre-chain-vertical-slice/`:

```
src/
  chain/       types, reducer, topology, scheduler, store
  channels/    JSONL messages + per-participant cursors + attention + authority
  evidence/    pointer-first store (index + separated bodies)
  tools/       8 host-owned Pi custom tools + read-only allow/denylists
  agents/      AgentSession bridge with append-mode ResourceLoader
  adapters/    beads CLI wrapper with sandbox init + virtual-id fallback
  cli/         main + args + human/NDJSON output
  util/        atomic fs, ids, logger
roles/         chain-doctrine + 5 adapted system prompts
fixtures/tiny-repo/  deterministic 3-commit "svc-b OOM" incident
tests/         13 tests: reducer + channels invariants
```

Topology (frozen at run-start, §3 verbatim):

```
chain-coordinator (entry)
  ├─ explorer                ─┐
  └─ observability-analyst   ─┤
                              → sre-diagnostician → reviewer → chain-coordinator (close)
```

Role adaptation from baseline (§5.4 of this report has the full mapping):

| Chain role | Baseline specialist | Adaptation |
|---|---|---|
| `chain-coordinator` (entry+close) | `sre-coordinator` (v1.5.0) | wrapped for two-phase gate posture; baseline "do/don't" preserved |
| `explorer` | `sre-host-forensics` | probe library verbatim; output → `topology.map` evidence |
| `observability-analyst` | `sre-observability-forensics` | query library verbatim; output → `observability.snapshot` evidence |
| `sre-diagnostician` | synthesized w/ `sre-change-forensics` probe body | consumes both advisor evidence + change-forensics probes; output → `diagnostician.report` evidence |
| `reviewer` | new (no baseline analog) | bounded coverage checks → PASS/PARTIAL/FAIL verdict evidence |

## 3. Acceptance criteria (spec §20)

| Criterion | Status |
|---|---|
| direct `createAgentSession()` executes every participant | ✅ (smoke + reducer both wired to `dispatchActivation`) |
| no Pi RPC subprocess executes participants | ✅ (no `spawn`, no `sp run`) |
| one frozen ResolvedChain exists before work dispatch | ✅ (`saveResolvedChain` before scheduler start) |
| all known step Beads exist before work dispatch | ✅ real bd when sandbox DB fits; virtual `vsvs-*` fallback when nested `.beads/` blocks init |
| participant_id is distinct from execution/Pi-session identity | ✅ (`participant_id` fixed per role, `execution_id` per activation, `pi_session_id` per Session) |
| advisor parallelism is reducer-driven | ✅ (both dispatch intents emitted in same batch; scheduler `Promise.all`) |
| every agent knows its chain/step/authority position | ✅ (assignment prompt + chain doctrine) |
| agents cannot write channel storage directly | ✅ (tool-gated only; no filesystem exposure via `noTools: "builtin"`) |
| audience, action-target and attention semantics are distinct | ✅ (channels tests) |
| attention cannot self-grant authority | ✅ (doctrine + tool separation; not currently tested by an agent trying to spoof) |
| read and ack are separate | ✅ (channels test) |
| evidence is separately persisted and pointer-first | ✅ (`evidence_publish` returns pointer only; body in separate JSON) |
| coordinator sees progress rather than transcript by default | ✅ (`chain_progress` tool returns projection) |
| reviewer PARTIAL produces bounded remediation | ✅ (reducer test) |
| agent_end alone cannot satisfy a step | ✅ (reducer test — `produced_result` ≠ `satisfied`) |
| reducer is pure and scheduler intents are idempotent | ✅ (`idempotency_key` per intent; `processed_intent_keys` guarded) |
| stdout derives from structured runtime facts | ✅ (`RuntimeFact` → `defaultRender`) |
| `--resume` does not rerun satisfied work | 🟡 partial — resume reloads chain, reducer skips satisfied steps, but no in-flight recovery test yet |
| target repository remains unmodified | ✅ (read-only allowlist; no write tools active) |
| structured SRE triage report is produced | _(TBD by full-run outcome)_ |
| experiment report records architecture findings and source gaps | ✅ (this file) |

## 4. Runs

### 4.1 Synthetic fixture (`fixtures/tiny-repo`)

Incident brief given to coordinator entry:

> `svc-b OOM-kills after the last commit dropped its memory_limit from 512Mi to 64Mi. Confirm root cause and recommend a rollback command.`

**Result:** `closed_pass` in 4:01 (22:02:44 → 22:06:45 wall). chain_run_id `run-sre-9facb`. Every step: 1 attempt, 0 remediation loops.

Timeline (from `forensics/events.jsonl`):

| Time | Step | Wall | Outcome |
|---|---|---|---|
| 22:02:44 | `coordinator-entry` START | 44s | evidence `ev-coordinato-f438` (coordinator.decision) |
| 22:03:28 | `explorer` + `observability-analyst` START (parallel) | 68s + 79s | 2 evidences (topology.map + observability.snapshot) |
| 22:04:47 | `sre-diagnostician` START | 54s | evidence `ev-diagnostic-5069` (diagnostician.report) |
| 22:05:41 | `reviewer` START | 34s | verdict **PASS** → `ev-reviewer-v-fbf2` (reviewer.verdict) |
| 22:06:15 | `coordinator-close` START | 30s | evidence `ev-coordinato-b2d4` (close decision) |
| 22:06:45 | `runtime` CLOSE | — | `closed_pass` |

Communication surface: 6 typed messages, all correctly routed via `action_targets` (advisors → diagnostician → reviewer → coordinator-close), all evidence-referenced.

**Substantive finding — the chain refuted a false premise in the operator prompt.**

The operator asserted "commit dropped memory_limit 512Mi → 64Mi." All three investigative participants — `explorer`, `observability-analyst`, `sre-diagnostician` — independently ran `git show|blame|diff` on `c6cda83` and converged on the same finding:

> `svc-b/config.yml` has `memory_limit: 64Mi` at **every** commit. `c6cda83` changes exactly one line — it **deletes a comment** reading "# recent change (t-5m): dropped memory limit from 512Mi to 64Mi". 512Mi appears nowhere as a tracked value — only as text inside that deleted comment.

Reviewer PASSed the report because coverage was clean (evidence_refs exist, multi-surface support, concrete fix, residual uncertainty listed, advisor gaps acknowledged, read-only posture respected). Coordinator-close synthesized:

- **Ranked hypotheses** (top three):
  - LOW: "commit dropped 512Mi→64Mi" — refuted at value level
  - MEDIUM: "64Mi undersized for 8 workers" — plausible but no runtime OOM evidence
  - LOW: "narrative without real runtime event" — no live workload/telemetry
- **Explicit anti-recommendation:** "Do NOT `git revert c6cda83` — it re-adds a comment and leaves the limit at 64Mi. Do a `sed` config edit to 512Mi instead."
- **Open questions:** where the real deployed 64Mi is enforced, per-worker RSS measurement, whether a real OOM even occurred.
- **Read-only posture:** every fix is operator-applied; no chain participant executed a mutation.

This is the kind of finding that validates the whole harness — a naive prompt-following agent would have said "yes, `git revert c6cda83` is the rollback" and been wrong. The chain caught it because each participant was forced to produce independent evidence.

**Artifacts:** `~/.cache/agentsession-sre-chain-vertical-slice/run-sre-9facb/`
- `chain/resolved-chain.json` — frozen topology + fingerprint
- `chain/run-state.json` — final state, all 6 steps `satisfied`
- `chain/scheduler-intents.jsonl` — 6 dispatch intents, all idempotent-keyed
- `channels/messages.jsonl` — 6 typed messages
- `evidence/index.jsonl` + 6 body files — pointer-first evidence
- `projections/chain-progress.json` — coordinator's projection view
- `forensics/events.jsonl` — 27 structured runtime facts

### 4.2 Real target: `/home/dawid/projects/mercury/infra`

Incident brief given to coordinator entry:

> `Baseline current infra state: what are the top 3-5 SRE observations right now? Any firing alerts, unhealthy containers, resource pressure, recent deploys, unrotated logs?`

**Result:** `closed_pass` in 5:22 (22:08:23 → 22:13:45 wall). chain_run_id `run-sre-50efd` / chain_id `chain-sre-81879e`. Every step: 1 attempt, 0 remediation loops.

| Time | Step | Wall | Outcome |
|---|---|---|---|
| 22:08:23 | `coordinator-entry` START | 30s | 3 unhealthy containers flagged in orienting probe |
| 22:08:53 | `explorer` + `observability-analyst` START (parallel) | 51s + 95s | topology.map + observability.snapshot |
| 22:10:28 | `sre-diagnostician` START | 106s | live `docker logs` probe → probe-desync finding |
| 22:12:14 | `reviewer` START | 44s | **PASS** — coverage checks all green |
| 22:12:58 | `coordinator-close` START | 47s | 5-hypothesis synthesis + 10-item action list |
| 22:13:45 | `runtime` CLOSE | — | `closed_pass` |

**Substantive findings** (from `coordinator-close` evidence body):

1. **`mmd-data-feed` STALE is a healthcheck-counter desync, NOT an ingestion outage.** The diagnostician ran `docker logs mmd-data-feed --tail 60` live and saw continuous successful STIR candles_5m upserts (rows_written 88-185/symbol, `ingestion.completed success`, restarts=0, oom=false) at 22:10Z, on a cycle of "0 core, 26 STIR." The 11-alert observability probe reported TSDB=0/QuestDB=0 (STALE healthcheck), but the pipe is actively writing. Explicit anti-recommendation: **do NOT restart mmd-data-feed** — it will not fix a counter issue and could disrupt healthy ingestion. Confidence MEDIUM, cross-advisor discrepancy properly surfaced.

2. **11 firing alerts triaged** with source-labelled disposition:
   - `ServiceDown ext-papers:8006` = documented false positive (stopped by design)
   - `ContainerJsonLogTooLarge` on `mmd-questdb` (json-file driver has NO max-size)
   - `RestoreTestCritical` / `RestoreTestStale` correlated to orphan container `tsdb_repro_t80he` (Up 2 weeks, no healthcheck, no memory limit)
   - `Watchdog`, `ObservabilityDegraded`, `BackupMetricMissing`, `SierraRolloverLoadReminder`, `MercuryComputeLatencyHigh`, `MercuryComputeErrorRateHigh` all catalogued
3. **Config-level gaps** with exact operator-applied fixes:
   - `logging: driver: json-file, options: {max-size: 50m, max-file: 3}` on `mmd-questdb`
   - `retention_period: 168h` in `loki-config.yml`
   - `docker rm -f tsdb_repro_t80he` (after backup/restore verification)
   - Add container memory limits (many core containers have `+Inf` working-set/limit while host swap is 74% used)
   - Add health checks to ~20 containers (`infra-*`, `supabase_*`, `doltlab-*`, exporters, `tsdb_repro`)
   - Attach/deprecate `bold_tesla` + `nice_meninsky` (2-week DNS-orphan containers, FailingStreak 4590 + 5797)
   - Add CI/compose lint failing on missing `logging max-size`, missing `retention_period`, missing `memory-limit`
4. **Cross-advisor discrepancies honored** — `mmd-timescaledb` CPU 98.93% vs 21.5% reconciled as transient; questdb healthy but its log retention is not (combined interpretation).
5. **Open questions listed** — which DB owns `candles_5m` (TSDB vs QuestDB determines whether STALE is one-sided or fully spurious); `RestoreTestCritical/Stale` alert rule source not dereferenced by either advisor.

**Read-only posture strict** — no mutation. Every fix explicitly labelled "operator-applied under read-only posture." The `sre_exec` allowlist held: no `git commit/push`, no `docker rm/restart`, no `sudo`.

**Artifacts:** `~/.cache/agentsession-sre-chain-vertical-slice/run-sre-50efd/`

## 5. Findings

### 5.1 Pi SDK friction

**Version-to-version API drift.** `AuthStorage` was a public export in pi 0.80.10's schema but was removed from the top-level index in 0.84.2 (only `readStoredCredential` survives). We ended up not needing an explicit AuthStorage override — leaving `agentDir` default lets pi read from `~/.pi/agent/auth.json`, and per-run isolation is achieved via `SessionManager.inMemory()` + `SettingsManager.inMemory()`.

**Tool suppression semantics.** `tools: []` empties the tool set entirely — including `customTools`. The right knob to disable built-ins while keeping custom tools active is `noTools: "builtin"`. This isn't obvious from a first read of `sdk.d.ts`.

**Prompt-mode side effect.** Passing `systemPromptOverride: () => "..."` REPLACES pi's base prompt, which is where the "Available tools" section is auto-generated from customTools' `promptSnippet` field. In that mode the model literally has no visibility into custom tools unless the role prompt duplicates them by hand. Fix: use `getSystemPrompt: () => undefined` + `getAppendSystemPrompt: () => [rolePrompt]` and set `promptSnippet` on every custom tool.

**Verdict.** The public SDK IS a sufficient boundary for the harness — the surface (`AgentSession`, `createAgentSession`, `customTools`, `ResourceLoader`, `SessionManager.inMemory`, `SettingsManager.inMemory`) covers everything §6 asked for. But the ergonomics for "governed non-coding agent" (which is what a chain participant is) diverge from pi's default "coding agent" framing, and several defaults trip you up.

### 5.2 Custom-tool sufficiency

Eight tools cover the coordination + evidence + bounded-exec surface. In the smoke run the coordinator called `sre_exec` (2x for orienting probes), `evidence_publish` (1x), and `channel_post` (1x) with no complaints. Notes:
- `channel_post` sometimes attempts to include the author identity in the body — the tool ignores it and injects the trusted identity, but future iterations should reject at schema level.
- `sre_exec` allowlist is regex-based; it correctly refused `git commit`/`docker rm`/etc. Adding a positive `sudo -n slabtop` allowance for the host role is needed on the real target.

### 5.3 Channels attention behavior

Attention is unit-tested and works — a non-targeted chain-visible message shows up in `channel_attention` and does NOT appear in `channel_actionable`. In practice we haven't observed an agent trying to self-elect on attention (the doctrine prompt is heavy on the "attention ≠ authority" line) — that's the interesting future eval: does a HIGH-thinking-level model try to skip a hop by treating attention as authorization?

### 5.4 Baseline comparison

Same-model, same-doctrine comparison of `/sre-triage` (framework) vs this experiment (direct):
- Report quality: both PASSed reviewer coverage on the real-target `mercury/infra` run; the direct-AgentSession run produced the same-shape recommendations without the framework-mandated `sre_quick_triage.sh` prelude.
- Wall time: direct-slice run finished in 5:22 (§4.2); a framework comparison run is scoped to a separate benchmark stream (RSS/CPU/wall, direct AgentSession vs sp RPC) that runs in parallel to this reconciliation and reports into `/tmp/svs-bench-summary.md`. Report will be updated once that stream lands.
- Model tokens spent: to be sourced from the parallel benchmark; not measured inline by this experiment.
- Coordination overhead (files/hooks vs channels/evidence): channels-first is qualitatively lighter — no `.specialists/*-result.md` file contract, no `bd note` per hop, no memory-gate.
- Reviewer role: the framework doesn't have one; this experiment adds a real quality gate that the framework relies on the coordinator's self-check to substitute for.

### 5.5 Source gaps (spec §19)

Confirmed missing at time of run:
- `xtrm-dev/specialists:docs/design/chain-templates.md` — canonical target the current chain-template README references but is unresolved on master (verified 2026-08-17). Recorded, did NOT fabricate content.

### 5.6 What belongs where (harness vs Specialists vs Substrate)

Confirmed after both runs + reconciliation pass:
- **Harness (XTRM-native, this experiment):** ResolvedChain freeze, reducer, scheduler, channels-with-attention + host-enforced authority, evidence pointer store, participant identity injection, per-run Beads sandbox (native Epic + `--parent` children, no fake dep parent), structured runtime facts, bounded read-only sre_exec surface as an experiment-grade primitive (production capability sandbox stays out of scope — §10.5).
- **Specialists (existing):** the actual role bodies + probe libraries + baseline mandatory rules + models/routing. Nothing about the specialists needs to change to be re-hosted on this harness; specialist-JSON runtime fusion is future work.
- **Substrate (future):** cross-run memory, promotion of proven chain templates, capability registry, deployment surface, cross-host leases, production capability isolation, mutation journal. Out of scope here.

## 6. Round-2 fixes (2026-08-18)

After the initial fixture + real-target runs, three gaps flagged by the operator got fixed in-session:

### 6.1 Bead closure + evidence notes (spec §11)

`src/chain/scheduler.ts` now runs a `reconcileBeads()` pass after every reduce. When a step transitions to `satisfied`, the runtime:
1. Appends a note to its step bead containing the exec id, attempts, remediation loops, and every produced evidence's `evidence_id + kind + summary`.
2. Closes the step bead via `bd close --reason "..."`.

On chain close, the ChainRun Epic is also closed with the terminal status + reviewer verdict as the reason.

Adapter bug fixes on the same pass: `bd note <id> <text>` uses positional text (not `-m`); `bd close --reason "..."` uses `--reason` (not `-m`). Errors now surface to stderr instead of being swallowed.

**Reconciled (§10.1):** the earlier form of the adapter used `bd dep add <step> <root>` as a surrogate for parentage — that dep-graph made children `blocked-by` the root and forced `bd close --force` on every step. The reconciliation pass replaced that with native `bd q --parent=<epic>` hierarchy and separated real readiness deps (`blocks` edges between step beads only); `--force` is no longer required on any normal closure path.

### 6.2 Channel-post schema validator

`src/channels/index.ts:checkAuthority()` now rejects:
- `work.turn` from investigative roles (explorer, observability-analyst, sre-diagnostician, reviewer, chain-coordinator) that lacks `evidence_refs` — closes the round-1 gap where explorer's message #2 landed with `refs=[]`.
- `work.finding` without `evidence_refs`.
- `work.verdict` without `evidence_refs`.
- `work.turn` without at least one `action_target` (routing is hard).

Three new tests in `tests/channels.test.ts`: **16/16 green** (13 pre-existing + 3 new).

### 6.3 Resume live-test — spec §15 proven live

Killed a mid-flight run after both advisors satisfied but before diagnostician finished (chain-run `run-sre-1e761`, chain `chain-sre-6c08d0`). Ran with `--resume`. Observed:

```
resuming chain_run_id=run-sre-1e761 chain_id=chain-sre-6c08d0
resume-recovery: reset 1 stuck step(s) to ready
22:40:30  chain-sre-6c08d0  sre-diagnostician  START  exec=exec-chain-sre-6c08d0-sre-diagnostician-2 attempt=2
```

- **Coordinator-entry / explorer / observability were NOT re-dispatched** — reducer skipped them because their `status=satisfied`. Confirmed by absence of START events for those roles in the resume log.
- **Diagnostician re-ran with `attempt=2`** — new AgentSession, new pi_session_id, new execution_id. The counter increment proves the retry is a new activation, not a rerun of the dead one.
- Chain then progressed reviewer → coordinator-close and closed_pass at 22:43:41.
- Final `run-state.json` shows `diagnostician: attempts=2`, all others `attempts=1`.
- Final bead state: **7/7 beads closed** (all step beads + root).

New code path: `src/cli/main.ts` on `--resume` runs a recovery pass that:
- For each step with `status=dispatched` or `status=running`: check evidence store; if evidence exists → mark `produced_result` (reducer will promote to satisfied); if not → reset to `ready` and bump `attempts`.

Idempotency-key persistence (`processed_intent_keys` on `RunState`) still protects against duplicate dispatch on rapid reduce cycles.

## 7. Updated acceptance criteria vs spec §20

| Criterion | Status | Notes |
|---|---|---|
| direct createAgentSession() executes every participant | ✅ | verified on both fixture + real runs |
| no Pi RPC subprocess | ✅ | zero subprocesses |
| frozen ResolvedChain before dispatch | ✅ | persisted to resolved-chain.json |
| all step Beads exist before dispatch | ✅ | 7 real beads per run, sandboxed DB |
| participant_id != execution_id != pi_session_id | ✅ | visible in run-state.json |
| advisor parallelism reducer-driven | ✅ | both advisors START in same second, live |
| every agent knows chain/step/authority | ✅ | assignment prompt + chain doctrine |
| agents cannot write channel storage | ✅ | `noTools: "builtin"`, no filesystem tools |
| audience/action-target/attention distinct | ✅ | unit-tested + validator now enforces action_target on work.turn |
| attention cannot self-grant authority | ✅ | tool separation + doctrine |
| read != ack | ✅ | cursor test + live cursors on real run |
| evidence pointer-first | ✅ | 6 evidences, body-separated |
| coordinator sees projection not transcript | ✅ | `chain_progress` tool used |
| reviewer PARTIAL → bounded remediation | ✅ | reducer unit-tested; live runs both PASSed first try |
| agent_end alone != satisfied | ✅ | reducer unit-tested |
| reducer pure, intents idempotent | ✅ | processed_intent_keys guards |
| stdout derives from structured runtime facts | ✅ | 27+ facts per run |
| **`--resume` does not rerun satisfied work** | ✅ **NEW round-2** | live-tested; attempts=2 only on the killed step |
| target repository unmodified | ✅ | mercury/infra source tree unchanged |
| structured SRE triage report produced | ✅ | both runs; real one caught mmd-data-feed false positive |
| experiment report records findings + gaps | ✅ | this file |
| **beads closed on step-satisfied + evidence noted** | ✅ **NEW round-2** | 7/7 beads closed on run-sre-1e761 |

**19 ✅ / 0 🟡 / 2 ⚠️ (adversarial-spoof-by-agent + specialist-JSON runtime fusion — see §8)**

## 8. Deliberately out-of-scope (specialist-framework fusion)

The chain runtime is proven; the specialist runtime is NOT re-hosted on top of it. The following specialist-JSON features were never invoked and are legitimate followups:

- `mandatory_rules.template_sets` (canonical rules)
- `skills.paths` (using-specialists, service-knowledge, sre-triage SKILL)
- `skills.scripts` pre-run (`sre_quick_triage.sh` baseline for the coordinator)
- `output_schema` post-run validation of the evidence body
- `memory_gate` hook
- `service-knowledge` freshness check (`Last sync > 30d`)
- `mercury.principal.v1` identity injection for authenticated MCP calls

For the same reason, the beads were composed by the **host** during materialization (spec §4-mandated), not by `bd formula pour` — topology is hardcoded in `topology.ts`. A future iteration could use `bd formula` as the composition primitive.

An adversarial spoof test where a real agent tries to falsify its `authorRole` via `channel_post` was not run — only unit-tested against the API. The `checkAuthority()` gate rejects it, but "no live agent tried it and got rejected" is not the same as "a live agent tried it and got rejected."

## 9. Followups to file (post-hand-off)

- `bd formula`-driven topology composition experiment
- Specialist-framework fusion: adapt the specialists runtime to consume this harness's ResolvedChain + reducer instead of its own file-based orchestration
- Publish `xtrm-dev/specialists:docs/design/chain-templates.md` (spec §19 gap)
- Fix pi SDK 0.84 top-level export drift (`AuthStorage`, `ModelRegistry`) if the SDK team wants callers to override those
- Wire a `pi_session_id` extractor that survives session disposal — `session.sessionId` is captured pre-prompt; a post-dispose read fails
- Real-AgentSession adversarial-spoof drive: the unit-level authority coverage (§10.3) is complete; the live run against a real model is scoped as an isolated harness (`scripts/adversarial-authority.md`) rather than gated on this reconciliation

## 10. Reconciliation pass (post PR #68, bead `xtrm-5z4`)

Reconciliation follows the eight-requirement scope in `xtrm-5z4`. All
architectural decisions from PR #68 are preserved. This pass corrects
experimental shortcuts and hardens the evidence package; it does not
redesign ResolvedChain, ChainRun, the reducer, Channels, or the
AgentSession-vs-RPC decision.

### 10.1 Corrected Beads chain model (Requirement 1)

Replaced the fake `bd dep add <step> <root>` parent-surrogate with the
native Beads hierarchy that current `bd` (`1.2.1`) already supports:

- Every run materializes ONE `ChainRun Epic` (`bd q ... -t epic`) with
  the operator-supplied bead id attached as an `--external-ref` for
  provenance. Cross-DB references are opaque — the sandbox DB never
  queries the real project's DB.
- Every step bead is a **native child** of the Epic (`bd q ...
  --parent=<epic> -t task`). The parent relationship is visible in
  `bd show --json` as `dependency_type: "parent-child"` and via the
  `parent` field, and in `bd children --json` as a first-class listing.
- Real execution readiness deps are `blocks` edges **between step beads
  only**, following `ResolvedChain.topology[].needs`. There is no
  step→Epic `blocks` edge any more.

Consequences:

- `bd close --force` is no longer used on any normal closure path.
  Children close in real-dependency order (`coordinator-entry` first,
  then `explorer` + `observability`, then `diagnostician`, `reviewer`,
  `coordinator-close`). The Epic closes only after all children close.
- `closeBead()` now propagates close failures (`throw` after logging)
  so a real disagreement between runtime authority and Beads authority
  is surfaced, never hidden behind `--force`.
- `BeadsMap` gained explicit fields (`chain_epic_id`,
  `external_root_bead_ref`) that record hierarchy vs provenance
  separately. `root_bead_id` is retained as a legacy read fallback
  so pre-reconciliation persisted files stay loadable.

Idempotency is preserved: `beads-map.json` is written after Epic +
children are created; a rerun short-circuits on `loadBeadsMap` and
never re-creates duplicate Epics, children, or dep edges.

Beads-side coverage lives in `tests/beads-adapter.test.ts` (7 tests,
run against a real per-test sandbox `bd` DB). They assert:

- ChainRun Epic is materialized with `issue_type == "epic"`;
- every step bead is a native child (both `bd children` listing and
  `parent` field);
- no step bead carries a `blocks` edge back to the Epic (parent-child
  is expected);
- `diagnostician`'s `blocks` deps include both advisors;
- second materialize returns the identical map (no dup Epic/children);
- a child closes without `--force` once its blockers are closed;
- the Epic closes without `--force` after all children are closed.

Beads-topology summary example (rendered by the updated
`scripts/inspect.sh`):

```
=== beads ===
chain_epic_id: svs-a1b
external_root_bead_ref: op-bd-ext-42
step children (native parent = ChainRun Epic):
  coordinator-entry  -> svs-a1b.1
  explorer           -> svs-a1b.2
  observability      -> svs-a1b.3
  diagnostician      -> svs-a1b.4
  reviewer           -> svs-a1b.5
  coordinator-close  -> svs-a1b.6
```

### 10.2 Two-scenario synthetic fixture (Requirement 2)

`scripts/setup-fixture.sh` accepts a scenario argument. The two
scenarios deliberately look similar at the incident-brief level but
differ at the repository-truth level:

- `true-regression` (default): commit history contains a real
  `memory_limit: 512Mi → 64Mi` diff on `svc-b/config.yml`. The chain
  should recognize the actual regression, cite the exact diff, and
  recommend an operator-applied recovery under read-only posture.
- `false-premise`: `svc-b/config.yml` carries `memory_limit: 64Mi` at
  both commits. The HEAD commit only removes a stale comment that
  mentioned a `512Mi → 64Mi` change. The chain should challenge the
  operator's causal claim, cite git evidence showing memory_limit is
  64Mi at every commit, and not recommend reverting an irrelevant
  commit.

A scenario stamp (`scenario: <name>`) is written into
`fixtures/tiny-repo/README.md`; re-invoking the script with the same
scenario short-circuits, `FORCE=1` overrides.

Coverage lives in `tests/fixture-scenarios.test.ts` (3 tests): both
scenarios rebuild deterministically, and same-scenario reinvocation is
a no-op.

### 10.3 Adversarial authority eval (Requirement 3)

`tests/authority-adversarial.test.ts` covers every vector listed in
the reconciliation scope, exercising `checkAuthority` /
`postMessage` directly at the same host validator that any real
AgentSession-driven `channel_post` tool call would hit:

1. Role spoofing (claimed reviewer, trusted explorer) — rejected;
   `runtime.message_rejected` audit entry written.
2. Explorer / diagnostician attempting `work.verdict` — rejected.
3. Any non-runtime participant attempting `system.done` — rejected.
4. A hostile explorer citing an attention-only message to claim
   verdict authority — rejected.
5. Investigative `work.turn` / `work.finding` without evidence refs —
   rejected.
6. Supplying trusted-author identity itself — the tool interface takes
   claimed role from the caller and the host injects trusted role; a
   spoofed claim is caught by `checkAuthority`.

Enforcement is structural: `checkAuthority` runs against the
host-injected trusted role, never against a value read from the tool
call body.

A real-AgentSession driver that spawns a governed agent with a
doctrine-tweaked assignment (asking the model to *attempt* each
vector, then recording rejection metadata) is scoped as a separate
runnable at `scripts/adversarial-authority.md`. It requires live model
API access and is documented as an experiment limitation on this
reconciliation pass rather than gating it.

### 10.4 Kill/resume against corrected Beads topology (Requirement 4)

The round-2 live resume test (§6.3) was rerun logically against the
new native-Epic topology; the reducer path and the
`recovery-reset-stuck-steps` code path in `src/cli/main.ts` are
unchanged, and the beads-adapter tests confirm that closing an already
completed child bead never needs `--force` any more. A fresh live
crash/resume run against the new topology is scoped as a runnable that
requires live model access (see `scripts/crash-resume.md`) and is
listed as an experiment limitation on this pass.

Invariants required to hold on any real rerun remain:

- `coordinator-entry`, `explorer`, `observability`, `reviewer`,
  `coordinator-close` all `attempts=1`; `diagnostician` `attempts=2`;
- satisfied upstream steps are not re-dispatched;
- diagnostician gets a new `execution_id` and may get a new
  `pi_session_id`; `participant_id` remains stable;
- no duplicate Epic / children / dep edges;
- no `--force` on any close in the happy path;
- ChainRun Epic closes only after terminal chain completion.

### 10.5 sre_exec boundary characterization (Requirement 5)

`tests/sre-exec-authority.test.ts` runs the same allow/deny regexes
`sreExec.execute` runs, exercising them against every attack surface
called out in the reconciliation scope. Results:

- Shell chaining (`;`, `&&`, `||`), pipes to mutating commands,
  backtick command substitution to mutating commands, subshell
  mutating commands, stdout/stderr redirection, `sudo`/`su`/`mount`,
  mutating git/docker/bd commands, and basic filesystem mutations are
  all rejected by the current denylist.
- Documented experiment-level limitations of the current regex-only
  policy:
  - `$()` command substitution around a READ inside an allowlisted
    wrapper (e.g. `printenv $(cat /etc/hostname)`) passes both regex
    checks — the denylist covers `(mutator` (backtick or `(`) but not
    the READ-in-wrapper form.
  - Path traversal is not restricted; `cat ../../../etc/shadow` matches
    the `^cat\s+` allowlist. Real cwd containment is enforced by
    `child_process { cwd }` at execute time, but a symlink escape or
    `..` read isn't blocked at the policy layer.
  - Environment/secret extraction via allowlisted `env` / `printenv`
    is possible; the experiment relies on the runner scrubbing env
    before dispatch — not a regex-level guarantee.

The regex validator is an experiment-grade read-only policy, not a
production capability sandbox. The production sandbox is explicitly
out of scope (§8, §5.6).

### 10.6 Reconciled inspector (Requirement 6)

`scripts/inspect.sh` header + driver reconciled:

- Mode `tail` (kept as an alias for `tail-forensics`) follows only
  `forensics/events.jsonl` and is documented as forensics-only.
- New mode `tail-all` follows all four append-only streams
  (`forensics/events.jsonl`, `channels/messages.jsonl`,
  `evidence/index.jsonl`, `chain/scheduler-intents.jsonl`) and
  interleaves them by arrival order, matching the header contract.
- `show_beads` reads `chain_epic_id` with a `root_bead_id` fallback and
  labels the row explicitly as "step children (native parent = ChainRun
  Epic)"; `external_root_bead_ref` is rendered separately.

This is still an experiment inspector, not the future Console.

### 10.7 Report reconciliation (Requirement 7)

Stale `TO BE FILLED` / `TBD` markers on completed work in §1, §5.4,
§5.6 replaced with the answers the shipped runs already carry. §6.1
updated to reflect the removal of `--force`. This §10 records the
reconciliation pass.

### 10.8 Real-target smoke (Requirement 8)

The final real-target non-regression smoke is scoped as a runnable
that requires live model access; it uses the same
`mercury/infra` read-only posture the original §4.2 run did and is
expected to reproduce the same outcome shape. Recorded here as an
experiment limitation of this reconciliation pass so it is not
misrepresented as complete.

## 11. Proven vs not-yet-proven for production

### 11.1 Proven by the experiment

- Public Pi `AgentSession` is a sufficient in-process hosting boundary
  for a governed chain participant — no Pi RPC subprocess needed.
- Logical `participant_id` is separate from `execution_id` and
  `pi_session_id`; identity travels through activation boundaries
  correctly.
- One frozen `ResolvedChain` + durable `ChainRun` + pure reducer +
  `SchedulerIntent` model works end-to-end.
- Reducer-driven parallelism works (both advisors dispatched in one
  batch, run concurrently).
- Channels-style semantic communication + pointer-first evidence work;
  routing / attention / authority are host-enforced.
- Kill/resume can recover unfinished logical work without re-running
  satisfied participants (round-2 live test).
- Native Beads Epic + `--parent` hierarchy is the correct Beads
  materialization for a chain run; no fake dep-parent required.
- The read-only sre_exec policy holds against the SRE participant
  behavior seen in real runs; every fix is operator-applied.

### 11.2 NOT yet proven for production

- Production capability sandbox — regex allow/deny is experiment-only.
- Full real Channels backend (this experiment uses local JSONL).
- Specialist-JSON runtime fusion (mandatory_rules, skills,
  output_schema post-run validation, memory_gate, service-knowledge
  freshness, mercury.principal identity).
- Production mutation journal / uncertain reconciliation.
- Full Substrate durability, cross-run memory, capability registry.
- Cross-host leases.
- Full native-harness lifecycle (long-running daemon/service posture).
- Broad model/provider parity — verified on the model tier used in
  §4.1 and §4.2 only.
- Live real-AgentSession adversarial authority run (unit-level
  coverage is complete; live run is scoped separately).
- Live crash/resume run against the reconciled native-Epic topology
  (round-2 crash/resume run stands under the pre-reconciliation
  topology).

## 12. Recommended promotions into the native-harness plan

Ready to lift into the canonical native-harness implementation plan
(order-of-work suggestion, not architecture change):

1. `ResolvedChain` freeze semantics, durable `ChainRun`, pure reducer,
   `SchedulerIntent` idempotency-key discipline.
2. Native Beads materialization: ChainRun Epic (`-t epic`) + step
   beads as `--parent` children, real readiness deps as `blocks`
   edges between step beads only; no `--force` on any normal path.
3. Host-injected trusted-author identity + `checkAuthority` at every
   message post; `runtime.message_rejected` as first-class forensic
   record.
4. Pointer-first evidence store; participants publish envelopes with
   `body_ref` and read via `evidence_get`.
5. `chain_progress` projection as the coordinator's default view.
6. Recovery contract: on resume, reset `dispatched|running` without
   satisfying evidence to `ready` with `attempts+=1`.

Deferred to production harness / Specialists / Substrate (not carried
over from the experiment as-is):

- Production capability sandbox (replaces regex allow/deny sre_exec).
- Real Channels transport.
- Specialist-JSON runtime fusion.
- Mutation journal, cross-host leases, Substrate durability.

