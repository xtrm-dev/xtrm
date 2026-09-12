# DeepSeek Harness — architecture and adoption audit for XTRM Agent/Frames compatibility

> **Console v2 / ISSUE-140 audit artifact.** Read-only source inspection at a pinned revision.
> Audited source: `deepseek-ai/deepseek-harness` @ `c291e7961a515f6d7af9304e7fd1d257929aef26` — MIT (`Copyright (c) 2026 DeepSeek`)
> Every load-bearing claim carries a `path:line` reference and is tagged `VERIFIED` (read in source), `INFERENCE` (derived from cited facts), or `UNKNOWN`.
> Hard boundaries applied: Pi stays native-first; Substrate Issues keeps executable-work authority; no second transcript/session source of truth. DEPEND count is 0; the value is in specifications, not code.
> Consumed by `adoption-audit.md`, `console-v2-migration-plan.md`, and `xtrm-gui-prd.md`.

---

Read-only audit. No file in `/tmp/audit-ext/dsh` was modified.

**Findings at a glance.**

1. DeepSeek Harness is architecturally coherent and worth reading, but **nothing in it is adoptable as a dependency**: every harness package peers on the source-vendored `@deepseek-ai/cordis` framework, so any DEPEND imports a second plugin/DI runtime beside Pi. Recommended DEPEND count: 0.
2. Three patterns transfer as **specifications, not code**: versioned projection units with a watermark-checked persisted cache (for `Frame`), the durable-lineage / runtime-ownership split with a rollback-covered create-resume-dispose transaction (for `AgentRelation`), and the two-boundary inbox with four distinct delivery verbs plus a closed cancel cause (for `inbox`/`followup`/`steer`/`inject`).
3. The single **strongest interop fact** is that both stacks already route models through the same library: DS ships `@deepseek-ai/dsh-llm-pi-ai` on `@earendil-works/pi-ai@^0.85.1`, MIT (VERIFIED). Align there, not on DS's `LlmRuntime`.
4. Every concept that carries **authority** — the durable session log, the task DAG, the team roster, approvals — must be REJECTED as authority while remaining useful as a shape reference. That is the whole compatibility boundary in one sentence.
5. The current Console v2 tranche needs **zero** DeepSeek adoption. One idea is worth a design decision now: separate the durable-history stream from the live-control stream, both baseline-then-increment, both replacing from baseline on reconnect.

## 1. Header

| Fact | Value | Tag |
|---|---|---|
| Repository | `deepseek-ai/deepseek-harness` (local clone `/tmp/audit-ext/dsh`) | VERIFIED |
| Audited SHA | `c291e7961a515f6d7af9304e7fd1d257929aef26` (`git rev-parse HEAD`) | VERIFIED |
| License | MIT, `Copyright (c) 2026 DeepSeek` — `LICENSE` | VERIFIED |
| Package manager / runtime | pnpm workspaces, Node `^22.19 \|\| >=24`, ESM everywhere (`AGENTS.md:65`, `AGENTS.md:105`) | VERIFIED |
| Shape | 268 workspace package directories under `packages/*/*`, 4 apps (`apps/cli`, `apps/web`, `apps/desktop`, `apps/desktop-host`), 9 source-vendored Cordis packages (`vendor/`), ~3073 TS files under `packages apps` | VERIFIED |
| Vendor manifest | `vendor/README.md:11-27` — Cordis `4.0.0-rc.7` + 8 foundation plugins, all MIT, republished under `@deepseek-ai` scope | VERIFIED |

Stated architectural doctrine (source and docs, not marketing):

1. **Everything is a plugin on one framework.** "Cordis is the framework under dsh: plugins contribute services, typed events, and reversible effects to a shared context… There is no privileged core to patch" (`docs/architecture.md:11-13`).
2. **Capability seam = three roles.** Service Definition / Service Provider / Consumer; one role alone is not a seam (`docs/architecture.md:127`, `AGENTS.md:113`).
3. **Registrations are effects.** Every contribution goes through `ctx.effect()` / `ctx.on()`; `register()` returns the disposer (`AGENTS.md:106`).
4. **Typed events via declaration merging.** Merge-extensible `…Map` interfaces, `SessionEventMap` members required-on-read unless `ignorable: true` (`AGENTS.md:108`, `packages/core/session/src/types.ts:269` and `:483`).
5. **Model-visible ⟺ logged.** "Anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event" (`AGENTS.md:111`, restated `docs/architecture.md:121`).
6. **Plugins, not loop changes** (`AGENTS.md:112`).
7. **The session log is the single source of truth;** model history is derived, never stored (`docs/architecture.md:117`, `packages/core/session/src/index.ts:832` `deriveMessages()`).
8. **No second persisted event type at the durability seam** (`docs/subsystems/persistence.md`, seam at `packages/session/session-persistence/src/index.ts:135`).
9. **Branded opaque cross-boundary ids** (`AGENTS.md:118`, `packages/util/brand/src/index.ts:18`).
10. **Applications launch only through `dsh --profile <name>`;** package bins and inline Cordis trees are rejected by `verify-application-entrypoints` (`AGENTS.md:9`, `docs/architecture.md:41-47`).
11. Safety posture is explicitly experimental and not production-ready (`SAFETY.md`, "has not undergone a security audit").
12. Non-trivial changes require an Agent Note in-repo; harness-owned process authority lives in `.agents/notes/` (`AGENTS.md:126`).

Directive-status note: `AGENTS.md` is the real file, `CLAUDE.md` is a symlink to it (`AGENTS.md:149-151`) — VERIFIED (`CLAUDE.md -> AGENTS.md`).

## 2. Architecture map

### 2.1 Agent identity

- Durable-facing identity is *only* the shared `SessionId`; the live `Agent` interface is one readonly field: `readonly id: SessionId` (`packages/core/agent/src/types.ts:13-16`).
- Live capabilities are a declaration-merge augmentation, not a class: `options`, `session`, `inbox`, `status`, `ctx`, `cancel`, `whenIdle`, `runMaintenance`, `send`, `followup`, `steer`, `inject` (`packages/core/agent/src/runtime-types.ts:163-243`).
- Registry: `class AgentRegistry extends Service` (`packages/core/agent/src/index.ts:245`) keyed by `SessionId` — `get()` `:567`, `list()` `:587`, `roots()` `:597`, `isOwnedBy()` `:579`.
- **There is no durable agent registry.** The registry is an in-memory table; durability is delegated to the session log plus the persistence backend's `list()`/`stat()`. Tag: VERIFIED by absence — no registry-backed persistence member exists on `AgentRegistry`.
- Wire identity for RPC is a Typert lookup/context pair keyed on `SessionId` (`packages/core/agent/src/types.ts:18-27`).
- The only non-session identity in the repo is an anonymous user id file (`.anonymous-user-id`), `AnonymousUserId` (`packages/identity/anonymous-user-id/src/index.ts:26`, `:68`).

### 2.2 Sessions and the durable event log

- `class Session` (`packages/core/session/src/index.ts:446`), id accessor `:470`, `deriveMessages()` `:832`.
- `class SessionStore extends Service` (`:899`), `fork(source, boundary?, childSessionId?)` `:1203`.
- Envelope and vocabulary: `SessionHeader` (`packages/core/session/src/types.ts:93-130`), `SessionEventMap` `:269`, `SessionEventType` `:403`, envelope `:472`, `ignorable` `:483`.
- Core durable variants: `turn/start` `:276`, `turn/end` `:285`, `step/start` `:287`, `user/message` `:297`, `system/message` `:310`, `assistant/message` `:321` (embeds the compact timed stream), `assistant/attempt` `:335`, `tool/call` `:341`, `tool/result` `:353`, `request/header` `:365`.
- `SESSION_FORMAT_VERSION = 3` (`:88`). Released generations are append-only; a version-named successor is published beside, never over (`AGENTS.md:7`, `docs/architecture.md:119`).
- Durability seam: `abstract class SessionPersistence` (`packages/session/session-persistence/src/index.ts:135`) with `create` `:147`, `open` `:162`, `stat` `:191`, `list` `:198`; `interface SessionHandle extends AsyncDisposable` (`packages/session/session-persistence/src/handle.ts:59`); shipped provider `class JsonlSessionPersistence` (`packages/session/session-persistence-jsonl/src/index.ts:235`), zstd default `:66`.

