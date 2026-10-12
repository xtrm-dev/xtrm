# Executive decision: selective reuse, not a fork

**Recommendation:** **Option B with C's sequencing** — keep the XTRM agent host as the
canonical control plane; reuse T3 presentation components behind adapters; port proven
patterns; converge incrementally behind the existing parity gates. **Reject Option A**
(T3-derived application). Option D was not needed: no materially better architecture
surfaced, but two interface adoptions (ACP-shape negotiation, Happy-style relay semantics)
are folded into B — see §6.

## 1. Why the preferred hypothesis failed

The mission hypothesized a near-direct T3 fork. Code evidence falsifies it as a
whole-application strategy:

1. **Attach is impossible in T3's model.** `packages/provider-pi/src/server/rpc.ts`:
   every Pi process is a T3-spawned `pi --mode rpc` child over stdio; `terminate` is a
   process-group kill. `mcpInjection.ts:15-33` rejects `--resume/--session/--fork/--mode/--continue`
   ("T3 owns RPC mode and session identity" — verified by direct read). Thread identity is
   the session **file path**; "resume" spawns a fresh process and `switch_session`s the file.
2. **External work is killed.** `adapter.ts:116-117,1788-1830`: `agent_start` with no active
   T3 turn → `PI_UNSOLICITED_ACTIVITY_ERROR` + `connection.terminate`. A hand-started tmux
   Pi session is never a live thread; at best its file is loaded into a second process
   (branching the conversation — the failure mode PRD §35.2 already records).
3. **Transcript truth is server-owned.** `orchestration-v2/EventSink.ts` + SQLite log is the
   interaction truth; XTRM requires provider-owned truth with host Frame projection and no
   second transcript DB. Adopting the server imports the own-the-process model wholesale.
4. **No tmux-attach concept exists** anywhere in the T3 tree or docs; the SSH "owns vs
   discovers" rule (`packages/ssh/src/tunnel.ts`) applies to *server processes*, not agent
   sessions — useful as a ported pattern, not as a solution.

XTRM's discovery model (extension-registry push: GUI-launched or hand-started `pi`/`xt pi`
appears without GUI action; orphan panes without the extension stay invisible; no
adopt-arbitrary-pane RPC) has no T3 counterpart. A fork would have to delete the
orchestrator, settlement stack, and process ownership — i.e. everything except the UI —
while fighting upstream divergence on every sync. That is Option B with extra steps and
no baseline advantage.

## 2. What we keep from T3 (the actual win)

- **Presentation components** (reuse-with-adapter): streaming markdown/code
  (`apps/web/src/components/chat/ChatMarkdown.tsx`), virtualized timeline
  (`MessagesTimeline.tsx`), composer state machine (`ChatComposer.tsx` + Tiptap pieces,
  de-chatted to Frame ingress + `@`-refs), tool/command cards (`ShellCommandBlock.tsx`),
  approval panels (`ComposerPendingApprovalPanel.tsx` + `components/permissions/`),
  diff viewer (`DiffPanel.tsx` + `components/diffs/`, DEPEND on `@pierre/diffs`).
- **Ported patterns**: bounded snapshot + `afterSequence` replay transport
  (`client-runtime/src/state/threadHistory*.ts`); settlement-detector design
  (`ThreadSettlementService.ts`, `agent_settled`-only terminalization — matches PRD §3,
  Frame ≈ T3 **Run**, not Turn); SSH owns-vs-discovers rule; launcher reserved-arg hygiene;
  terminal retention caps (5k lines / 8 MiB) + replay-detach protections as requirements.
- **Reference only**: Effect/RPC wire stack, `EventSink`/`ProjectionStore`, contracts
  schemas (vocabulary source for native XTRM contracts, no Effect Schema dependency).

Full table with paths, deps, effort: `reuse-inventory.md`.

## 3. Feature parity matrix (narrative)

Machine-readable: `parity-matrix.json`. Headline counts from the CLI (`core` v0.15.2) vs
GUI inventory: **both 7** (launch, observe, prompt/steer/abort, SSH+loopback+direct remote,
Substrate board, issue editing, Claude presence render), **CLI-only 5** (specialist dispatch,
session reports/close flow, worktree management, skills/hooks, machine bootstrap),
**GUI-only 4** (program projection, GitHub surfaces, research, shell), **partial-adapter 3**
(SSH client logic, typed references, coordination render), **unsupported 1**
(fleet Graph/Observability — deferred both sides). Structural finding: the shared-layer
principle already holds (one `xt pi` launch path; host-owned state; typed Substrate service;
no SQL/API keys in GUI). The gap is packaging: the "live" side is a Vite dev-server bridge
(`server/*.ts`), not an importable service layer — hence the proposed
`packages/agent-host-client` (`api/ssh/auth/references`), home repo still open (core vs xtrm).

