# Lane G — xtmux runtime and RuntimeSupervisor boundary audit

Lane: G
Domain: xtmux runtime, RuntimeSupervisor boundary
Date: 2026-08-22
Bead: xtrm-cn8.3
Repo states: xtmux main @ `aebb885f429684d401d49ab8cb6ed6c7ddb4b099` (dirty: `bin/tmux-session-picker`, `test/nav-contract.sh`); xtrm docs clean at read paths; console `apps/console/src/server/runtime-lifecycle.ts` DIRTY in worktree (HEAD blob `5bcab9c5c3e2`).
Method: full reads of every listed doc; grep for `RuntimeSupervisor|runtime supervisor|ActivationSupervisor` across xtmux, xtrm/docs, console; targeted read of console lifecycle source.

---

## 1. Where the RuntimeSupervisor ADR/proposal actually lives

No file named "RuntimeSupervisor ADR" exists in any of the three repositories. The proposal exists in three places:

1. **PRD draft §8 "Runtime supervision"** (`xtrm/docs/shared/native-chain-runtime-audit-2026-08-19/native-chain-runtime-prd-draft.md`, lines 486–537). It defines the split: Chain runtime, ActivationSupervisor, and an "**xtmux RuntimeSupervisor boundary**": *"Current xtmux V2 is already a strong runtime substrate. Evolve it incrementally toward: runtime instance registry; provider adapters; terminal backends; event-driven observation; delivery attempts/receipts; waits/interrupts; runtime reconciliation."* Plus the constraint: *"Do not create another xtmux database or message ontology. Provider/backend selection must never alter Chain or Channels semantics."*
2. **ADR-06** in the decision matrix (`architecture-decision-matrix-and-adr-index.md` §2): "Runtime Supervision and xtmux Provider/Terminal Adapters" — owns evolution of current xtmux V2, runtime instance identity, provider adapters, terminal backends, waits/interrupts/delivery receipts, event-driven reconciliation, **no workflow authority**. Line 122: *"The proposed RuntimeSupervisor ADR can be reconciled into this."*
3. **Source register row** (`source-and-authority-register.md`): "`proposed RuntimeSupervisor ADR supplied with audit | PROPOSED | Consolidate event-driven runtime supervision + provider adapters + terminal backends; should evolve existing V2 rather than introduce a second store/control plane.`"

Zero occurrences of the literal tokens `RuntimeSupervisor`/`ActivationSupervisor` exist anywhere in `/home/dawid/dev/xtmux` (docs or src) or `/home/dawid/dev/console`. The concepts are entirely an xtrm-side reconciliation vocabulary projected onto shipped xtmux behavior. Related residual: `xtrm-v1-completion-ledger.md` SP-RMAP-01 ("Clarify runtime supervisor versus workflow supervisor") and SP-PRD-01 remain open V1 residuals that this reconciliation closes conceptually.

## 2. Inventory: what xtmux ALREADY owns (quoted evidence)

### Durable operational state (SQLite typed domains)

`ts-sqlite.md` §1: SQLite is authoritative for *"durable messages and acknowledgement state; agent instance lifecycle; agent state-transition history; completed agent turns; monitor registrations, leases, heartbeats, and terminal outcomes; handoff lifecycle; delivery attempts; correlated git, bd, and GitHub command telemetry; audit runs and durable findings; generic/custom event journaling; schema and legacy-data migrations."*

Shipped status (`observability-redesign.md` header): *"V2 is default-on; set XTMUX_OBS_V2=0 only for rollback or compatibility testing."* Cutover gates recorded as met (§11.2).

### tmux topology and sessions/windows/panes

`ts-sqlite.md` §15: SQLite must not replace tmux as live authority for *"session existence; pane existence; pane geometry; current command; pane capture; attachment state; live session/window topology."* §25 non-goal: *"No replacement of tmux as live topology authority."* Topology snapshot contract: `xtmux-gaps.md` §5 (`xtrm.xtmux.topology.v1`, stable `$N`/`@N`/`%N` IDs), shipped per `json-command-api.md`.

### Durable messages / receipts / reply obligations / delivery attempts

`observability-redesign.md` §4.3 + §14.1: atomic message+receipt insert; `message-ack` receipt-only; `message-reply --in-reply-to` reverses endpoints and fulfils atomically; obligations queried from SQL index `msg_pending_obligation`; *"no local marker or acknowledgement heuristic fulfils work."* §4.4 separates *"`message.sent` = durable insert"* from *"`delivery.attempted` = best-effort external projection or pane injection. Never the same event type."*

### Waits / wakes

§4.6a `outbound_waits`: requester/target identity validated on both sides; states `unarmed → armed → terminal-unconsumed → consumed` with `cancelled`/`expired`; *"Terminal unconsumed wakes are durable; consumption is one-time and idempotent"*; wakes survive restart.

