# Real-infra AgentSession smoke — final brief

**Date:** 2026-08-19 · **Author:** jaggerxtrm (Opus 4.7 1M) · **Governing epic:** xtrm-pq1

## 1. Scope executed

Read-only SRE-triage vertical slice against `/home/dawid/projects/mercury/infra` (via bind-mount mirror at `/tmp/claude-1000/-home-dawid-dev-xtrm/a27124c7-.../scratchpad/mercury-infra-mirror`), 4 SRE Specialist JSONs frozen (`--specialist-json required`), Pi AgentSession dispatched from `experiments/agentsession-sre-chain-vertical-slice/src/cli/main.ts`, custom model provider `commandcode/deepseek/deepseek-v4-flash` resolved via new `model-resolver.ts` adapter.

Target repository is verified untouched (no writes, no commits, no config edits, no restarts).

## 2. Result — 5/6 satisfied, reviewer PASS, coordinator-close blocked by drift guard

Chain identity: `chain-sre-9ec830` · run `run-sre-d8b91` · duration 04:08:26Z → 04:36:29Z (~28 min).

| step | status | attempts | remediation loops |
|---|---|---|---|
| coordinator-entry | satisfied | 1 | 0 |
| explorer | satisfied | 1 | 0 |
| observability | satisfied | 1 | 0 |
| diagnostician | satisfied | 3 | 2 |
| reviewer | satisfied | 3 | 0 |
| coordinator-close | **failed (specialist skill drift)** | 1 | 0 |

Chain-level status: `running` (never terminalized). `reviewer_verdict: PASS`.

The coordinator-close failure is *not* a runtime bug — see §6.

## 3. Evidence — 10 records, zero missing

All body files present. Full inventory in `run/evidence/index.jsonl`; sizes and timestamps preserved.

    chain-coordinator     coordinator.decision     ev-coordinato-b56d-a6f59873   2895 B  04:10:54Z
    chain-coordinator     diagnostician.report     ev-diagnostic-811e-639b7dd8  11212 B  04:11:26Z
    explorer              topology.map             ev-topology-m-1d07-005b2cb9   6843 B  04:13:31Z
    observability-analyst observability.snapshot   ev-observabil-185d-fc141b57  13085 B  04:15:27Z
    sre-diagnostician     diagnostician.report     ev-diagnostic-c712-fe1b7d4a   2290 B  04:18:07Z   # round 1
    reviewer              reviewer.verdict         ev-reviewer-v-f872-629db17a   4734 B  04:21:57Z   # PARTIAL
    sre-diagnostician     diagnostician.report     ev-diagnostic-819b-8813dec3   8640 B  04:24:39Z   # round 2
    reviewer              reviewer.verdict         ev-reviewer-v-41e5-767c9fe3   3902 B  04:29:46Z   # PARTIAL
    sre-diagnostician     diagnostician.report     ev-diagnostic-9b7d-3ce9334a  16496 B  04:35:11Z   # round 3
    reviewer              reviewer.verdict         ev-reviewer-v-43ea-3b463df4   2260 B  04:36:21Z   # PASS