### 2.3 Events: three domains, explicitly separated

Stated at `docs/architecture.md:70-78`: session events (durable facts), `agent/*` events (live, carrying a live `Agent`), capability events (`fs/*`, `tools/*`, `telemetry/*`).

- Durable session feed: `'session/event'` post-commit fire-and-forget (`packages/core/session/src/index.ts:72`, dispatch `:747-752`), `'session/created'` `:50`, `'session/flush'` `:81`.
- Live agent events, all in `packages/core/agent/src/runtime-types.ts`: `agent/created` `:258`, `agent/disposed` `:267`, `agent/status` `:277`, `agent/inbox/inserted` `:285`, `agent/inbox/claimed` `:296`, `agent/inbox/discarded` `:304`, `agent/session-start` `:316`, waterfalls `agent/pre-step` `:330`, `agent/request` `:347`, `agent/request-error` `:363`, `agent/assistant-stream` `:373`, serial `agent/turn-stopping` `:391`, `agent/error` `:403`.
- The one durable agent-owned event: `agent/inbox/spliced` (`packages/core/agent/src/types.ts:87`).
- Turn flow contract (turn/step/waterfall ordering) is normative in `docs/architecture.md:82-111`.

### 2.4 Projections

- `class SessionProjectionRegistry extends Service` (`packages/session/session-projection/src/index.ts:199`); unit contract `interface ProjectionDefinition` `:48` (`key`, `stateSchema`, `init`, pure `apply`, optional `wire.viewSchema`/`view`, `stateVersion`); merge-extensible maps `SessionProjectionMap` / `SessionProjectionStateMap` (`packages/session/session-projection/src/types.ts:17`, `:24`); `onChanged()` `:301`, `stateOf()` `:319`, `snapshot()` `:338`, `checkpoint()` `:396`, `restore()` `:495`.
- Persisted cache: `class SessionProjectionCache extends Service` (`packages/session/session-projection-cache/src/index.ts:92`), `cachedSnapshot()` `:145`, `hydratePrepared()` `:212`, `write()` `:246`, `coldSnapshot()` `:277`.
- Design authority: `docs/architecture.md:123`; seam doc `docs/subsystems/session-projection.md`.
- Key property: **the framework drives, the domain computes.** The registry subscribes to `session/event` once; domains hold no subscriptions; clients receive finished whole values, never fold events.

### 2.5 Tools

- Registry and guarded pipeline in `packages/core/tools/src/index.ts`: `register()` `:1027`, `restrict()` `:1061`, `ToolExecution` interface `:372`, waterfalls `tools/pre-execute` `:144`, `tools/execute` `:155`, `tools/post-execute` `:167`, `tools/change` `:199`, dispatch sites `:1466`, `:1564`, `:1734`.
- Durable halves of a call: `tool/call` (`packages/core/session/src/types.ts:341`), `tool/result` `:353`.

### 2.6 Teams and mailbox

- `class TeamService extends TypertRemoteService` (`packages/experimental/agent-team/src/index.ts:59`); `spawnTeammate` `:153`; `sendMessage` `:163`; `createTask` `:173`; `updateTask` `:202`; `waitForChange` `:213`; `@Remote('view')` `:242`.
- Durable forms in `packages/experimental/agent-team/src/types.ts`: `TeamId = Branded<'TeamId'>` as a branded root `SessionId` `:8`; `TeamMemberPhase` `:44`; `TeamMemberSnapshot` `:47`; `TeamTaskStatus` `:71`; `TeamTaskSnapshot` `:74`; `TeamMessageSnapshot` `:106`; `TeamMessageSource` `:115`; event map `team/member` `:221`, `team/task` `:223`, `team/message/queued` `:225`.
- Replay: `foldTeam()` over the root session log; every task mutation is a whole snapshot with a `revision` compare-and-set.
- The whole Agent Teams subsystem is **experimental** (`docs/architecture.md:131`, `packages/experimental/`).

### 2.7 Subagents (delegation, lineage, continuation)

- `class SubagentRuntime extends TypertRemoteService` (`packages/subagent/subagent/src/index.ts:188`); `startContinuable` `:228`; `sendMessage` `:246`; `interrupt` `:295`; `listChildren` `:349`; `@Remote('list')` `:385`; `@Remote('prompt')` `:412`; `@Remote('interruptByParent')` `:479`; `start()` `:556`; `prepareContinuable()` `:593`.
- Provider contract `interface SubagentProvider` (`packages/subagent/subagent/src/types.ts:344`); capability flags `SubagentCapabilities` `:130`; one-shot request `SubagentStartRequest` `:145`; result `SubagentResult` `:271`; run `SubagentRun` `:308`.
- Continuation manager `class SubagentContinuationManager` (`packages/subagent/subagent/src/continuation.ts:82`), `sendMessage` `:202`, `interrupt` `:332`, cold resume `:401`.
- Lineage reads: `listChildren` (`packages/subagent/subagent/src/list-children.ts:83`) filters on `header.parentSession` `:90`; `listDescendants` `:110`; subagent `origin`/`parentSession` pairing `:189`.
- Fork provider seeded at creation from a completed-turn prefix, captured once (`packages/subagent/subagent-fork-in-process/src/index.ts:46`, `:77`, `:85-90`).
- Durable lineage fields: `parentSession` `:106`, `isSeeded` `:111`, `origin: 'subagent'` `:116`, `delegationDepth` `:122`, `agentPreset` `:129` (`packages/core/session/src/types.ts`).

### 2.8 Telemetry and logging

- `SessionTelemetryRecord` (`packages/session/session-telemetry/src/index.ts:64`), `SessionTelemetrySink` `:95`, redaction waterfall `session-telemetry/record` `:43`, `SessionTelemetrySharingStatus` `:135`, abstract backend `:143-153`.
- Shipped provider: `class OpenTelemetrySessionBackend extends SessionTelemetryBackend` (`packages/session/session-telemetry-otel/src/index.ts:156`), on-demand capture `:243`, feedback-triggered capture `:254`.
- Boundary axiom: harness ends at `emit()`; batching/retry/loss policy belongs to the SDK. Delivery is best-effort and receivers must dedupe ledger records on `(session.id, session.format_version, event.seq)`; ops records deliberately omit that identity.

### 2.9 Remote, client, web, desktop

- RPC primitive: `Remote` decorator (`packages/typert/protocol/src/index.ts:174`), stream mode `:102`; the module imports `Service` from `@deepseek-ai/cordis` at line `:8`, so even the decorator package is framework-coupled.
- Host surface: `class SessionController extends TypertRemoteService` (`packages/api/session-controller/src/index.ts:87`), `@Remote('prompt')` `:346`, `@Remote('cancel')` `:377`, `@Remote('page')` `:388`, streams `follow` `:400`, `control` `:410`; `SessionFollowFrame` (`packages/api/session-controller/src/types.ts:515`); stream implementation `follow()` (`packages/api/session-controller/src/history.ts:119`).
- HTTP carrier: `class WebServer extends Service` (`packages/host/webserver/src/index.ts:124`), `WebRoute` `:42`, single fallback seat `:189`.
- Browser boot graph: `WebBootEntry` (`packages/client/modules/src/client/manifest.ts:51`), `WebBootBatch` `:70`, `WebBootGraph` `:82`. Layering doctrine: `docs/subsystems/web-client.md`.
- Desktop: framed byte pipes with `DESKTOP_HOST_PROTOCOL_VERSION = 3` (`apps/desktop-host/src/wire.ts:4`), incremental frame decoder `:109`; Electron custom protocol `dsh-app` (`apps/desktop/src/main.ts:26`); preload bridge `contextBridge.exposeInMainWorld('dshDesktop', api)` (`apps/desktop/src/preload.ts:38`); host controller `dshVersion` (`apps/desktop-host/src/index.ts:69`), stream path `:97`.
- CLI/profile boot: `PROFILE_ROOT_CONFIG` empty entry list + ordered patches (`apps/cli/src/profile-boot.ts:83-91`).