### Monitors

§4.6: lease model (`heartbeat + max(3×interval, 30s)`), terminal-status closed set `done|timeout|killed|target_gone|process_gone|error`, absorbing terminal, no historical row per tick. This is subprocess/process lifecycle supervision for tmux-hosted targets today.

### Handoffs

§4.7: state machine `created/sent/delivery_failed/accepted/completed/cancelled`; prompt-file path+hash only, body never stored; monitor registration transactional with intent; *"`send-keys` success means injection only, not acceptance."* Readiness-aware variant with `--wait-ready` and `agent.ready` (`agent-state-hooks.md`, `xtmux-gaps.md` §8).

### Agent instances / state transitions / completed turns

§4.5: instance = one activation, not a pane (*"Panes may be reused; instances are not"*); open sources `agent.role.launched`, Pi `session_start`, Claude `SessionStart`; terminal sources `session_shutdown`, `state=off`, pane-disappearance reconciliation, explicit kill/stop. Restart recovery (`agent-state-hooks.md` §K4): missing-pane closes instance `pane_gone` inside `reconcileAll()`; re-occupied pane closes predecessor `superseded`. Terminal cleanup cancels owed reply obligations and armed monitors scoped by sender/requester pane. Turns carry uncompacted `last_message_text` (≤256 KB) plus response **episodes** projection with immutable `source_key` dedupe.

### Process/session lifecycle projections

`command_runs` with `owner_pid` authoritative interrupted detection (approved deviation, `ts-sqlite-domains-4-7-8.md` §5.1); git/bd/gh telemetry taxonomy with correlated start/finish envelopes.

### Audit / telemetry

`audit_runs`/`audit_findings` with fingerprint dedupe and completeness-gated resolution; `command_runs`; activity spans (`agent.activity`: observed stream duration, never content).

### Pi/Claude/Codex hooks (runtime observation adapters)

`agent-state-hooks.md`: Pi TypeScript extensions (`pi-agent-state.ts`, `pi-auto-monitor.ts`/`pi-inbox-reply.ts`), Claude JSON hooks (full lifecycle mapping incl. PostToolUse obligation gate and Stop wait-arm), Codex 0.146.0 wiring since K3/K4 (SessionStart/UserPromptSubmit/Stop/SessionEnd, turn capture from Stop payload, inbox reminder + obligation gate + wake consumption at Stop). All hooks fail open outside a live tmux client. Codex degraded launches consume structured `xtrm.command-outcome.v1` via `outcome-apply` — *"never prose"*; successful Codex outcomes carry an exact resume action (`codex --profile <profile> resume … <thread_uuid>`).

### Coordination budgets any supervisor design must preserve

`json-command-api.md`: outgoing-obligation query default 200 rows, inbox `--limit 500`, Pi fails closed above 500 monitor rows, ≤20 mutations per cycle, bounded widget/prompt text, unsafe IDs hidden, *"inbound summaries are never promoted to instructions."*

## 3. Three supervision roles, separated

### 3.1 ActivationSupervisor — one direct participant activation

PRD draft §8: owns *"one physical activation lifecycle; start/settlement; provider/session identity; heartbeat/progress; tool/probe activity; timeout/stall; retry eligibility signal; cancellation/abort; provider failure; session disposal; activation metrics. It never decides which chain node is next."* It belongs to the native participant runtime (ADR-03: Native Participant Runtime on Pi AgentSession) — i.e., it supervises activations **XTRM/Specialists hosts directly**, where a host process holds the AgentSession handle.

### 3.2 xtmux RuntimeSupervisor (proposed boundary) — externally hosted runtimes observed through a terminal backend

The proposed ADR-06 role: evolve existing xtmux V2 into runtime instance registry + provider adapters + terminal backends + event-driven reconciliation, explicitly with **no workflow authority**. Shipped xtmux matches the observation/reconciliation half today: it does NOT spawn or drive the runtime process — Pi/Claude/Codex run interactively in a tmux pane and push state via hooks/extensions; xtmux records durable facts, reconciles drift (pane gone, superseded, orphan markers), delivers messages/wakes into panes, and enforces coordination gates at hook seams. Its supervision powers: instance registry, monitors (lease/timeout/kill), waits/wakes, delivery attempts, terminal cleanup, restart recovery. It has no retry/stall/cancel control over the model process itself beyond pane-level interrupt/kill actions.

### 3.3 ChainReducer/Scheduler — workflow progression

