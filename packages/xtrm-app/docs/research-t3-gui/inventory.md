# Repository and component inventory

## Repos (all reachable 2026-10-12 via `git ls-remote`)

| Repo | Role | SHA / state | License |
|---|---|---|---|
| `xtrm-dev/xtrm @ fc8132c1` (2026-10-06) | App, Substrate, xts, Console v2 | main, clean except research package (this) | repo LICENSE (see root) |
| `xtrm-dev/core @ 5e8fb8e5` (2026-10-08) | `xt` CLI, agent host, contracts, topology producer | sibling `~/dev/core` | repo LICENSE |
| `earendil-works/pi-coding-agent 0.84.2` (installed) | Primary runtime | `packages/xts/node_modules`; declares `^1.0.0` — mismatch open | upstream license applies |
| `pingdotgg/t3code @ 5753207d53` (2026-10-12) | GUI/component donor | research clone, read-only | **MIT** (T3 Tools Inc.; `LICENSE` file verified) |
| `pingdotgg/t3code` nightly | — | active daily channel; newest `v0.0.46-nightly.20261012.3010` (`d83929ad`, 2026-10-12) is an ancestor of reviewed HEAD — 5 post-nightly main commits (desktop Wayland fix, web context-meter, ACP terminal-kill test, Forgejo head commit, Win-ARM release fix), none touching provider-pi/orchestration/contracts/client-runtime/ssh. Reviewed HEAD is the newest functional baseline | n/a |
| `agentclientprotocol/agent-client-protocol` | Standard boundary ref | reachable; contributions Apache-2.0, no top-level grant in README | verify before vendoring |
| `slopus/happy` | Relay/multiplayer pattern ref | reachable | MIT (README claim) |
| `All-Hands-AI/OpenHands` | Canvas/Agent-Server pattern ref | reachable | none stated in README — verify |
| `tmux/tmux` | Persistence authority | reachable | ISC (README+CHANGES) |
| `zed-industries/zed` | interop at most | reachable | GPL-3.0-or-later — do not vendor |
| `anomalyco/opencode` ≡ `sst/opencode` (identical SHAs) | deferred | reachable; README 404 at `main` — re-pin default branch | verify |
| `anthropics/claude-code` | public-interface only | reachable; proprietary internals unavailable | n/a |

## XTRM entry points and contracts

- Transports: `packages/xtrm-app/server/agent-host-ssh.ts` (`AgentHostConnection`,
  `agentHostHandler`, `agentHostSshApi`), `server/agent-host-live.ts`
  (`HostEndpoint`, `localEndpoint`, `proxyEvents`, `resolveRepo`),
  `server/agent-host-direct.ts` (`DirectConnection` pairing, `xtp_`/`xtd_`).
- Read: `src/adapters/agent/live.ts` (`createLiveAgent`), `projector.ts`
  (`AgentProjector`), `history.ts` (`historyEvents`, `mergeFrames`), `protocol.ts`
  (`xtrm.agent-event.v1` / `agent-host-api.v1` / `agent-command.v1`, mirrors of
  `@xtrm/contracts` at pinned core commits).
- Write: `live.ts send/submit/abort/respond/launch`, `src/agent/settle-retry.ts`
  (`submitAfterSettle`, 3×1s within 3s), `@`-refs (`references.ts`, 96KB budget).
- UI: `AgentSurface/DrawerPanels/AgentSidebar/Composer/HostConnection/NewSession`,
  `shell/` (AppShell, Inspector, ContextSidebar, GlobalSearch).
- Sketch (not in bundle, do not promote): `host/frame-projector.ts`,
  `host/provider.ts`, `host/providers/pi.ts`, `host/providers/claude.ts`.
- Topology: producer `core/cli/src/core/topology-projection.ts`
  (`xtrm.topology.projection.v1`), `GET /v1/topology[/events]`; **no consumer in app yet**.
- Tests: `server/*.test.ts`, `src/adapters/**.test.ts`, `e2e/agent|details-naming|host-connection`,
  real-host `playwright.real-host*.config.ts`, acceptance XTRM-601
  (`scripts/real-host-acceptance.sh`, 45 tests).

## T3 entry points (donor map)

- App: `apps/web` (Vite React TS), `apps/desktop` (main+preload+ipc), `apps/server`
  (Node Effect services + SQLite), `apps/mobile`.
- Reuse surface: `apps/web/src/components/chat/*`, `components/diffs/*`,
  `components/files/*`, `components/permissions/*`.
- Runtime (reference only): `apps/server/src/orchestration-v2/*`,
  `packages/contracts/src/*`, `packages/client-runtime/src/*`,
  `packages/provider-pi/src/server/*`, `packages/ssh|tailscale/*`.
- Tests: vitest per package (`adapter/commands/driver/status/textGeneration/thinkingCapabilities`
  in provider-pi; `boundedSnapshotTransport`, `CommandPolicy`, `ws` perf bundle in server).