### 2.10 Query, storage, and settings

- Session search/forensics: `abstract class SessionQueryEngine extends Service` (`packages/session-query/session-query/src/index.ts:97`); logical records `SessionRecord` / `SessionEventRecord` / `SessionLogSnapshot` / `SessionSurfaceSnapshot` with source availability (`live` vs `persisted`) documented at `docs/subsystems/session-query.md`; concrete FTS provider is `packages/session-query/session-query-sqlite`.
- Non-session storage: hub `class Storage extends Service` (`packages/storage/storage/src/index.ts:47`) is a name→backend table only; the data-form facility is `class DomainFacility` (`packages/storage/storage-domain/src/index.ts:69`); providers `packages/storage/storage-json` and `class SqliteStorageBackend` (`packages/storage/storage-sqlite/src/index.ts:55`, schema version exported `:16`). Doctrine: hub performs no IO, backends own media, data forms own semantics (`docs/subsystems/storage.md`).
- User settings seam: `ctx.settings` Service Definition (`packages/settings/settings/src/index.ts:2`), conflict error `:154`.

### 2.11 Model and capability seams

- LLM: adapter registration `ctx.llm.registerAdapter(providers, adapter)` (`packages/llm/llm/src/index.ts:196`), per-request preparation `prepareCall()` `:269`, adapter registry `:334`, `llm/stream` waterfall `:72`; streaming vocabulary `ContentBlockMap` and `MessageSourceMap` (`packages/llm/llm/src/types.ts:112`, `packages/llm/llm/src/message.ts:102`).
- **Interop fact worth flagging: DS ships a `@earendil-works/pi-ai`-backed adapter** — `@deepseek-ai/dsh-llm-pi-ai` declares `@earendil-works/pi-ai@^0.85.1` as a runtime dependency (`packages/llm/llm-pi-ai/package.json`) and routes model requests through pi-ai provider catalogs (`packages/llm/llm-pi-ai/README.md`). Pi and DeepSeek Harness already share one model-provider library, licensed MIT (`THIRD_PARTY_NOTICES.md`, runtime npm dependencies table). Tag: VERIFIED.
- MCP: client-side only, `packages/mcp/mcp-client/{connection,transport,tools}.ts`.
- Skills: `class SkillRegistry extends Service` (`packages/skill/skill/src/index.ts:356`); `ctx.skills.list()` `:56`, `get()` `:86`, `register()` `:94`.
- Web search/fetch: `class WebRuntime extends Service` (`packages/web/web/src/index.ts:74`), `registerSearchProvider` `:103`, `registerFetchProvider` `:114`.

### 2.12 Applications, profiles, and external protocols

- Profiles and bundles: a profile is a named composition of ordered bundle layers plus patch files (`docs/architecture.md:17-29`); each declares itself in its own `package.json` under `dsh.profile` / `dsh.bundle` (`docs/architecture.md:23`); shipped bundles `packages/bundle/{base,web-app,headless,sdk-app,sdk-minimal,acp-app}`.
- CLI boot: single entry point for every supported app (`docs/architecture.md:41-47`); empty-root patch composition (`apps/cli/src/profile-boot.ts:83-91`); enforced by `scripts/verify-application-entrypoints.ts`.
- SDK: `class HarnessSdkJsonRpcServer` (`packages/sdk/server/src/server.ts:75`), `initialize()` `:135`, method dispatch `:248`; protocol/transport in `packages/sdk/protocol/src/{index,transport,types}.ts`; a Python SDK mirrors the loop and must be updated in the same PR as loop changes (`AGENTS.md:131`).
- ACP: automation-only Agent Client Protocol server over JSON-RPC stdio (`packages/acp/acp/src/index.ts:2`); request surface `session/new` `:384`, `session/list` `:385`, `session/resume` `:386`, `session/close` `:387`, `session/setConfigOption` `:388`, `session/prompt` `:389`, cancellation notification `:390`; dependency `@agentclientprotocol/sdk` is Apache-2.0.

### 2.13 Control plane (jobs, goals, plan, guard, hooks, invariants)

- Jobs: producer contract and `JobStatus` (`packages/jobs/jobs/src/types.ts:17`), runtime `packages/jobs/jobs-local`, tools `packages/jobs/tool-jobs`.
- Goals: `GoalPhase` (`packages/goal/goal/src/types.ts:45`), compare-and-set `GoalRef`; durable phase is separate from process-local activation (`docs/subsystems/goal.md`).
- Plan mode: `plan/mode` is log-only and never enters the model transcript; fold state at `packages/plan/plan-mode/src/types.ts:44`.
- Guard: `packages/guard/repeat-tool-reminder` and `packages/guard/timeout-policy` — loop-hygiene and tool-timeout plugins (`AGENTS.md:37`).
- Hooks: `packages/hooks/hook-protocol`, `packages/hooks/hooks-claude-code`, `packages/hooks/hooks-codex` — bridges that map native hook decision fields onto the typed `PreStepDecision` (`packages/core/agent/src/runtime-types.ts:112-119`).
- Invariants: `class InvariantRegistry extends Service` (`packages/runtime-diagnostics/invariants/src/index.ts:94`), `register(packageName, installer)` `:136`; selection by package allow/blocklist; a check may assert event streams or mutable data, never service presence (`AGENTS.md:107`).

## 3. Concept-by-concept matrix

XTRM baseline column uses the XTRM PRD model named in the task: `Agent`, `AgentSession`, `Frame`, `AgentRelation` (`fork | dispatch | chain | peer`), `ChainRun`, `TelemetryEvent`, `Evidence`; Substrate Issues as work authority; Specialists as role-shaped agents projected into a unified Agents domain.