## 4. Options scored

| Criterion | A: T3-derived app | B: T3 UI + XTRM backend (chosen) | C: incremental (chosen as sequencing) |
|---|---|---|---|
| Time to mature UI | Fast shell, then stalls on runtime rewrite | Medium: adapters first, components land whole | Same as B, staged |
| Functionality retained | Loses attach, tmux-first nav, Frame semantics | Retains 100% of XTRM-557/601 behaviour | Same as B |
| Existing-session adoption | **Fails**: kill-on-unsolicited is structural | Native: registry-push already works | Native |
| CLI/GUI parity | Second implementation diverges immediately | Parity gates already exist; matrix enforced in CI | Same |
| Remote + tmux | Server model fights tmux authority | SSH/direct transports already accepted (§35) | Same |
| Licensing | MIT: clean, but fork carries T3 identity/update channel | Component-level: MIT + `@pierre/diffs`/ghostty pins to verify | Same |
| Rollback | Fork is a flag-day | Per-component revert; old surfaces keep working | Milestones each shippable |
| Divergence | Permanent, on every upstream sync | Bounded: vendored components with adapter seams | Same, reviewed per milestone |

## 5. Remote-first position

No new transport needed. XTRM's priority order (SSH-forwarded remote → paired direct
front → loopback), per-host identity headers, `0600` token custody, 401→repair, and
`Last-Event-ID` cursor resume already cover the mission's remote cases; T3 contributes the
learned-route model and owns-vs-discovers rule as ported requirements. Open design point:
two-GUI-clients racing `prompt/steer` is `first wins, second busy` with only `commandId`
dup-rejection — acceptable for M1, revisit if multi-operator becomes a goal.

## 6. Adjacent projects (one-line dispositions)

- **ACP**: adopt-interface — `initialize`/`protocolVersion` + capability negotiation shape at
  the host Frame edge; keep Pi runtime + tmux internally. (License: contributions Apache-2.0;
  no top-level grant in README — verify before vendoring schemas.)
- **Happy** (MIT): port relay-for-encrypted-sync + co-watch/either-steer semantics for remote
  Frame projection; reject its CLI/runtime (conflicts with Pi/tmux authority).
- **OpenHands**: port backend-switching + Automation→Agent-Server dispatch separation; Pi as
  one backend of many. (No license stated in README — verify.)
- **tmux** (ISC): persistence authority stands; identity/control-mode answers need
  manpage/source follow-up (README defers). No new dependency.
- **OpenCode**: no decision — canonical repo confirmed reachable
  (`anomalyco/opencode` ≡ `sst/opencode`, identical SHAs) but README fetch 404d at `main`;
  re-pin default branch out-of-band before citing it.
- **Zed** (GPL-3.0-or-later): reject for reuse; ACP-client interop at most.
- **Claude Code** (`anthropics/claude-code`): repo reachable; proprietary internals not
  available — public interfaces only, no dependency.

## 7. Risks (register)

1. **Pi contract drift**: `packages/xts` declares `^1.0.0`, behavior pinned to `0.84.2`
   dist+docs. Any 1.x event/entry change invalidates projector mappings. *Mitigation:*
   decide the canonical contract version in M1; gate CI on installed-version assertion.
2. **Missing emitter**: the `subscribe → xtrm.agent-event.v1` Pi extension lives outside
   this repo; in-repo `host/providers/pi.ts` is a sketch that must not become a second
   Frame type. *Mitigation:* locate/contract the emitter in M1 (open question #1); delete
   or demote the sketch.
3. **Journal gaps** (`XTRM_SESSION_NAME`, GUI ingress, `sourceInfo`, `parentToolCallId`)
   papered over in GUI per §36.13. *Mitigation:* assign owner (extension vs host) in M1.
4. **T3 upstream divergence** on vendored components ("very early, expect bugs", closed to
   big contributions). *Mitigation:* pinned fork + adapter seams; sync review per milestone.
5. **Approval transport blind spot**: XTS dangerous-command approvals are TUI/stdin-local;
   a GUI attached to XTS never sees them. *Mitigation:* bridge-or-document decision in M2.
6. **Thinking/toolcall deltas dropped everywhere** (privacy/cost or accident?).
   *Mitigation:* explicit product decision in M2.
7. **Topology consumer missing**: producer shipped (core), zero consumption code in app;
   XTRM-630 blocked on XTRM-628 design + XTRM-631 lineage. *Mitigation:* M3 milestone.
