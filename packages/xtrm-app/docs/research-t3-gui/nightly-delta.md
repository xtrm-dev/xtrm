# Nightly delta watch (2026-09-20 → reviewed HEAD 5753207d53)

Active channel: `v0.0.46-nightly.YYYYMMDD.NNNN` (newest `...20261012.3010`, ancestor of
reviewed HEAD; 5 post-nightly commits verified immaterial to the verdict). Method: `git log
--since=2026-09-20` over runtime + web paths, nightly release notes, code-level spot checks.
No checkout changes; all SHAs below are upstream T3.

## Port candidates (highest XTRM interest)

1. **Capped auto-continuations, on by default** — `b9ad3daf8d` (#18461):
   `apps/server/src/orchestration-v2/RestartContinuation.ts` (+96, `RestartContinuation.test.ts`
   +169). XTRM has settle-retry (3s window) and Pi auto-retry; T3's bounded-continuation
   design (cap + default-on + restart recovery) is the reference for a Frame settle/continue
   policy. → M4 pattern port; open against `src/agent/settle-retry.ts`.
2. **Read-only tool approval allowlist (Pi)** — `5f7294d452` (#17852):
   `packages/provider-pi/src/server/mcpExtensionSource.ts` (+18, `mcpExtensionSource.test.ts`
   +46). Known-read-only T3 tools bypass approval. Direct input to M2 approval panels +
   Pi `extension_ui_request` mapping (allowlist shape, not the Effect code). → M2.
3. **Worktree stickiness + setup queue** — `477282263a` (#17654):
   `apps/server/src/orchestration-v2/Orchestrator.ts` (+65, `ThreadLaunchService.test.ts`
   +156). Thread keeps its worktree at agent start; messages during setup queue instead of
   racing. Directly applicable to XTRM launch (`xt pi` worktree + `NewSession` join wait).
   → M1 launch-path hardening.
4. **Prompt deep-links** — `5fe7568e87` (#18454): new
   `apps/mobile/src/features/prompt-links/` (`prompt-link-model.ts` 92,
   `usePromptLinkResolver.ts` 313, +tests). Link opens app with a prompt ready to send.
   XTRM already has pairing URLs; a prompt/session deep-link is the natural remote-first
   extension (share a session link, land with context). → M4 design item, not M1.
5. **Terminal write batching + parse skipping** — `1c7b267424` (#17183, 250ms
   `Manager.ts`), `1f...` skip plain-output parsing (#17179), `cf8479e605` last-error lookup
   from thread bindings (#17842). Take as performance requirements for any XTRM terminal
   surface (deferred drawer): bounded retention already recorded; add write-coalescing. → M4.

## Requirements / acceptance-note batch (no port, cite in specs)

- `f6fa4776e7` panel toggles skip timeline/composer re-render; `83fbbc18f8` live-follow
  survives Settings return; `7ab28a3b2e` collator reuse in diff sort; markdown quadratic
  scan fix (#18387); Thinking shimmer (#18191) — all feed ADR-001 zero-layout-shift and
  M2 screenshot acceptance.
- `4a90c1cf5d` queued threads stay subscribed — subscription-lifetime edge for the
  snapshot+replay port (M4).
- `c727d1219f` Compact chip follows real cache TTL; `119e61b6c1` usage limit stops
  zeroing the meter; `9afde1c6db` native Pi sessions in usage reports (#17848) — context/
  cost display honesty rules for `SessionProjection` tokens/cost.
- `e7db61f679` OpenTelemetry export config in diagnostics (#12538) — aligns with XTRM
  telemetry research; adopt the config-surface shape when M5 hardens diagnostics.
- Guided PR reviews (`1f6df6bf1f`, `bed923986f`, review-guide MCP `18656a3402`) + offline
  PRs (`d07a07f33c`) — input to XTRM-423 PR-drawer completeness (multi-link UI, offline
  cache), not to the agent-control milestones.
- Subagent thread routing (`c1d528a342` Muse child threads, `818e2be75e` Copilot ACP
  subagent output) + scoped approvals (`a4a1a803a3`) — coordination-render reference for
  the `coordination` origin class (partial-adapter row).

## Watch only

Settings centralization (#18505), per-project provider toggles (#17879), model favorites
sync (#16816), mobile tab-bar/glass pills, Forkejo head-commit fix, Windows host test
fixes, `t3_thread_read` unknown-param rejection (#17823 — note the MCP/tool-surface
hygiene pattern for `agent-host-client` input validation).

## Standing instruction

Re-run this scan (same two `git log` paths + latest nightly notes) at each milestone
start; promote only items with a named XTRM consumer (milestone + module), as above.