| DeepSeek concept | XTRM current equivalent | gap | useful implementation/pattern | disposition | migration/ownership risk |
|---|---|---|---|---|---|
| Agent registry + durable identity | `Agent` | XTRM `Agent` is a product entity with its own id; DS collapses agent identity onto the provider `SessionId` and keeps no durable registry | `readonly id: SessionId` (`core/agent/src/types.ts:15`); live registry `get/list/roots/isOwnedBy` (`core/agent/src/index.ts:567,587,597,579`); Typert lookup keyed on the same id (`types.ts:18-27`) | ADAPT | Low if XTRM keeps `Agent.id` primary and treats provider session id as an `AgentSession` foreign key. Do not adopt DS's "agent identity == session identity" collapse — it would force XTRM to mint a provider session before an Agent exists |
| create / resume / dispose lifecycle | `AgentSession` lifecycle, Specialists activation | XTRM has no single rollback-covered create transaction with a disposer capability | `CreateAgentOptions` (`core/agent/src/index.ts:62`), `ResumeAgentOptions` `:125`, `AgentHandle { agent, dispose() }` `:160`; factory registration `setFactory` `:355`; publication order `enter` `:458` → `announce` `:533`; setup-before-publish rule `:100-118` | ADAPT | Medium: the ordering guarantees (setup composes, never drives; rollback pairs every announcement with a disposal) are the value, and they are spec-expressible without importing Cordis. Copy the ordering contract, not the `Service` |
| Parent-agent relationships | `AgentRelation` kinds `fork`, `dispatch`, `chain` | XTRM relation kinds are product semantics; DS splits them into runtime ownership vs durable lineage and never conflates the two | `parentAgent` = runtime ownership (`core/agent/src/index.ts:66`); `isOwnedBy` `:579`; `roots()` `:597`; durable `parentSession` + `delegationDepth` (`core/session/src/types.ts:106,122`) | ADAPT | Low. Adopt the runtime-ownership / durable-lineage split into `AgentRelation` modelling: ownership is live and droppable, lineage is durable and replayable |
| Fork lineage | `AgentRelation.kind = 'fork'`, `Frame` seed | XTRM has no immutable fork-point contract | `SessionStore.fork()` (`core/session/src/index.ts:1203`); `isSeeded` + exact `inheritedEventCount` (`core/session/src/types.ts:111,145`); fork prefix captured once at creation (`subagent-fork-in-process/src/index.ts:85-90`); `create(… meta: { parentSession, seedLength })` (`docs/architecture.md:156`) | ADAPT | Low. The "seed is a completed-turn prefix, captured once, then owned by the child" rule prevents re-fork drift; adopt verbatim into XTRM `AgentRelation` fork semantics |
| Session identity | `AgentSession` | XTRM session ids are provider-native (Pi); DS makes the session id the universal cross-boundary key | `SessionId = Branded<'SessionId'>` (`core/session/src/types.ts:19`); one id shared by registry, log, wire lookup, telemetry attributes | REFERENCE | Do not adopt as XTRM's key. Hard boundary: durable session authority stays with the provider. Map DS `SessionId` → XTRM `AgentSession.externalId` |
| Durable SessionEvent log | XTRM `Evidence` + existing forensic authority | XTRM has no append-only typed agent-log with a format-version contract | `SessionEventMap` (`core/session/src/types.ts:269`), `SESSION_FORMAT_VERSION` `:88`, `ignorable` envelope flag `:483`, "model-visible ⟺ logged" (`AGENTS.md:111`) | REFERENCE | High if adopted as a store. Adopt only as a **compatibility/verification projection** over the provider's transcript. Adopting it as a second transcript store violates the no-second-source-of-truth boundary |
| Live `agent/*` events | XTRM AgentOps live events | XTRM live event names/shapes are its own | Full live vocabulary `agent/created`, `agent/disposed`, `agent/status`, `agent/inbox/{inserted,claimed,discarded}`, `agent/session-start`, `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/assistant-stream`, `agent/turn-stopping`, `agent/error` (`core/agent/src/runtime-types.ts:258-403`) | REFERENCE | Low. Use as a naming/shape reference for XTRM's live Agent stream; do not emit DS names onto XTRM's bus |
| Durable-vs-live event separation | XTRM evidence vs live observability | XTRM has no written axiom separating the two | Three-domain rule (`docs/architecture.md:70-78`); durable `session/event` feed (`core/session/src/index.ts:72`); transient stream chunks with one committed settlement (`runtime-types.ts:128-161,373`); "a hard process loss before settlement leaves no durable attempt stream" (`docs/architecture.md:117`) | ADAPT | Low, and highest-value doctrine to port: record which XTRM events are reconstructable after restart and which are explicitly transient |
| Typed projection architecture | XTRM `Frame` | XTRM has no declared fold contract, no watermark, no cache-version rule | `ProjectionDefinition` with pure `apply`, `stateVersion` (`session-projection/src/index.ts:48-98`); lazy cells; `Object.is` change feed `:301`; synchronous consistent `snapshot()` with `asOfSeq` `:338`; persisted cache with version-mismatch discard (`session-projection-cache/src/index.ts:92,145,246,277`) | ADAPT | Medium. This is the single best fit for XTRM `Frame`. Reduce it: one fold registry, one watermark, one version-mismatch discard rule. Do not port `ctx.inject`, `Service`, or the Zod `stateSchema` plumbing |
| Tool-call lifecycle | XTRM tool/action surface | XTRM has no three-stage guarded pipeline with a durable call envelope | `tools/pre-execute` / `tools/execute` / `tools/post-execute` waterfalls (`core/tools/src/index.ts:144,155,167`), `ToolExecution` `:372`, scoped `restrict()` `:1061`, durable `tool/call`+`tool/result` (`core/session/src/types.ts:341,353`) | ADAPT | Low–medium. Port the pre/execute/post envelope and the "scoped restriction, loud unknown-name validation" rule; do not port the registry |
| Streaming | XTRM live output | XTRM has no split between transient chunk frames and one durable settlement | `agent/assistant-stream` start/chunk/end frames (`runtime-types.ts:128-161`), `llm/stream` waterfall (`llm/llm/src/index.ts:72`), embedded durable stream in `assistant/message` (`core/session/src/types.ts:321`) | ADAPT | Low. Adopt the "chunks transient, exactly one durable settlement, end frame carries the settlement seq" contract for XTRM agent output |
| Cancellation | XTRM stop/interrupt | XTRM cancellation has no typed cause taxonomy carried into the durable record | `AgentCancelCause` union `user \| parent \| hook \| disposed` + `CancelOptions.keepInbox` (`runtime-types.ts:38-45,183`); `turn/end` reason `TurnEndReasonMap` (`core/session/src/types.ts:200`); "the first cause wins" | ADAPT | Low. Port the closed cause union; it is a small, high-signal change to XTRM's stop paths |
| Inbox / followup / steer / inject | XTRM steer/followup verbs | XTRM has no durable inbox mutation log | `Inbox` interface (`runtime-types.ts:48-100`); four delivery verbs `send` `:215`, `followup` `:222`, `steer` `:231`, `inject` `:241`; durable `agent/inbox/spliced` (`core/agent/src/types.ts:87`); two ordered lists `next-turn`/`next-step` (`types.ts:30`) | ADAPT | Low. Port the two-boundary inbox (`next-turn` vs `next-step`) and `inject` = queue-without-wake. Keep the durable record in XTRM's own store, not DS's event type |
| Agent Teams roster | Specialists projected into unified Agents domain; `Evidence` | XTRM has no team roster shape; DS roster is experimental | `TeamMemberSnapshot` (`experimental/agent-team/src/types.ts:47`) with `provisioning → active \| failed` phases `:44` and runtime status derived separately; membership from the exact live agent credential (`agent-team/src/index.ts` doc contract) | REFERENCE | Low as a shape reference. Do not import roster *authority*; XTRM `Specialists` already own role identity |
| Mailbox / peer messaging | `AgentRelation.kind = 'peer'` | XTRM has no durable peer-message record with recovery semantics | `TeamMessageSnapshot` (`agent-team/src/types.ts:106`) + `TeamMessageSource` `:115` retained by the target for de-duplication; "queued-minus-delivered is the recovery mailbox", acknowledgement only after durable delivery | REFERENCE | Medium if adopted wholesale. The queued-minus-delivered recovery idea is portable; the DS delivery scheduling (always steer) would conflict with XTRM peer semantics |
| Task DAG (coordination reference only) | Substrate Issues (executable-work authority) | DS has a full task board with CAS revisions, blockers, advisory write scopes | `TeamTaskSnapshot` `:74`, `revision` CAS, `blockedBy`, `writeScopes`; `createTask`/`updateTask` (`agent-team/src/index.ts:173,202`) | REJECT | Hard boundary. A second task authority beside Substrate Issues creates dual-write, conflicting ownership, and reconciliation debt for zero new capability |
| Telemetry / logging | `TelemetryEvent`, AgentOps evidence authority | XTRM has a read/evidence model; DS has only an outbound emit seam with no read path | `SessionTelemetryRecord` (`session-telemetry/src/index.ts:64`), `Sink.emit()` non-blocking enqueue `:95`, capture modes `live`/`on-demand`, `sharing` disclosure `:135`; redaction waterfall `:43`; OTel backend `:156` | ADAPT | Low and additive: port the **redaction waterfall** boundary (transform before emit, fail-closed on a throwing rule) and the "harness ends at emit()" axiom. Do not adopt OTel as XTRM's telemetry sink |
| Agent status / liveness | XTRM agent status field | XTRM has no explicit rule that presence ≠ liveness | `AgentStatus = 'idle' \| 'running'` (`runtime-types.ts:109`), `agent/status` `:277`, `api-session/status` (`api/session-controller/src/types.ts:594`); initiator presence is explicitly "neither liveness proof nor authorization" (`core/agent/src/index.ts:240`, `:319`) | ADAPT | Low. Adopt the axiom + two-state machine; it prevents XTRM from treating intent/registration as evidence of a live worker |
| Approvals | not in the XTRM PRD model as given | Unknown whether XTRM has an approval seam | Closed fail-closed outcome `allowed-once \| rejected \| cancelled \| unavailable`; `ApprovalService` (`interaction/user-approval/src/index.ts:143`); durable audit pair `approval/asked` `:218` + `approval/decided` `:225`; durable `approval/policy` `:33`, replay read `:249`; answerer waterfall `:275` | REFERENCE | Low. Reusable vocabulary if XTRM adopts approvals; no ownership transfer needed to borrow the closed-enum-plus-audit-pair design |
| Remote / client projection | XTRM Console v2 (shell-level compatibility only) | XTRM does not need DS's RPC; the current tranche is shell-level | `Remote` decorator (`typert/protocol/src/index.ts:174`), stream mode `:102`; `SessionFollowFrame` snapshot-then-append (`api/session-controller/src/types.ts:515`); `follow()` `history.ts:119`; separate `control()` baseline+replace stream `index.ts:410` | REFERENCE | High if adopted. `typert-protocol` imports Cordis `Service` (`typert/protocol/src/index.ts:8`); adopting it means running Cordis beside Pi's extension model |
| Web UI architecture | XTRM Console v2 frontend | different stacks | Boot graph `WebBootEntry`/`WebBootGraph` (`client/modules/src/client/manifest.ts:51,82`); slot + client-model layering (`docs/subsystems/web-client.md`); single fallback seat HTTP carrier (`host/webserver/src/index.ts:124,189`) | REFERENCE | Low. Useful as a layering reference (host state → transport → client model → UI adapter → render). No code reuse worth the Cordis dependency |
| Desktop architecture | XTRM Console desktop (if any) | unknown parity | Versioned framed byte pipes over Node IPC, `DESKTOP_HOST_PROTOCOL_VERSION = 3` (`apps/desktop-host/src/wire.ts:4`), incremental decoder `:109`, custom `dsh-app://` scheme (`apps/desktop/src/main.ts:26`), narrow `contextBridge` surface (`apps/desktop/src/preload.ts:38`), no loopback port (`docs/architecture.md:53`) | REFERENCE | Low. "No web server or loopback port in the desktop composition; IPC only for lifecycle, framed pipes for data" is a portable security posture |
| Subagent provider seam | Specialists as role-shaped agents | XTRM Specialists are a governed role registry; DS is a named-provider registry with capability flags | Named multi-provider registry (`subagent/subagent/src/index.ts:188`); `SubagentCapabilities` checked **before** start (`types.ts:130`); capability-by-method-presence `prepareContinuable` (`index.ts:593`); continuation manager with cold resume (`continuation.ts:82,202,401`) | ADAPT | Medium. Ports to XTRM's Specialist dispatch as a capability-negotiation rule ("reject loud, never accept-then-ignore"). Do not port the provider implementations; `subagent-claude-code` pulls the non-permissive Claude Code payload closure (see §6) |
| Workflow / orchestration engine | `ChainRun` | XTRM has `ChainRun` semantics; DS has a model-authored orchestration script run in a worker thread | `ctx.workflowEngine` single provider; worker-thread engine, one worker per run, vm context inside it (`docs/subsystems/workflow.md`); `WorkflowMeta` declared as plain JSON data (`packages/workflow/workflow/src/types.ts:40,46`), validated before execution, never evaluated | REFERENCE | Medium. The "validate declarative meta as data before running any script" rule is worth copying. The execution model conflicts with XTRM `ChainRun` ownership |
| Hooks bridges | XTRM hooks/quality-gate integration | XTRM is Pi-native; DS ships Claude Code and Codex hook bridges | `packages/hooks/{hook-protocol,hooks-claude-code,hooks-codex}`; documented mapping of native decision fields onto the typed `PreStepDecision` (`docs/agent-lifecycle.md`, `runtime-types.ts:112-119`) | REFERENCE | Low. Useful as a compatibility precedent (XTRM already keeps Pi native-first) |
| Background jobs | XTRM background work | XTRM has its own | `JobId` branded, `<kind>-N`; `JobStatus = 'running' \| 'stopping' \| 'completed' \| 'killed' \| 'failed'` (`packages/jobs/jobs/src/types.ts:17`); owner authorization rather than id secrecy (`docs/subsystems/jobs.md`) | REFERENCE | Low |
| Plan / goal state | XTRM work authority = Substrate Issues | DS keeps same-session objectives in the session log | `plan/mode` is a log-only, whole-value-replace session event, never in the model transcript (`docs/subsystems/plan.md`; fold state at `packages/plan/plan-mode/src/types.ts:44`); goal `GoalPhase` with separate process-local activation (`packages/goal/goal/src/types.ts:45`, doctrine `docs/subsystems/goal.md`) | REFERENCE | Medium if misread as authority. Reject as work authority; the "durable phase vs process-local activation" split is a good reference for XTRM run state |
| Runtime invariants | XTRM quality gates | XTRM gates run externally, not as in-process invariants | `InvariantRegistry.register(packageName, installer)` (`runtime-diagnostics/invariants/src/index.ts:94,136`) with allow/blocklist selection; checks may assert authoritative event streams, never service or method presence (`AGENTS.md:107`) | REFERENCE | Low. Good model if XTRM ever adds in-process invariant checks |
| Model routing / provider adapters | XTRM/Pi provider layer | different adapter abstractions; **same underlying provider library** | `ctx.llm.registerAdapter` (`llm/llm/src/index.ts:196`), `prepareCall()` `:269`, `llm/stream` waterfall `:72`; `@earendil-works/pi-ai@^0.85.1` runtime dependency (`packages/llm/llm-pi-ai/package.json`) | REFERENCE | None — this is the strongest interop fact found. Align XTRM and DS on pi-ai provider/model catalog semantics rather than on DS's `LlmRuntime` service. Both are MIT |
| MCP client | XTRM MCP surface | DS implements client-side MCP only | `packages/mcp/mcp-client/{connection,transport,tools}.ts` | REFERENCE | Low |
| Skills | XTRM skills | different registries and loading rules | `class SkillRegistry extends Service` (`skill/skill/src/index.ts:356`); `ctx.skills.list/get/register` (`:56,86,94`) | REFERENCE | Low |
| Session search / forensics | existing XTRM forensic and AgentOps evidence authority | XTRM already owns forensic authority; DS adds a query engine over a live-preferred corpus | `abstract class SessionQueryEngine extends Service` (`session-query/session-query/src/index.ts:97`); explicit `live`/`persisted` source availability per record (`docs/subsystems/session-query.md`) | REFERENCE | Medium. Adopt only the "live-preferred corpus with explicit source-availability flags and atomic observations" idea; do not stand up a second forensic store |
| KV storage for non-session state | XTRM Console state | DS splits hub / backend / data form across three roles | `class Storage extends Service` (`storage/storage/src/index.ts:47`); `class DomainFacility` (`storage/storage-domain/src/index.ts:69`); `class SqliteStorageBackend` (`storage/storage-sqlite/src/index.ts:55`) | REFERENCE | Low. Relevant only if Console v2 needs a second durable domain; XTRM already has a state DB and a single-writer rule |
| External agent protocol (SDK / ACP) | XTRM control plane | DS exposes a JSON-RPC SDK and an automation-only ACP stdio server | `HarnessSdkJsonRpcServer` + `initialize()` (`sdk/server/src/server.ts:75,135`); ACP `session/new\|list\|resume\|close\|setConfigOption\|prompt\|cancel` (`acp/acp/src/index.ts:384-390`) | REFERENCE | Medium. The ACP request set is a useful checklist for XTRM's external-agent surface; ACP is automation-only by design and Apache-2.0 |
| Profile / bundle composition | XTRM extension and config model | DS composes an ordered, patchable plugin tree at boot | `dsh.profile` / `dsh.bundle` manifest fields (`docs/architecture.md:19-25`); empty-root patch layers (`apps/cli/src/profile-boot.ts:83-91`) | REFERENCE | Medium. Layered patchable composition is attractive but is implemented by the vendored Cordis loader, so reuse implies adopting the loader |
| Identity / principal | XTRM agent + operator identity | DS has no principal model beyond an anonymous local user id | `AnonymousUserId` + `.anonymous-user-id` file (`identity/anonymous-user-id/src/index.ts:26,29,68`) | REFERENCE | None. Confirms DS has no durable cross-session agent/user identity registry for XTRM to align with |