PRD draft §8: *"Do not port the existing Specialists Supervisor as the chain supervisor."* Chain runtime owns reducer, scheduler, convergence, gate routing, chain-level recovery, terminal chain outcome. Decision matrix D-10: *"ActivationSupervisor; chain progression remains ChainReducer/Scheduler."* Neither ActivationSupervisor nor xtmux may decide chain order. `source-and-authority-register.md` C-08 decomposes the legacy specialists supervisor into ActivationSupervisor/FINALIZE/shared effects — *"Chain progression stays outside participant runtime."*

### Explicit answers

**Must a direct XTRM-hosted Pi AgentSession go through xtmux for lifecycle supervision? No.**
Evidence:
- The PRD assigns activation lifecycle (start/settlement/heartbeat/timeout/cancel/disposal) to ActivationSupervisor inside the native runtime (ADR-03); the xtmux boundary section lists only substrate capabilities (registry, observation, receipts, waits, reconciliation).
- Every xtmux lifecycle input requires a tmux context today: `agent-state.sh` *"requires both TMUX and TMUX_PANE; outside a live tmux client it exits successfully without changing state"* (`codex-characterization-k1.md`, `agent-state-hooks.md`). Invocation identity is NULL without `$TMUX` (`observability-redesign.md` §4.8). A headless AgentSession produces zero xtmux facts unless adapted.
- `xtmux-gaps.md` §2 authority split: Specialists owns job allocation/lifecycle; xtmux owns local tmux topology and interactive pane-instance identity.
- Register constraint: evolve V2, *"rather than introduce a second store/control plane"* — xtmux is a substrate/adapter target, not a mandatory hop.

**Is tmux a mandatory authority? No — optional operational/UI backend for hosted runtimes; binding only where a runtime chooses to be tmux-hosted.**
Evidence: tmux is the *live topology* authority within its own plane (`ts-sqlite.md` §15/§25), while SQLite is the durable authority and tmux options are best-effort projections. The bridge makes xtmux observable over SSH without tmux on the viewer side; nothing in xtmux requires tmux for its own durability. For non-tmux runtimes (direct Pi, future Herdr-like backend) tmux is simply absent; ADR-06's "terminal backends" (plural) is the adapter seam. Adopting Herdr *as a runtime* was already rejected once (`adr001-xtmux-nav.md`, Alternatives rejected) — a future Herdr-like backend enters as one more terminal backend, not an authority change; "changing tmux as the session authority" explicitly requires a new ADR.

## 4. Runtime class ownership map

| Runtime class / capability | Owner today | Target owner |
|---|---|---|
| Direct Pi AgentSession (XTRM-hosted, RPC) | Specialists `runner.ts`/`supervisor.ts` mixed implementation | **ActivationSupervisor** under native participant runtime (ADR-03); xtmux not involved |
| Interactive Pi in tmux pane | xtmux (pi extension → `agent-state.sh` → SQLite instances/transitions/turns/episodes) | xtmux substrate via provider adapter; activation decisions stay with the harness |
| Claude Code in tmux pane | xtmux (Claude hooks incl. obligation gate + wait arm) | same |
| Codex CLI in tmux pane | xtmux (K3/K4 hooks; outcome-apply consumes K2 outcomes) | same |
| tmux topology / terminal UI | tmux (live authority); xtmux projects (`topology.v1`) | unchanged; one terminal backend among future several |
| Future Herdr-like backend | none | new terminal backend behind ADR-06 provider adapters; no semantic authority |
| Subprocess lifecycle (pollers, wrapped commands) | xtmux `monitors` (lease/heartbeat/process_gone) + `command_runs.owner_pid` interrupted detection | stays xtmux substrate for tmux-hosted; ActivationSupervisor for directly spawned activations |
| Resume | Codex outcome `nextActions` resume argv (recorded, passed through verbatim); no generic resume engine | ActivationSupervisor owns resume/settlement; xtmux remains record/pass-through |
| Interrupt / kill | picker guarded-admin actions (`act`, `kill`, `bulk-kill`), `monitor-kill`, instance end reasons | pane-level: xtmux; activation-level cancel/abort: ActivationSupervisor |
| Runtime result normalization | `agent_turns` + episodes (source_key dedupe) + `outcome-apply` full-schema enforcement | turn/episode storage stays xtmux; result validation vs task contract moves to FINALIZE / finalization layer (register C-08 decomposition) |

## 5. Dispositions for each proposed RuntimeSupervisor responsibility

Per verification-packet §9 rubric (already shipped / extraction / new / elsewhere):

