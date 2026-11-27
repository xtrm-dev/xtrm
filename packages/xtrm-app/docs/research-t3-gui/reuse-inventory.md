# T3 reuse and porting inventory (top 20 + own-process list)

T3 tree: `.worktrees/research-t3-gui/t3code @ 5753207d53`. Treatments:
**reuse-direct / reuse-with-adapter / port / reference / defer / replace / reject**.

| # | T3 path | Purpose | Key deps | Treatment | Effort |
|---|---|---|---|---|---|
| 1 | `packages/provider-pi/src/server/rpc.ts` | `pi --mode rpc` stdio-JSONL transport, id-correlation, framer, process-group kill | Effect, `provider-core/server/processGroup` | **port** — protocol knowledge exact (LF framing, response/event split, oversize drop); rewrite minus Effect for XTRM host | M |
| 2 | `packages/provider-pi/src/server/adapter.ts` (`PiAdapterV2`) | Pi events → normalized items; settle/compact/retry/approval/subagent mapping | Effect, contracts, IdAllocator/MCP | **port (selective)** — mapping tables + settle probe; not the Effect machine | M–L |
| 3 | `packages/provider-pi/src/server/mcpInjection.ts` | Launch builder, reserved-arg guard, MCP extension materialization | Effect FS | **reuse-with-adapter** — reserved-arg list + env-scrub apply to XTRM launcher | S |
| 4 | `packages/provider-pi/src/server/commands.ts` | `get_commands` → slash/skills mapping, `/compact` | none | **reuse-direct** — pure mapper | S |
| 5 | `packages/provider-pi/src/server/status.ts` | `pi --version` + ephemeral `--no-session` discovery | Effect, semver utils | **reuse-with-adapter** — keep MINIMUM_PI_VERSION gate idea (0.80.5: `get_entries` + `agent_settled`) | S |
| 6 | `apps/web/src/components/chat/ChatMarkdown.tsx` (+ `markdown-*.ts`) | Streaming markdown/code render | md pipeline, highlight | **reuse-with-adapter** — re-skin to XTRM §27, wire to Frame contracts | M |
| 7 | `apps/web/src/components/chat/MessagesTimeline.tsx` | Virtualized activity timeline + scroll anchoring | TanStack-Virtual-style | **reuse-with-adapter** — answers PRD §28; adapt thread-transcript → Frame-foreground + dock | M |
| 8 | `apps/web/src/components/chat/ChatComposer.tsx` + `ComposerPromptEditor*.tsx` | Composer: Tiptap, mentions, slash menu, attachments, drafts, guards | Tiptap, client-runtime dispatch | **reuse-with-adapter** — de-chat to Frame ingress + `@`-refs (§10) | L |
| 9 | `apps/web/src/components/chat/ShellCommandBlock.tsx` + `CommandBlock.tsx` | Tool/command cards | turn-item contracts | **reuse-with-adapter** — matches §17 ToolActivity | S–M |
| 10 | `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx` + `components/permissions/` | Approval prompts (confirm/select/input/editor) | runtime-request contracts | **reuse-with-adapter** — mirrors `extension_ui_request`; restyle + authority-gate (§13) | M |
| 11 | `apps/web/src/components/DiffPanel.tsx` + `components/diffs/` | Diff viewer | `@pierre/diffs` | **reuse-direct** — DEPEND on `@pierre/diffs`, adapt shell (verify license first) | S |
| 12 | `apps/web/src/components/files/FileBrowserPanel.tsx` + `FilePreviewPanel.tsx` | File browser + preview, save-coordinator | filesystem RPC | **reuse-with-adapter** — scope to artifact/evidence projection | M |
| 13 | `apps/web/src/components/ThreadTerminalDrawer.tsx` + `apps/web/src/terminal/ghostty/` | Terminal drawer + `libghostty-vt` WASM renderer | native pin `native/libghostty-vt/VERSION`, server PTY (5k-line/8MiB caps) | **defer** — take retention caps + replay-detach protections as requirements now | — |
| 14 | `apps/web/src/components/Sidebar.tsx` + thread lists/cards | Session/thread lists | client-runtime threads | **replace** — chat-first IA conflicts Console shell (§5, §34.3–34.5); row-anatomy only | — |
| 15 | `apps/web/src/components/settings/` | Provider/env/device/keybinding settings | many | **programme** — our settings direction is decided in the settings research report (`docs/design/settings-research.md` on branch xt/settings-research, commit 2c429c04, XTRM-1098); read it before lifting T3's settings UI | — |
| 16 | `packages/client-runtime/src/state/threadShell.ts` + `threadDetail.ts` + `threadHistory{Controller,Merge}.ts` + `rpc/session.ts` | Bounded snapshot + live-merge + re-subscribe/replay | Effect, contracts | **port (pattern)** — snapshot+`afterSequence` + bounded merge is the Frame/Tree lazy-hydration answer (§28); no Effect import | M |
| 17 | `packages/contracts/src/orchestrationV2.ts` + `rpc.ts` | Thread/run/turn/item/shell schemas + RPC group | Effect Schema/Rpc | **reference** — vocabulary source; define natively | S |
| 18 | `apps/server/src/orchestration-v2/EventSink.ts` + `EventStore.ts` + `ProjectionStore.ts` + `WireProjection.ts` + `ThreadSettlementService.ts` | Event-log truth + projections + settlement detector | Effect, SQLite | **reference** — conditional-commit + settlement-grace design; XTRM keeps provider truth + Frame projector | S |
| 19 | `packages/ssh/src/` + `packages/tailscale/src/` | SSH forward + remote-server lifecycle; Tailscale route | ssh libs | **reuse-with-adapter** — adopt owns-vs-discovers rule (`tunnel.ts`: stop remote server only if launcher owns it) + learned-route model | S–M |
| 20 | `packages/effect-acp/src/` + `packages/provider-acp/src/server/` | Generic ACP wire runtime + ACP→orchestration adapter | Effect | **defer (adapt later)** — PRD §23–24 prefers `AcpKit` evaluation first; second reference behind it | — |

## T3 pieces that assume T3 owns the agent process (do not lift)

`PiRpcConnection` spawn + process-group `terminate` · forced `--mode rpc` +
reserved-arg rejection · `registerThread` `switch_session`/`new_session` rebinding ·
`startTurn` same-`nativeThreadRef` guard · one active turn per provider thread ·
unsolicited-`agent_start` → terminate · Stop-with-restart kills process ·
rollback (`fork(entryId)` + barrier) and fork (`--fork` child, extensions disabled) on the
owned session · per-session T3 permission-hook extension injection · ephemeral
`--no-session` discovery probes · `set_session_name` title mirroring · `prepareMcpSession`
PATH fixed at spawn.

## Build/run (recorded, not executed)

pnpm workspace (`pnpm-lock.yaml`, `pnpm-workspace.yaml`), `vp i` / `vp run dev`
(`scripts/dev-runner.ts`), Node 24, `effect-tsgo` patch on prepare, vitest per package
(incl. `test:perf:v2-wire`). Toolchain present locally (node v24.15.0, pnpm 11.10.0).
Full install/build deferred to prototype milestones — 28k-file checkout, network-heavy;
no destructive commands run against the research clone.