**DEPEND count: 0.** No DeepSeek package is genuinely standalone-consumable at acceptable ownership cost. Evidence: every harness package declares `@deepseek-ai/cordis` as a `peerDependency` (`AGENTS.md:104`; VERIFIED in `packages/core/agent/package.json`, `packages/core/session/package.json`, `packages/core/agent-loop/package.json`, `packages/session/session-projection/package.json`, `packages/session-query/session-query/package.json`, `packages/api/session-controller/package.json`, `packages/typert/protocol/package.json`), and the framework layer is republished from `vendor/` under the same scope (`vendor/README.md:1-5`). The one zero-import package (`@deepseek-ai/dsh-brand`, 39 lines, no imports at all) is cheaper to transcribe than to depend on. Adopting any package means adopting the Cordis runtime beside Pi — which the hard boundaries exclude.

### 3.1 Reverse index: XTRM PRD concept → what DeepSeek Harness offers

For readers starting from the XTRM model rather than the DS model.

| XTRM PRD concept | Most relevant DS material | Transferable part | Must not transfer |
|---|---|---|---|
| `Agent` | `AgentRegistry` (`core/agent/src/index.ts:245`), live `Agent` augmentation (`core/agent/src/runtime-types.ts:163`) | registry operations `get`/`list`/`roots`/`isOwnedBy`; the "presence is not liveness proof" axiom (`:240`) | the `SessionId`-as-agent-identity collapse; Cordis `Service` base class |
| `AgentSession` | `Session`/`SessionStore` (`core/session/src/index.ts:446,899`), `SessionPersistence` (`session-persistence/src/index.ts:135`) | the create/resume/dispose transaction ordering; the single-writer `SessionHandle` ownership idea (`handle.ts:59`) | the durable log as an XTRM store; the format/migration chain |
| `Frame` | `SessionProjectionRegistry` (`session-projection/src/index.ts:199`), projection cache (`session-projection-cache/src/index.ts:92`) | `ProjectionDefinition` shape, `stateVersion` discard rule, `asOfSeq` consistent cut, `Object.is` change suppression | the Cockpit coupling (`ctx.inject`, Zod schemas, Cordis effects) |
| `AgentRelation` (`fork\|dispatch\|chain\|peer`) | lineage header fields (`core/session/src/types.ts:106,111,116,122`), `fork()` (`core/session/src/index.ts:1203`), fork provider (`subagent-fork-in-process/src/index.ts:46,85`), mailbox (`experimental/agent-team/src/types.ts:106`) | durable lineage distinct from runtime ownership; captured-once fork seed; queued-minus-delivered mailbox recovery | team identity as a branded root `SessionId`; DS task/roster authority |
| `ChainRun` | workflow seam (`packages/workflow/workflow`), continuation manager (`subagent/subagent/src/continuation.ts:82`) | "validate declarative meta as plain JSON before running any script" | the worker-thread script engine as an XTRM chain executor |
| `TelemetryEvent` | `SessionTelemetryRecord` (`session-telemetry/src/index.ts:64`), redaction waterfall `:43` | the redaction-waterfall boundary and fail-closed throwing-rule behaviour; "harness ends at emit()" | the OTel pipeline (`session-telemetry-otel/src/index.ts:156`) as XTRM's sink |
| `Evidence` | durable `SessionEvent` envelope (`core/session/src/types.ts:472`), embedded assistant stream `:321` | the "model-visible ⟺ logged" invariant (`AGENTS.md:111`) and one-settlement-per-attempt rule | the log as XTRM's evidence authority; provider session authority stays with Pi |
| Substrate Issues | team task board (`experimental/agent-team/src/types.ts:74`) | nothing as authority; at most the CAS-revision readability idea | the entire task authority — explicit REJECT |
| Specialists | `SubagentProvider` + `SubagentCapabilities` (`subagent/subagent/src/types.ts:344,130`), `prepareContinuable` (`subagent/subagent/src/index.ts:593`) | capability checked before delegation, refusal instead of silent degradation; capability-by-method-presence discovery | the provider implementations, and especially `subagent-claude-code` (non-permissive payload closure) |

