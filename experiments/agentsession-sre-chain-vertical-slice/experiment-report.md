# AgentSession SRE Chain — Vertical Slice Experiment Report

**Spec:** [`docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md`](../../docs/harness/experiments/agentsession-sre-chain-vertical-slice-2026-08-17.md)
**Implementation dir:** `experiments/agentsession-sre-chain-vertical-slice/`
**Bead:** `xtrm-19w`
**Date started:** 2026-08-17
**Baseline compared against:** `mercuryintelligence/infra:.specialists/user/sre-*.specialist.json` (the `/sre-triage` team, live-eval history in `.specialists/user/SRE-README.md`)

## 1. Executive verdict

_(TO BE FILLED after fixture + real-target runs return)_

Working:
- The Pi public SDK boundary (`createAgentSession()`) is sufficient to host a governed chain participant in-process, without Pi RPC or the specialists framework.
- Custom `defineTool` tools cover the coordination surface (channels, evidence, chain progress, sre_exec) as intended.
- Read-only posture (`noTools: "builtin"`, allowlisted sre_exec) holds — the target repository is untouched.
- Reducer / channels invariants pass their unit tests (13/13 green).

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

_(TO BE FILLED after both runs)_

Same-model, same-doctrine comparison of `/sre-triage` (framework) vs this experiment (direct):
- Report quality: TBD
- Wall time: TBD
- Model tokens spent: TBD
- Coordination overhead (files/hooks vs channels/evidence): channels-first is qualitatively lighter — no `.specialists/*-result.md` file contract, no `bd note` per hop, no memory-gate.
- Reviewer role: the framework doesn't have one; this experiment adds a real quality gate that the framework relies on the coordinator's self-check to substitute for.

### 5.5 Source gaps (spec §19)

Confirmed missing at time of run:
- `xtrm-dev/specialists:docs/design/chain-templates.md` — canonical target the current chain-template README references but is unresolved on master (verified 2026-08-17). Recorded, did NOT fabricate content.

### 5.6 What belongs where (harness vs Specialists vs Substrate)

_(TO BE FILLED after we see the full run)_ — early read:
- **Harness (XTRM-native, this experiment):** ResolvedChain freeze, reducer, scheduler, channels-with-attention, evidence pointer store, participant identity injection, per-run beads sandbox, structured runtime facts.
- **Specialists (existing):** the actual role bodies + probe libraries + baseline mandatory rules + models/routing. Nothing about the specialists needs to change to be re-hosted on this harness.
- **Substrate (future):** cross-run memory, promotion of proven chain templates, capability registry, deployment surface. Out of scope here.

## 6. Next steps (post-experiment)

- Land a real `xt worktree`-style command that wraps this experiment behind an operator alias.
- Wire an actual reviewer specialist into the specialists framework (so the RPC baseline gains parity).
- Publish `docs/design/chain-templates.md` (spec §19 gap) so canonical references resolve.
- Fix pi SDK 0.84 typings — export `AuthStorage` / `ModelRegistry` from top-level if `createAgentSession` still consumes them (or update docs to say they're not required).