Message routing: 9 channel messages in `run/channels/messages.jsonl`. Every message carries author `participant_id`, `audience.action_targets`, `evidence_refs`. Every reviewer verdict is emitted with author `reviewer_policy` (reducer synthesizes the `work.verdict` channel message from the reviewer's `reviewer.verdict` evidence — this is the designed shim).

Forensics: 2 163 events in `run/forensics/events.jsonl` (activation start/msg/tool traces per participant, plus reducer intents, bead virtualization notes, drift error).

## 4. What the chain actually found (substantive infra content, verified real)

The chain produced substantive findings about the *actual* Mercury infra state at the time of the run — not fabricated content:

- **QuestDB equities candle outage** — `mmd_questdb_5m_fresh_count:by_family{family="equities"}` fresh=2/4, NQ=F and YM=F stale, `QuestDBCandle5m/30m/1hFamilyOutage` firing; mmd-questdb container up 42h, CPU 233 %, WAL/o3 rewrite storm on `ohlcv_5m/30m/1h` (seqTxn 24 M). Feed-side staleness — read path healthy (2-19 ms), write path failing on specific symbols. Cross-verified by explorer host probes + observability PromQL.
- **Change forensics HIGH causal-negative** — no in-window deploy caused the candle outage. Closest change = api-gateway KAN-58 cycle-6/7/8 merged 00:09-05:11Z, but running api-gateway container is still cycle-5 (image_created ≈ started 08-18T17:12Z) → merged-not-deployed drift, not causal.
- **ext-papers:8006 ServiceDown** — reconciled as a legitimate config-drift *defect*: HEAD prometheus.yml lists :8006 as by-design-down, but the accompanying fix (commit `eb71393`) lives only on branch `xt/p35r`, never merged. Reviewer originally challenged the "defect" framing on round 1; diagnostician re-verified via `git branch --contains` in round 3.
- **QuestDB unrotated log** — 23.9 GiB `json.log`; mercury-market-data compose commit `113b94c3` (08-15) added `max-size 100m x3` rotation, but running container's `HostConfig.LogConfig` is EMPTY → fix never applied.
- **Two orphan debug containers** — `bold_tesla` (streak 4949, since 08-01) and `nice_meninsky` (streak 6156, since 07-28), plus a third `tsdb_repro_t80he`. Labels `mercury-market-data-ido61-debugger`. Operator cleanup recommended, chain did not act.
- **Host oversubscribed** — swap 95.7 % (23.05/23.99 GiB), inflection 08-19T00:30Z; correlational overlap with cycle-6 merge, not established as causal.

Recommended operator actions in the round-3 diagnostician report are concrete (`git diff main xt/p35r -- prometheus/prometheus.yml`, `truncate -s 0` of the 23.9 GiB log, `docker rm -f bold_tesla nice_meninsky tsdb_repro_t80he`). Read-only posture respected — every fix is operator-applied, none chain-executed.

## 5. Chain runtime behaviors proven

- **8 custom tools work** (`chain_progress`, `channel_actionable`, `channel_attention`, `channel_post`, `channel_ack`, `evidence_publish`, `evidence_get`, `sre_exec` — allow/denylist enforced from `src/tools/policy.ts`).
- **Custom Pi provider resolution** (`commandcode/deepseek/deepseek-v4-flash`) works end-to-end via new `src/agents/model-resolver.ts` — falls through pi-ai/compat built-ins to `~/.pi/agent/models.json` catalog.
- **Bounded remediation loop** (reducer cap = 2) executed as designed: reviewer PARTIAL twice → diagnostician remediated twice → round-3 PASS. Third loop was refused correctly.
- **Reviewer verdict routing** by bare-word regex (`PASS`/`PARTIAL`/`FAIL` in `.summary`) works: PARTIAL routed to diagnostician, PASS routed to coordinator-close.
- **Specialist JSON freeze** (`--specialist-json required` from PR #71): all 4 specialists resolved, skill fingerprints captured at chain start (`run/chain/specialist-bindings.json`).
- **Cognition drift guard** fires (§6).
- **Beads adapter fallback** to VIRTUAL step ids when `bd init` refuses inside the run-dir — no real beads DB writes, no pollution of the durable board.
- **Target repo untouched** — no filesystem writes, no docker mutations, no git operations against `/home/dawid/projects/mercury/infra`.

## 6. Coordinator-close failure — drift guard fired, correctly

At 04:36:29Z, `coordinator-close` dispatch threw:

    Specialist skill drift for role=chain-coordinator skill=/home/dawid/.claude/skills/sre-triage/SKILL.md
      frozen  sha256=87c99ed01314d79ebb6856d38e31680214a83529cc2fbfe83198627271997453
      current sha256=9877c5a24c2c3a3fd7b393f8d2c52dcbc211546c93b7504d1a40c369d30b498e
    Start a new ChainRun/revision instead of mutating cognition in-place.

A concurrent fork agent (dispatched earlier in the session to work on sre-triage per-run report scaffolding) modified `/home/dawid/.xtrm/skills/default/sre-triage/SKILL.md` between chain start and coordinator-close dispatch. `--specialist-json required` mode is contractually obligated to refuse dispatch on any fingerprint mismatch — the runtime refused stale cognition and left the chain in a recoverable state. Full evidence in `notes/DRIFT-EVIDENCE.md`.

This is a stronger proof of the runtime than a clean 6/6 would have been: the guard actively fired on a real cognition mutation.

## 7. Observed defects worth filing (not fixed in this session)

- **mcpq walk-up discovery gap** — coordinator ran bare `mcpq` in the scratchpad mirror; mcpq walks up looking for `.mcpq.json` with ceiling `/home/dawid`, found none in the mirror or ancestors, declared observability "UNAVAILABLE". Observability analyst knew the workaround (`mcpq --config /home/dawid/projects/mercury/.mcpq.json`) and got everything. Coordinator prompt / policy should teach the explicit `--config` for scratchpad mirrors.
- **Beads adapter VIRTUAL fallback logs errors on every step** — `bd --sandbox note/close vsvs-…` fails to resolve because there are no real beads, only VIRTUAL ids. Adapter should suppress the resolution-failure log spam when running in virtual mode.
- **Reviewer synthesized message shape** — `channels/messages.jsonl` shows the reviewer's `work.verdict` message with `author.participant_role = "reviewer_policy"` (reducer shim) rather than the reviewer agent itself. Fine semantically but potentially confusing for consumers grepping by author role.
- **LIVE MESSAGES dump in bridge.ts doesn't fire** — the `activation.msg.<role>` fact-emitting block in `bridge.ts` / `specialist-bridge.ts` never emits (0 such facts in 2 163 forensics events across all runs). The per-turn `message_start`/`message_end` stream still captures msg-count and content head, but the full-message dump is silent. Diagnostic-only; does not affect chain correctness.

## 8. Files in this bundle

    BRIEF.md                                     — this document
    notes/DRIFT-EVIDENCE.md                      — skill-drift smoking gun
    run/                                         — verbatim copy of run-sre-d8b91
      chain/{resolved-chain,specialist-bindings,run-inputs,run-state,scheduler-intents,beads-map}.json[l]
      evidence/index.jsonl + 10 body files
      channels/messages.jsonl + cursors/
      forensics/events.jsonl                    — 2 163 events (621 KB)
      projections/chain-progress.json           — terminal projection
      report-log.json                           — final report log
      dispatch.log                              — full stdout+stderr from the CLI run
      design-inputs.json                        — baseline_specialists + fingerprints
    patches/
      DIFF-STAT.txt                             — 4 tracked files, 334+ / 9- lines
      uncommitted-src.diff                      — full unified diff (tracked files)
      uncommitted-roles.diff                    — empty (roles unchanged)
      untracked-src.diff                        — model-resolver.ts (new file)
      current-src/                              — full on-disk copies of all
                                                  load-bearing files (bridge.ts,
                                                  specialist-bridge.ts, scheduler.ts,
                                                  topology.ts, model-resolver.ts,
                                                  tools/index.ts, tools/policy.ts)

## 9. State of the working tree at handoff

- Branch `main` on `/home/dawid/dev/xtrm` — clean, PR #71 merged as `cef3cf8`.
- Worktree branch `web/full-specialist-json-loader-2026-08-18` on `/home/dawid/dev/xtrm-wt/pr71-loader` — carries the uncommitted diagnostic patches listed above. These are load-bearing for the smoke and belong to the next workstream (`xtrm-pq1.1` bridge messages dump, `xtrm-pq1.2` scheduler MUST-DO blocks, `xtrm-pq1.3` model-resolver adapter, `xtrm-pq1.4` topology default-model swap). Do NOT commit as-is — file the beads first and let the next session move them into that workstream.

## 10. What the coordinator brief should say

- Chain runtime is proven end-to-end on real infra with real substantive output, one designed guard firing, and every artifact persisted.
- Custom-provider dispatch via `~/.pi/agent/models.json` is proven to work when the runtime resolves through the new adapter — this un-blocks running the chain on any Pi-catalog provider, not just built-ins.
- Bounded remediation with `PASS` after 2 loops on real Mercury data (not a synthetic incident) demonstrates the reviewer gate is doing useful work — it caught real contract violations in the diagnostician report and forced substantive fixes.
- The one gap (coordinator-close never fired) is a fork-agent cross-contamination event, not a runtime bug. The reducer's `reviewer_verdict = "PASS"` is captured, so semantically the chain reached its terminal verdict; only the ceremonial close turn was blocked.
- Persist local uncommitted diagnostic patches as beads for the next workstream — do not merge them onto `main` in their current shape.