## 4. Three highest-value reusable patterns

### Pattern 1 — Versioned projection units with a persisted, watermark-checked cache

- Exact refs: `packages/session/session-projection/src/index.ts:48-98` (`ProjectionDefinition`), `:199` (registry), `:301` (`onChanged`), `:338` (`snapshot`), `:396` (`checkpoint`), `:495` (`restore`); `packages/session/session-projection/src/types.ts:17,24`; `packages/session/session-projection-cache/src/index.ts:92,145,246,277`; doctrine at `docs/architecture.md:123`.
- What it solves: how to derive many independent read models from one append-only log without giving each domain a subscription, without torn reads, and without serving a stale cache as current after a format change. Each unit declares `stateVersion`; a persisted row whose `ver` mismatches is discarded and the key refolds from `init` instead of being forward-applied into garbage. `snapshot()` is synchronous so `asOfSeq` covers the whole cut. A view that returns a stable reference (`Object.is`) suppresses downstream publication entirely.
- Minimum XTRM adaptation: define `FrameDefinition { key, version, init(header), apply(state, event) → state, view?(state) }`; one registry that subscribes to the provider transcript once; one in-memory cell per `(frame, session)` with a watermark; one persisted `(sessionId, frameKey, version, seq, value)` row set with a mismatch-discard rule. No `Service`, no `ctx.inject`, no Zod, no Cordis. Roughly the `ProjectionDefinition` type, the lazy-cell loop, and the `stateVersion` discard branch — the smallest subset that preserves the correctness properties.
- Ownership requirement: none. The pattern is ~200 lines of TypeScript expressing an invariant, not a library. **Does not require taking on DeepSeek ownership**, and must not: the durable log it folds stays the provider's transcript, so XTRM's Frames are derived, never authoritative. This is precisely the shape that satisfies "no second transcript/session source of truth" while giving XTRM real projections.

### Pattern 2 — Durable lineage + runtime ownership split, with a rollback-covered lifecycle and captured-once fork seed

- Exact refs: `packages/core/agent/src/index.ts:62` (`CreateAgentOptions`, incl. `parentAgent` vs `meta.parentSession`), `:125` (`ResumeAgentOptions`), `:160` (`AgentHandle.dispose()`), `:458` (`enter`), `:533` (`announce`), `:579` (`isOwnedBy`), `:597` (`roots`); `packages/core/session/src/types.ts:106,111,116,122,129` (lineage header fields), `:145` (`inheritedEventCount`); `packages/core/session/src/index.ts:1203` (`fork`); `packages/subagent/subagent-fork-in-process/src/index.ts:46,77,85-90`; `packages/subagent/subagent/src/list-children.ts:83,110,189`.
- What it solves: four problems XTRM's `AgentRelation` (`fork | dispatch | chain | peer`) will hit. (a) Runtime ownership and durable lineage are different relations that must not be conflated — a resumed fork can be a runtime root while still carrying durable ancestry. (b) Creation is a transaction with a single ordering: setup composes while unpublished, then session is announced, then agent, then `session-start`, then the loop starts; any throw rolls the whole thing back and every announcement that began is paired with a disposal. (c) `dispose()` is a capability held only by the creating owner; provider unload drains every handle it made. (d) A fork seed is a completed-turn prefix captured once at creation and then owned by the child, so a cold resume replays the child's recorded prefix instead of re-forking the parent's newer history.
- Minimum XTRM adaptation: add the lineage fields XTRM currently lacks — `parentAgentSessionId`, `isForked`, `inheritedEventCount`/`forkBoundary`, `delegationDepth` — and enforce two rules: runtime ownership is never derived from lineage, and a creation/dispatch transaction publishes in a fixed order with rollback pairing. Lineage queries become `AgentRelation` reads (`fork` from `parentSession` + seed prefix; `dispatch` from runtime ownership + `delegationDepth`; `peer` from the mailbox relation).
- Ownership requirement: none for the contract; the DS implementation is inseparable from Cordis `Service` and the agent-loop factory. **Copy the invariants, not the code.** This is the "root cause" capture: it is one ordering rule in the creation path rather than a guard in every caller.