| Responsibility | Disposition |
|---|---|
| runtime instance registry | **Already shipped** — `agent_instances` (+ `@agent_instance_id`, rehydration, supersession) |
| delivery attempts/receipts | **Already shipped** — `delivery_attempts`, `message_receipts`, obligations |
| waits/interrupts | **Already shipped** — `outbound_waits`, monitors, picker interrupt; activation-level interrupt = elsewhere (ActivationSupervisor) |
| event-driven observation | **Partly shipped** — hooks/journal cursor exist; push-driven triggers (vs reconcile-on-read) = new |
| runtime reconciliation | **Already shipped** — `reconcileAll()`, marker quarantine, retention, shadow divergence machinery |
| provider adapters | **New** — today exactly three hard-wired hook surfaces (Pi/Claude/Codex); no adapter seam |
| terminal backends | **Extraction/new** — tmux coupling is pervasive (identity resolution, delivery, capture); seam needed before a second backend |
| workflow progression / scheduling / retry policy | **Elsewhere** — ChainReducer/Scheduler and FINALIZE; forbidden in xtmux (`xtmux-gaps.md` §10: xtmux *"must also not grow into the future Channels authority… scheduler indirection… remain outside this implementation"*) |

## 6. Duplication findings

- **adr001-navigation-design.md vs adr001-xtmux-nav.md**: complementary, not duplicates. `adr001-xtmux-nav.md` is the Accepted decision record; `adr001-navigation-design.md` is the v1 design spec citing it ("Related decision"). Overlap is substantial and partly verbatim-shared (fzf NUL record model, capability probe/fallback order, attention-cycle algorithm, inspector structure, popup geometry). Genuine unique content in the design doc: information-hierarchy detail, performance baseline §25, Herdr adoption boundary §18, phases NAV-0..4; in the ADR: decision framing, rejected alternatives, acceptance criteria, future decision triggers. **Disposition: keep both; cross-link bidirectionally; extract shared probe/record-model sections into one referenced annex if either is touched again.**
- ts-sqlite.md §27 vs observability-redesign.md §14: overlapping restatements of the same shipped Phase 2 coordination contract, mutually consistent (ts-sqlite declares §27 overrides earlier future-tense language; observability §14 is the implementation-record form). Keep both — PRD vs implementation-record roles are declared in their headers.

## 7. Contradictions / drift

1. Event-family naming drift: `xtmux-gaps.md` §9.2 prescribes `agent.turn.completed`, `message.delivered`, `handoff.delivery_attempted`; shipped journal uses `agent.turn.done`, `message.sent`, and `delivery_attempts` kinds. Integration-guidance names were not adopted verbatim; consumers must map.
2. `codex-characterization-k1.md` self-declares several statements false as of K3/K4 (handled by explicit SUPERSEDED banners — preserve the banners if the doc moves).
3. Readiness (`agent.ready`) is prescribed in gaps §8.1 and emitted by Codex SessionStart wiring, but a general readiness handshake across all runtimes is not evidenced as complete — treat gaps PR-C as partially landed.
4. No contradictions found between the proposed RuntimeSupervisor material and shipped xtmux docs; both converge on "evolve V2, no second store, no workflow authority."

## 8. Console finding

`apps/console/src/server/runtime-lifecycle.ts` (dirty in worktree along with its test and `packages/core/src/runtime/project-scanner.ts`, `packages/core/src/state/dolt-client.ts`; HEAD blob `5bcab9c5`) implements the **console server's own data-plane lifecycle**, not agent-runtime supervision: start/stop of UnifiedScanner, Materializer, BeadsWatcherRuntime, observability watcher, parity harnesses; source registration (`beads:*`, `obs:*`) and materialization triggering; Dolt commit-hash probing with JSONL fallback. Console owns no agent process, session, or activation lifecycle — consistent with the register's quote of `console-product-contract.md` ("UI is read/control surface, not authority"). Console's "runtime" vocabulary must not be conflated with RuntimeSupervisor scope.

## 9. Open questions

1. Where does canonical ADR-06 text get written, and does it absorb the "proposed RuntimeSupervisor ADR" wholesale (matrix line 122 suggests yes)?
2. Is `agent.ready` shipped for Pi and Claude, or only Codex? (gaps PR-C status unverified in this lane.)
3. Should gaps §9.2 event-family names be conformed to shipped journal types or vice versa before Console consumes them?
4. Does the direct-AgentSession path need an xtmux *adapter* (emitting instance/turn facts into observability.db) or stay fully outside xtmux until a cross-backend registry is justified?
5. Retry/stall/timeout policy location for tmux-hosted runtimes: monitors detect terminal outcomes but nothing owns retry eligibility for hosted agents — presumably the invoking coordinator; unconfirmed.

## 10. Bottom line

xtmux V2 already ships nearly the entire observational/reconciliation half of the proposed RuntimeSupervisor (registry, receipts, waits/wakes, monitors, handoffs, turns, audit, recovery) with explicit prohibitions (no daemon, no workflow authority, no Channels/chain semantics) that match the reconciliation target. The genuinely new work is the provider-adapter and terminal-backend seam so direct Pi activations (ActivationSupervisor) and future backends plug in without tmux. Nothing justifies a second store or moving chain progression into xtmux.