### Pattern 3 — Two-boundary inbox with four distinct delivery verbs, durable splice record, and a typed cancel cause

- Exact refs: `packages/core/agent/src/types.ts:30` (`InboxTarget`), `packages/core/agent/src/runtime-types.ts:48-100` (`Inbox`), `:183` (`cancel` + `keepInbox`), `:215` (`send`), `:222` (`followup`), `:231` (`steer`), `:241` (`inject`), `:38-45` (`AgentCancelCause`); `packages/core/agent/src/types.ts:87` (`agent/inbox/spliced`), `:69-78` (`TurnBoundaryProjection`); `packages/core/session/src/types.ts:200` (`TurnEndReasonMap`); delivery/recovery behaviour in `packages/subagent/subagent/src/continuation.ts:202,332,401`.
- What it solves: the exact ambiguity XTRM's `inbox/followup/steer/inject` surface has. DS makes each verb a distinct promise: `followup` = its own turn; `steer` = nearest step boundary, waking an idle driver; `inject` = next pre-step **without waking** and may be missed by an already-claiming batch; `send` = explicit target + explicit wakeup. Two ordered lists (`next-turn`, `next-step`) make "which boundary does this land on" a stored field instead of a convention. Every mutation is normalized into a durable `agent/inbox/spliced` event, so a restart reconstructs the pending queue exactly; claims and discards are separate live notifications. Cancellation is a closed typed cause (`user | parent | hook | disposed`) with first-cause-wins, and the cause survives into the durable `turn/end` reason.
- Minimum XTRM adaptation: add `target: 'next-turn' | 'next-step'` to XTRM pending input, make `inject` explicitly non-waking (currently the most likely silent divergence), record every queue mutation as one durable normalized event, and replace free-form cancel reasons with a closed union. `keepInbox` is a small, high-value addition: abort the active turn but preserve pending work.
- Ownership requirement: none. This is a type-level contract plus one splice-normalization function; the DS implementation lives behind Cordis services and a 900-line loop that XTRM must not import.

## 5. Explicit REJECT list

| Rejected item | Refs | Reason |
|---|---|---|
| **Replacing the Pi/XTRM runtime with DeepSeek Harness or Cordis** | `packages/typert/protocol/src/index.ts:8` (imports Cordis `Service`); `AGENTS.md:104` (every package peers on `@deepseek-ai/cordis`); `vendor/README.md:1-5` | Hard boundary. XTRM keeps Pi as native-first. The harness's value proposition *is* Cordis — every seam, registry, effect, and waterfall is a Cordis construct. There is no partial adoption that does not put a second plugin/DI runtime beside Pi |
| **Importing Agent Teams as XTRM work authority or roster authority** | `packages/experimental/agent-team/src/index.ts:59,153,173,202`; `types.ts:47,74,106`; `docs/architecture.md:131` (experimental) | Hard boundary: Substrate Issues remains executable-work authority. Team identity is a branded root `SessionId`, so importing it also imports the "session id is the root identity" collapse. The subsystem is additionally flagged experimental |
| **Importing the team task DAG** | `experimental/agent-team/src/types.ts:71,74`; `index.ts:173,202` | Dual task authority. `revision` CAS + `blockedBy` + `writeScopes` is a second, weaker Substrate Issues competing for the same ownership, with reconciliation cost and no new capability |
| **Adopting the DS durable session log or its format/migration chain as an XTRM store** | `core/session/src/types.ts:88,269`; `session-persistence/src/index.ts:135`; `AGENTS.md:7` | No second transcript/session source of truth. Durable session authority stays with the provider (Pi). DS's generation/migration machinery only earns its cost if XTRM owns the log — it does not |
| **Adopting `@deepseek-ai/dsh-*` packages as dependencies** | `packages/*/*/package.json` `peerDependencies`; `AGENTS.md:104` | Ownership cost: each package drags Cordis, its `Service` lifecycle, and the repo's pre-stable API policy (`AGENTS.md:7`). Version `0.1.5-rc.2` across the workspace. Copying patterns is strictly cheaper |
| **Adopting the DS Team mailbox as XTRM peer messaging** | `types.ts:106,115`; doc `docs/subsystems/agent-team.md` | Scheduling is not selectable (every message attempts steer); de-duplication depends on DS `UserMessage` `source` folding. XTRM `AgentRelation.kind = 'peer'` should define its own delivery and dedup contract. The queued-minus-delivered recovery idea may be borrowed as a pattern only |
| **Adopting DS approvals as XTRM approval authority** | `interaction/user-approval/src/index.ts:143` | Not an XTRM concept in the given model; importing an approval *authority* would create a second gate beside XTRM's own. Vocabulary and the fail-closed outcome enum are borrowable; the service is not |
| **Making DS `agent/*` or `session/*` event names an XTRM wire contract** | `core/agent/src/runtime-types.ts:258-403`; `core/session/src/index.ts:50,72,81` | Would couple XTRM's public event surface to a pre-stable foreign vocabulary (`AGENTS.md:7`) and to Cordis declaration merging (`AGENTS.md:108`). Use as a design reference only |
| **Adopting the OTel backend or its SDK pipeline** | `session-telemetry-otel/src/index.ts:156,243,254`; `session-telemetry/src/index.ts:95` | The seam's own doctrine puts batching/retry/loss policy in the SDK. XTRM already has `TelemetryEvent` and AgentOps evidence authority; adding an OTel pipeline creates a second export path for the same facts |

| **Adopting the `dsh` CLI / profile / bundle launcher as an XTRM execution surface** | `docs/architecture.md:41-47`; `apps/cli/src/profile-boot.ts:83-91`; `scripts/verify-application-entrypoints.ts` | The launcher exists to compose a Cordis tree from patch layers and forbids any other launch path (`AGENTS.md:9`). XTRM's execution surface is already defined; importing this launcher imports the whole composition model, and running `dsh` as a subprocess to get at DS features would put a foreign agent runtime inside XTRM's process tree |
| **Adopting the Cordis waterfall/`ctx.effect()` extension model as XTRM's plugin contract** | `docs/architecture.md:11-13`; `AGENTS.md:106,110`; `vendor/cordis` | This is the framework, not a pattern. Adopting it means adopting Cordis beside Pi's extension model. The *concept* of an ordered listener chain that must call `next()` to delegate is portable as a convention; the framework is not |

## 6. License and provenance

- **Root license: MIT** (`LICENSE`, `Copyright (c) 2026 DeepSeek`) — VERIFIED. Every one of the 268 workspace manifests declares `"license": "MIT"` — VERIFIED by aggregate count.
- **MIT obligations for reuse.** If XTRM copies source (the recommended route), the MIT notice and permission text must be preserved in the copied files or a `THIRD_PARTY_NOTICES`-style file: "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." Copy do not paraphrase license headers. Tag: VERIFIED from `LICENSE`.
- **Vendored Cordis: MIT, different copyright holder.** `vendor/cordis|cosmokit|schemastery|group|include|loader|logger-console|timer|hmr` each carry MIT with `Copyright (c) 2021-present Shigma` — VERIFIED (`vendor/*/LICENSE`). Upstream commits and local modifications are logged in `vendor/README.md:11-27` and `vendor/README.md` "Local modifications" items 1–8. **Any code copied from a path resolved through those packages owes Shigma's notice, not DeepSeek's.** The local modifications log item 6 (`cordis/src/fiber.ts` lifecycle hardening) and item 8 (transactional Loader/Include reconciliation) are DeepSeek-authored divergences on top of MIT upstream — do not assume those behaviours exist upstream.
- **Non-MIT first-party:** `@deepseek-ai/node-addon-system` and its platform packages are **BSD 3-Clause** (`native/system/LICENSE`, `THIRD_PARTY_NOTICES.md` "First-party native packages"). Not relevant to any recommended pattern; recorded because the repo is not uniformly MIT.
- **Material third-party notices for anything subagent-related.**
  - `@anthropic-ai/claude-agent-sdk` declares `SEE LICENSE IN README.md`, and its eight optional platform packages declare `SEE LICENSE IN LICENSE.md` (each carrying the Claude Code 2.1.263 executable). `THIRD_PARTY_NOTICES.md` states the project owner authorizes distribution of these payloads and explicitly says this **"does not classify their declared terms as permissive."** (VERIFIED, quoted.) `packages/subagent/subagent-claude-code` depends on this closure. Any XTRM reuse of that provider path inherits an unresolved license question — treat as blocked until separately reviewed.
  - `@agentclientprotocol/sdk` is **Apache-2.0** (`THIRD_PARTY_NOTICES.md`), used by `packages/acp/acp`.
- **Provenance caution.** The repo enforces a generated notices file (`scripts/gen-third-party-notices.ts`; a pre-commit hook regenerates it and a spec asserts the committed bytes match). Copying code from this repo without copying the notices it references reproduces the code but drops the attribution chain. Tag: VERIFIED from `THIRD_PARTY_NOTICES.md` header.

## 7. Open questions — `UNKNOWN`

- **UNKNOWN** — Whether XTRM already has any approval/permission seam. The PRD concept list given for this audit does not name one, and the XTRM console worktree contains no `AgentRelation`/`ChainRun`/`TelemetryEvent` references to check against (`grep` over the worktree returned no matches).
- **UNKNOWN** — The exact XTRM `Frame` lifecycle contract: whether a `Frame` is a projection of one provider transcript, a cross-agent aggregate, or a scheduled snapshot. Pattern 1 is recommended assuming the first; if `Frame` is a cross-agent aggregate, the `asOfSeq` single-log watermark does not apply and a multi-log cut needs separate design.
- **UNKNOWN** — Whether XTRM `AgentRelation` is durable, live, or both. The DS split (durable lineage vs live ownership) is recommended as the model, but reconciling it with existing XTRM relation rows is unverified.
- **UNKNOWN** — Whether XTRM's provider (Pi) exposes a durable event feed with monotonic sequence numbers equivalent to `SessionEvent`. Pattern 1 and Pattern 3 both assume a monotonic, gap-free, replayable durable stream. If Pi's transcript is not append-only, the projection registry needs a different invalidation rule.
- **UNKNOWN** — Whether `deepseek-ai/deepseek-harness` publishes these packages to a public registry under `@deepseek-ai`, or whether they are private/unpublished. Manifests are not `private: true` and carry version `0.1.5-rc.2`, but no publish evidence was inspected. This affects whether a future DEPEND is even possible, though it does not change the recommendation.
- **UNKNOWN** — Whether the Agent Teams subsystem is reachable from any shipped profile by default (`docs/architecture.md:131` calls it "published opt-in"). Default-off would reduce (not remove) the dual-authority risk if XTRM ever mounted it.
- **UNKNOWN** — Real-world behavior of the DS `ignorable: true` envelope escape hatch across versions; only the mechanism is documented (`AGENTS.md:108`, `core/session/src/types.ts:483`). No multi-version corpus was inspected.

## 8. Tranche scoping

The audit context separates two tranches. The matrix rows split cleanly along that line, and no row forces the later tranche's work into the earlier one.

### Current Console v2 tranche — shell-level compatibility only

Nothing in DeepSeek Harness needs to be adopted for this tranche. The following rows are informational only and carry no migration work:

- Web UI architecture (`client/modules/src/client/manifest.ts:51,70,82`) and HTTP carrier (`host/webserver/src/index.ts:124`) — reference layering, different stack.
- Desktop architecture (`apps/desktop-host/src/wire.ts:4`; `apps/desktop/src/main.ts:26`) — reference security posture only.
- Remote / client projection (`typert/protocol/src/index.ts:8,174`; `api/session-controller/src/types.ts:515`) — explicitly out of scope; Cordis-coupled.
- Profile/bundle composition, SDK, ACP, MCP, skills, storage, jobs, plan, goal, guard, hooks, invariants — no Console v2 requirement.

One Console-adjacent item is worth a shell-level interaction design decision now: the `SessionFollowFrame` split (`api/session-controller/src/types.ts:515`) into a complete `snapshot` frame followed by ordered append frames, with a **separate** `control` stream that always opens with a complete baseline and then sends replacements (`api/session-controller/src/index.ts:410`). If Console v2 has any live agent view at all, adopting that two-stream shape (durable history vs live control, both baseline-then-increment, reconnect replaces from baseline) prevents the reconnect/replay bugs that a single mixed stream produces. Tag: INFERENCE.

### Later Agent/Frames tranche

Ordered by dependency, not by value:

1. **Decide `Frame` semantics first** (`UNKNOWN` above). Pattern 1 is only correct for per-session folds; a cross-agent `Frame` needs a different cut rule.
2. **Add lineage fields and the ownership/lineage split** (Pattern 2) — prerequisite for `AgentRelation` kinds `fork`/`dispatch`/`chain`/`peer` and for any real resume/dispose contract.
3. **Harden the inbox** (Pattern 3) — `next-turn`/`next-step` target, non-waking `inject`, durable normalized queue mutation, closed cancel cause. Independent of 1 and 2 and immediately useful.
4. **Add the projection registry** (Pattern 1) once `Frame` semantics are fixed.
5. **Adopt the live/durable event separation axiom** (`docs/architecture.md:70-78`) as an XTRM written rule, and the redaction-waterfall boundary (`session-telemetry/src/index.ts:43`) if XTRM exports any agent telemetry.
6. **Specialists → unified Agents domain**: borrow the DS capability-negotiation rule — capabilities are checked *before* delegation and unsupported requests are refused loud, never accepted-then-ignored (`subagent/subagent/src/types.ts:130`; `docs/subsystems/subagent.md`). This is the one DS rule that directly improves an existing XTRM surface.

Sequencing constraint: steps 2 and 3 change XTRM's own contracts, so they must land before any projection work that reads them, or the projection `stateVersion` discipline will discard folds repeatedly during the transition.

## 9. Verification evidence

Commands used for the load-bearing facts in this report. All were read-only.

| Fact | Command | Result |
|---|---|---|
| Audited SHA | `git rev-parse HEAD` | `c291e7961a515f6d7af9304e7fd1d257929aef26` |
| Root license | `cat LICENSE` | MIT, `Copyright (c) 2026 DeepSeek` |
| Workspace license uniformity | `grep -h '"license"' packages/*/*/package.json \| sort \| uniq -c` | `268 "license": "MIT"` |
| Package count | `ls -d packages/*/*/ \| wc -l` | 268 |
| Vendored license holders | `head -3 vendor/*/LICENSE` | MIT, `Copyright (c) 2021-present Shigma` (9 packages) |
| Non-MIT first-party | `head -5 native/system/LICENSE` | BSD 3-Clause, `node-addon-landlock-run contributors` |
| Cordis coupling of every harness package | `python3 -c` over each `package.json` `peerDependencies` | `@deepseek-ai/cordis` present in `dsh-agent`, `dsh-session`, `dsh-agent-loop`, `dsh-session-projection`, `dsh-session-query`, `dsh-api-session-controller`, `dsh-typert-protocol` |
| Typert requires Cordis at runtime | `grep -n import packages/typert/protocol/src/index.ts` | line 8: `import { Service, type Context } from '@deepseek-ai/cordis'` |
| Shared provider library | `python3 -c` on `packages/llm/llm-pi-ai/package.json` | dependency `@earendil-works/pi-ai@^0.85.1` |
| Claude Code payload license posture | `sed -n` on `THIRD_PARTY_NOTICES.md` | `SEE LICENSE IN LICENSE.md` per platform package; notices state the authorization "does not classify their declared terms as permissive" |

All `path:line` references in this report were taken from source reads at the audited SHA, not from the generated documentation under `docs/` (which is generated from source by `scripts/gen-cordis-catalog.ts` and verified fresh by a repo gate). Where a claim rests on documentation rather than source, the doc path is cited explicitly and the claim is marked as doctrine rather than code.
